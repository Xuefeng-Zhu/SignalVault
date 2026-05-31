import type {
  ArtifactType,
  BoxFolderSet,
  BoxUploadResult,
  NewSnapshot,
} from "@/lib/adapters/types";
import { subfolderKeyForArtifact } from "@/lib/adapters/box/routing";

import {
  addWarning,
  errorMessage,
  scopedRepo,
  setScanStatus,
  type ScanWorkflowContext,
} from "../context";
import { PERSISTENCE_MAX_ATTEMPTS, withRetry } from "../retry";

import {
  NormalizedSnapshotsSchema,
  UploadSnapshotsResultSchema,
  parseAtBoundary,
  type ArtifactIdentifiers,
  type NormalizedSnapshot,
  type UploadedSnapshot,
  type UploadSnapshotsResult,
} from "./artifacts";

/**
 * Step 5 — `uploadSnapshotToBoxStep` (status `uploading`).
 *
 * Creates the Box folder tree for the scan and uploads each snapshot's
 * artifacts to their type-matched subfolders, then persists the returned Box
 * identifiers onto the Snapshot records:
 *
 *  1. `BoxClient.ensureScanFolders(companyName, scanTimestamp)` creates
 *     `/SignalVault/{Company}/scans/{timestamp}/{raw,normalized,screenshots,…}`
 *     (Requirement 10.1). The scan folder id is persisted on the scan record.
 *  2. For each snapshot, the raw HTML → `raw`, the normalized content →
 *     `normalized`, and the screenshot reference → `screenshots`, each routed to
 *     its type-matched subfolder via {@link subfolderKeyForArtifact}
 *     (Requirement 10.2).
 *  3. Each upload's returned `fileId`/`folderId`/`url`/`key` is persisted onto
 *     the snapshot (Requirement 10.3) — both `url` AND `key` per the InsForge
 *     storage convention, plus the Box file id.
 *
 * ## Persistence retry, then continue (Requirement 10.4)
 *
 * Persisting a returned Box identifier is retried up to 3 times (4 attempts
 * total) via {@link withRetry}. If every attempt fails, the failure cause is
 * recorded as a warning and the workflow CONTINUES without terminating the scan
 * — the artifact id is simply left unpersisted on that snapshot.
 *
 * ## Degrade, never crash
 *
 * - If `ensureScanFolders` throws, the whole step degrades: a warning is
 *   recorded and an empty (simulated) folder set is returned so the scan
 *   continues. (In practice the Box adapter falls back to a simulated client that
 *   returns mock ids rather than throwing — Requirements 10.5, 19.2.)
 * - A per-artifact upload failure is recorded as a warning and skipped; the
 *   remaining artifacts and snapshots continue.
 * - A simulated Box adapter surfaces a single "evidence storage is simulated"
 *   warning (Requirement 10.5).
 *
 * The step core takes the context explicitly and uses only injected adapters,
 * so it is `server-only`-free and unit/property-testable with fakes — which the
 * artifact-id persistence round-trip property (task 18.3) depends on.
 */
