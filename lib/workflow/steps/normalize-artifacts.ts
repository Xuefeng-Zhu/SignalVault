import { normalizeHtml } from "@/lib/content/normalize";
import type { NewSnapshot } from "@/lib/adapters/types";

import {
  addWarning,
  errorMessage,
  scopedRepo,
  setScanStatus,
  type ScanWorkflowContext,
} from "../context";

import {
  CapturedSnapshotsSchema,
  NormalizedSnapshotsSchema,
  parseAtBoundary,
  type CapturedSnapshot,
  type NormalizedSnapshot,
} from "./artifacts";

/**
 * Step 4 — `normalizeArtifactsStep` (status `scraping`).
 *
 * For each captured snapshot, normalizes the raw HTML into markdown/plain text
 * and computes the raw-content hash and normalized-text hash (Requirement 9.1),
 * persisting all three onto the Snapshot record (Requirement 9.4). The actual
 * conversion + hashing is delegated to the shared, pure
 * {@link normalizeHtml} (`lib/content`), which already strips script/nav/footer
 * and falls back to the raw text when normalization yields empty content
 * (Requirements 9.2, 9.5).
 *
 * ## Shared context + injected adapters
 *
 * The InsForge repository comes from `scopedRepo(ctx)` (workspace-scoped); no
 * adapter is constructed here (Requirement 23.1). Normalization fallback
 * reasons are pushed onto the shared `ctx.warnings` accumulator (Requirement
 * 9.5), and the step carries forward the normalized content + hashes for the
 * upload step.
 *
 * ## Degrade, never crash (Requirement 9.5)
 *
 * `normalizeHtml` never throws — on failure or empty output it returns the raw
 * text with `fallbackUsed = true` and a `failureReason`. Persisting the
 * normalized fields to a snapshot is wrapped so a single persistence error is
 * recorded as a warning and the remaining snapshots continue to be normalized.
 * The in-memory normalized result is still carried forward even if its
 * persistence failed, so downstream diff/claim steps can proceed.
 *
 * The step core takes the context explicitly and is `server-only`-free, so it
 * is directly unit-testable with an injected InsForge fake.
 */
export async function normalizeArtifactsStep(
  ctx: ScanWorkflowContext,
  captured: CapturedSnapshot[],
): Promise<NormalizedSnapshot[]> {
  const validated = parseAtBoundary(
    CapturedSnapshotsSchema,
    captured,
    "normalizeArtifactsStep input",
  );

  // Still in the scraping phase per the design step table.
  await setScanStatus(ctx, "scraping");

  const repo = scopedRepo(ctx);
  const normalizedSnapshots: NormalizedSnapshot[] = [];

  for (const snapshot of validated) {
    // Pure, deterministic normalization + hashing (Requirements 9.1, 9.2, 9.4).
    const result = normalizeHtml(snapshot.rawHtml);

    if (result.fallbackUsed) {
      // Requirement 9.5: record the normalization fallback reason and continue.
      addWarning(
        ctx,
        `Normalization fell back to raw text for ${snapshot.url}` +
          (result.failureReason ? `: ${result.failureReason}` : "."),
      );
    }

    // Persist the normalized content + both hashes onto the snapshot record
    // (Requirement 9.4). A failure here is non-fatal: warn and carry on.
    const patch: Partial<NewSnapshot> = {
      contentHash: result.contentHash,
      normalizedTextHash: result.normalizedTextHash,
    };

    try {
      await repo.snapshots.update(snapshot.snapshotId, patch);
    } catch (error) {
      addWarning(
        ctx,
        `Failed to persist normalized content for ${snapshot.url}: ${errorMessage(error)}`,
      );
    }

    normalizedSnapshots.push({
      ...snapshot,
      normalizedContent: result.normalized,
      contentHash: result.contentHash,
      normalizedTextHash: result.normalizedTextHash,
      fallbackUsed: result.fallbackUsed,
    });
  }

  // Publish the normalized content onto the shared context so later steps
  // (diffing, claim extraction) can reason over it without re-downloading. A
  // `NormalizedSnapshot` is structurally a superset of the context's
  // `CurrentSnapshot`, so this satisfies the diff step's `ctx.currentSnapshots`
  // input (Requirement 9.1 content carried forward).
  for (const snapshot of normalizedSnapshots) {
    ctx.currentSnapshots.push({
      snapshotId: snapshot.snapshotId,
      watchedSourceId: snapshot.watchedSourceId,
      normalizedContent: snapshot.normalizedContent,
    });
  }

  return parseAtBoundary(
    NormalizedSnapshotsSchema,
    normalizedSnapshots,
    "normalizeArtifactsStep output",
  );
}