export async function uploadSnapshotToBoxStep(
  ctx: ScanWorkflowContext,
  normalized: NormalizedSnapshot[],
): Promise<UploadSnapshotsResult> {
  const validated = parseAtBoundary(
    NormalizedSnapshotsSchema,
    normalized,
    "uploadSnapshotToBoxStep input",
  );

  // Persist the `uploading` status before emitting progress (Requirement 7.2).
  await setScanStatus(ctx, "uploading");

  const box = ctx.adapters.box;
  const repo = scopedRepo(ctx);

  // 1) Create (or resolve) the scan folder tree (Requirement 10.1). The scan's
  // `createdAt` is the value that uniquely identifies the scan and forms the
  // `{timestamp}` segment of `/SignalVault/{Company}/scans/{timestamp}/`.
  let folderSet: BoxFolderSet;
  try {
    folderSet = await box.ensureScanFolders(ctx.companyName, ctx.scanCreatedAt);
  } catch (error) {
    addWarning(
      ctx,
      `Failed to create Box scan folders: ${errorMessage(error)}. Evidence storage is unavailable for this scan.`,
    );
    // Degrade: return an empty simulated folder set and the snapshots untouched
    // so the workflow continues without terminating the scan.
    const empty = emptyFolderSet();
    return parseAtBoundary(
      UploadSnapshotsResultSchema,
      { folderSet: empty, snapshots: validated.map(toUnuploaded) },
      "uploadSnapshotToBoxStep output",
    );
  }

  // Persist the scan folder id on the scan record so BoxEvidenceLink can resolve
  // it (Requirement 10.6). Non-fatal on failure.
  await persistScanFolder(ctx, folderSet.scanFolderId);

  // Publish the folder set onto the shared context so the diff step (task 18.4)
  // can upload the diff report to the `diffs/` subfolder (Requirement 11.5).
  ctx.boxFolders = folderSet;

  if (folderSet.simulated) {
    // Requirement 10.5: surface that evidence storage is simulated.
    addWarning(ctx, "Evidence storage is simulated.");
  }

  const uploaded: UploadedSnapshot[] = [];

  for (const snapshot of validated) {
    // Accumulate the snapshot-record patch from each successful upload, then
    // persist once per snapshot so all three artifact ids land together.
    const patch: Partial<NewSnapshot> = {};
    const ids: {
      raw?: ArtifactIdentifiers;
      normalized?: ArtifactIdentifiers;
      screenshot?: ArtifactIdentifiers;
    } = {};

    // raw HTML -> raw subfolder (Requirement 10.2)
    const rawUpload = await uploadArtifact(
      ctx,
      folderSet,
      "raw",
      `${snapshot.pageRole}-raw.html`,
      snapshot.rawHtml,
    );
    if (rawUpload) {
      ids.raw = toIdentifiers(rawUpload);
      patch.rawArtifactUrl = rawUpload.url;
      patch.rawArtifactKey = rawUpload.key;
      patch.rawBoxFileId = rawUpload.fileId;
    }

    // normalized content -> normalized subfolder (Requirement 10.2)
    const normalizedUpload = await uploadArtifact(
      ctx,
      folderSet,
      "normalized",
      `${snapshot.pageRole}-normalized.md`,
      snapshot.normalizedContent,
    );
    if (normalizedUpload) {
      ids.normalized = toIdentifiers(normalizedUpload);
      patch.normalizedArtifactUrl = normalizedUpload.url;
      patch.normalizedArtifactKey = normalizedUpload.key;
      patch.normalizedBoxFileId = normalizedUpload.fileId;
    }

    // screenshot reference -> screenshots subfolder (Requirement 10.2). Only
    // uploaded when the capture produced a screenshot reference.
    if (snapshot.screenshotRef !== undefined) {
      const screenshotUpload = await uploadArtifact(
        ctx,
        folderSet,
        "screenshot",
        `${snapshot.pageRole}-screenshot.txt`,
        snapshot.screenshotRef,
      );
      if (screenshotUpload) {
        ids.screenshot = toIdentifiers(screenshotUpload);
        patch.screenshotArtifactUrl = screenshotUpload.url;
        patch.screenshotArtifactKey = screenshotUpload.key;
        patch.screenshotBoxFileId = screenshotUpload.fileId;
      }
    }

    // 3) Persist the returned Box identifiers onto the snapshot, retrying up to
    // 3 times; on exhaustion record the cause and continue (Requirement 10.4).
    if (Object.keys(patch).length > 0) {
      const persisted = await withRetry(
        () => repo.snapshots.update(snapshot.snapshotId, patch),
        PERSISTENCE_MAX_ATTEMPTS,
      );
      if (!persisted.ok) {
        addWarning(
          ctx,
          `Failed to persist Box identifiers for ${snapshot.url} after ${persisted.attempts} attempts: ${persisted.lastError}. Continuing scan.`,
        );
      }
    }

    uploaded.push({
      ...snapshot,
      ...(ids.raw ? { raw: ids.raw } : {}),
      ...(ids.normalized ? { normalized: ids.normalized } : {}),
      ...(ids.screenshot ? { screenshot: ids.screenshot } : {}),
    });
  }

  return parseAtBoundary(
    UploadSnapshotsResultSchema,
    { folderSet, snapshots: uploaded },
    "uploadSnapshotToBoxStep output",
  );
}

/**
 * Upload a single artifact to its type-matched subfolder, returning the upload
 * result or `undefined` when the upload fails (recorded as a warning so the
 * scan continues). The destination folder id is resolved from the
 * {@link BoxFolderSet} via the pure artifact→subfolder routing.
 */
async function uploadArtifact(
  ctx: ScanWorkflowContext,
  folderSet: BoxFolderSet,
  artifactType: ArtifactType,
  name: string,
  content: Buffer | string,
): Promise<BoxUploadResult | undefined> {
  const subfolderKey = subfolderKeyForArtifact(artifactType);
  const folderId = folderSet.subfolders[subfolderKey];

  try {
    return await ctx.adapters.box.upload(folderId, artifactType, name, content);
  } catch (error) {
    addWarning(
      ctx,
      `Failed to upload ${artifactType} artifact "${name}": ${errorMessage(error)}. Continuing scan.`,
    );
    return undefined;
  }
}

/** Persist the scan folder id on the scan record (non-fatal on failure). */
async function persistScanFolder(
  ctx: ScanWorkflowContext,
  scanFolderId: string,
): Promise<void> {
  const persisted = await withRetry(
    () =>
      scopedRepo(ctx).scans.updateStatus(ctx.scanId, "uploading", {
        boxScanFolderId: scanFolderId,
      }),
    PERSISTENCE_MAX_ATTEMPTS,
  );
  if (!persisted.ok) {
    addWarning(
      ctx,
      `Failed to persist Box scan folder id after ${persisted.attempts} attempts: ${persisted.lastError}. Continuing scan.`,
    );
  }
}

/** Project a Box upload result down to the persisted identifier quad. */
function toIdentifiers(result: BoxUploadResult): ArtifactIdentifiers {
  return {
    fileId: result.fileId,
    folderId: result.folderId,
    url: result.url,
    key: result.key,
  };
}

/** A normalized snapshot carried forward with no uploaded artifact ids. */
function toUnuploaded(snapshot: NormalizedSnapshot): UploadedSnapshot {
  return { ...snapshot };
}

/** A deterministic empty/simulated folder set used when folder creation fails. */
function emptyFolderSet(): BoxFolderSet {
  return {
    scanFolderId: "",
    subfolders: {
      raw: "",
      normalized: "",
      screenshots: "",
      diff: "",
      claim: "",
      report: "",
    },
    simulated: true,
  };
}
