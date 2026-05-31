import { z } from "zod";

import { makeDiff, serializeDiff, type Diff } from "@/lib/diff";
// `import type` for the adapter surface keeps this module free of the
// `server-only` runtime guard. The step reaches external state ONLY through the
// injected adapters carried on the shared context (Requirement 23.1), so the
// core stays directly unit-testable with fakes.
import type {
  BoxClient,
  BoxFolderSet,
  DiffRepo,
  DiffRow,
  NewDiff,
  Snapshot,
} from "@/lib/adapters/types";

import {
  addWarning,
  errorMessage,
  scopedRepo,
  type CurrentSnapshot,
  type NormalizedContentLoader,
  type ScanWorkflowContext,
} from "../context";
import type {
  FindPreviousSnapshotData,
  SnapshotPairing,
} from "./find-previous-snapshot";

/**
 * Step 7 — `computeDiffStep` (status `diffing`).
 *
 * For every snapshot pairing produced by {@link findPreviousSnapshotStep}:
 *
 *  - WITH a prior snapshot: compute the diff between the prior and current
 *    normalized content via {@link makeDiff} (producing an integer
 *    `change_score` in [0, 100], a `change_summary`, added/removed text, and
 *    `modified_sections` — Requirement 11.2), persist a Diff record
 *    (`DiffRepo.create`), then serialize the diff report ({@link serializeDiff})
 *    and upload it to the Box `diffs/` subfolder, persisting the returned diff
 *    box file id (Requirements 11.2, 11.5).
 *  - WITHOUT a prior snapshot: record the current snapshot as an initial
 *    baseline and mark the source as having no comparison available
 *    (Requirement 11.3). No Diff record is stored for a baseline.
 *
 * Resilience (degrade-never-crash):
 *  - A per-source diff computation/persistence failure records the cause as a
 *    warning + skip, excludes that source from the stored diffs, and continues
 *    with the remaining sources (Requirement 11.6).
 *  - A per-source serialization/upload failure records the cause and omits the
 *    diff report artifact for that diff, while the diff record itself is still
 *    stored (its `diff_box_file_id` stays null) and the workflow continues
 *    (Requirement 12.5).
 *
 * The step accumulates warnings/skips on the shared context and never throws on
 * a per-source failure.
 *
 * Requirements: 11.2, 11.3, 11.5, 11.6, 12.5, 23.4
 */

/** A diff successfully computed and persisted for one source. */
export interface ComputedDiff {
  watchedSourceId: string;
  diff: DiffRow;
  /** True when the diff report artifact was uploaded to Box `diffs/`. */
  artifactUploaded: boolean;
}

/** A source recorded as an initial baseline (no prior snapshot — Req 11.3). */
export interface BaselineSource {
  watchedSourceId: string;
  currentSnapshotId: string;
}

/** Output of {@link computeDiffStep}. */
export interface ComputeDiffData {
  /** Diffs stored for sources that had a prior snapshot and computed cleanly. */
  diffs: ComputedDiff[];
  /** Sources with no prior snapshot, recorded as baselines (Requirement 11.3). */
  baselines: BaselineSource[];
}

/**
 * Zod schema for the canonical computed {@link Diff}, enforcing the Requirement
 * 11.2 bounds (integer `change_score` in [0, 100]) before the diff is
 * persisted. Snapshot references are validated as non-empty strings so the test
 * store's human-readable ids pass.
 */
const DiffSchema = z.object({
  priorSnapshotId: z.string().min(1).nullable(),
  currentSnapshotId: z.string().min(1),
  changeScore: z.number().int().min(0).max(100),
  changeSummary: z.string(),
  addedText: z.string(),
  removedText: z.string(),
  modifiedSections: z.array(
    z.object({
      heading: z.string(),
      before: z.string(),
      after: z.string(),
    }),
  ),
});

/**
 * Warnings collected by the pure core, drained onto the context by the step.
 * The diff step is keyed by snapshot (not by capture plan), so per-source
 * failures are recorded as warnings carrying the cause (Requirements 11.6,
 * 12.5); exclusion from the stored diffs is achieved by simply not emitting a
 * {@link ComputedDiff} for the failed source.
 */
interface CoreAccumulators {
  warnings: string[];
}

/**
 * The dependencies {@link computeDiffs} needs, decoupled from the full
 * {@link ScanWorkflowContext} so the step core stays directly testable with
 * fakes.
 */
export interface ComputeDiffDeps {
  scanId: string;
  diffs: DiffRepo;
  box: BoxClient;
  /** The scan's Box folder set; when absent the diff artifact upload is skipped. */
  boxFolders?: BoxFolderSet;
  /**
   * Resolve a snapshot's normalized content. Returns `null` when unavailable,
   * which is treated as a recoverable per-source diff failure (Requirement 11.6).
   */
  resolveNormalizedContent: NormalizedContentLoader;
  /** Resolve a snapshot's source URL for warning/skip messages. */
  urlForSnapshot?: (snapshot: Snapshot) => string | undefined;
}

/**
 * Compute, persist, and serialize+upload diffs for the supplied pairings.
 *
 * This is the testable core of {@link computeDiffStep}: it takes its
 * dependencies explicitly and contains all per-source try/catch resilience. It
 * never throws on a per-source failure — failures become warnings/skips on the
 * returned accumulators.
 */
export async function computeDiffs(
  deps: ComputeDiffDeps,
  pairings: SnapshotPairing[],
): Promise<{ data: ComputeDiffData; acc: CoreAccumulators }> {
  const diffs: ComputedDiff[] = [];
  const baselines: BaselineSource[] = [];
  const acc: CoreAccumulators = { warnings: [] };

  for (const pairing of pairings) {
    if (pairing.priorSnapshot === null) {
      // Requirement 11.3 — initial baseline, no comparison available.
      baselines.push({
        watchedSourceId: pairing.watchedSourceId,
        currentSnapshotId: pairing.currentSnapshot.id,
      });
      acc.warnings.push(
        `No prior snapshot for source ${pairing.watchedSourceId}; recorded as an initial baseline with no comparison available.`,
      );
      continue;
    }

    await diffOneSource(deps, pairing, pairing.priorSnapshot, diffs, acc);
  }

  return { data: { diffs, baselines }, acc };
}

/**
 * Handle a single source that has a prior snapshot: resolve both contents,
 * compute the diff, persist it, then best-effort serialize+upload the report.
 * All failure modes are caught here so one bad source cannot abort the step.
 */
async function diffOneSource(
  deps: ComputeDiffDeps,
  pairing: SnapshotPairing,
  priorSnapshot: Snapshot,
  diffs: ComputedDiff[],
  acc: CoreAccumulators,
): Promise<void> {
  const { watchedSourceId, currentSnapshot } = pairing;
  const url = deps.urlForSnapshot?.(currentSnapshot) ?? watchedSourceId;

  // --- Compute + persist (Requirement 11.6 on failure) --------------------
  let stored: DiffRow;
  let diff: Diff;
  try {
    const priorContent = await deps.resolveNormalizedContent(priorSnapshot);
    const currentContent = await deps.resolveNormalizedContent(currentSnapshot);
    if (priorContent === null || currentContent === null) {
      throw new Error(
        `normalized content unavailable (prior: ${priorContent !== null}, current: ${currentContent !== null})`,
      );
    }

    diff = makeDiff(priorContent, currentContent, priorSnapshot.id, currentSnapshot.id);
    // Validate the computed diff before persistence (Requirements 11.2, 23.5).
    DiffSchema.parse(diff);

    const newDiff: NewDiff = { ...diff, scanId: deps.scanId, diffBoxFileId: null };
    const [persisted] = await deps.diffs.create([newDiff]);
    if (persisted === undefined) {
      throw new Error("diff repository returned no row");
    }
    stored = persisted;
  } catch (error) {
    // Requirement 11.6 — record cause, exclude this source (no ComputedDiff is
    // emitted), continue with the remaining sources.
    const cause = errorMessage(error);
    acc.warnings.push(`Failed to compute the diff for ${url}: ${cause}`);
    return;
  }

  // --- Serialize + upload the diff report (Requirement 12.5 on failure) ---
  const uploaded = await uploadDiffReport(deps, url, diff, stored, acc);
  diffs.push({ watchedSourceId, diff: uploaded.row, artifactUploaded: uploaded.ok });
}

/**
 * Serialize the diff and upload it to the Box `diffs/` subfolder (Requirement
 * 11.5). On any serialization/upload failure the cause is recorded and the diff
 * report artifact is omitted (Requirement 12.5); the already-persisted diff row
 * is returned unchanged (its `diff_box_file_id` stays null).
 */
async function uploadDiffReport(
  deps: ComputeDiffDeps,
  url: string,
  diff: Diff,
  row: DiffRow,
  acc: CoreAccumulators,
): Promise<{ ok: boolean; row: DiffRow }> {
  const diffsFolderId = deps.boxFolders?.subfolders.diff;
  if (diffsFolderId === undefined) {
    // No Box folder tree available (e.g. the upload step degraded): omit artifact.
    acc.warnings.push(
      `No Box diffs/ folder available for ${url}; the diff report artifact was omitted.`,
    );
    return { ok: false, row };
  }

  try {
    const serialized = serializeDiff(diff);
    const name = `diff-${row.id}.json`;
    const result = await deps.box.upload(diffsFolderId, "diff", name, serialized);
    if (result.simulated) {
      acc.warnings.push(`Diff report for ${url} stored with simulated Box storage.`);
    }
    // Reflect the returned Box file id on the in-memory diff row so the
    // workflow output carries it (the DB column is best-effort).
    return { ok: true, row: { ...row, diffBoxFileId: result.fileId } };
  } catch (error) {
    // Requirement 12.5 — record cause, omit the artifact, continue.
    acc.warnings.push(
      `Failed to serialize or upload the diff report for ${url}; the artifact was omitted: ${errorMessage(error)}`,
    );
    return { ok: false, row };
  }
}

/**
 * Run {@link computeDiffStep} against the shared workflow context, consuming the
 * pairings from {@link findPreviousSnapshotStep}.
 *
 * Builds the normalized-content resolver from the context: it prefers the
 * in-memory normalized content captured during the current scan
 * (`ctx.currentSnapshots`), then falls back to the optional
 * `ctx.loadNormalizedContent` loader (used to fetch a prior scan's normalized
 * artifact). When neither can supply content for a snapshot the resolver returns
 * `null`, which the core treats as a recoverable per-source failure (11.6).
 *
 * Drains the core's warnings/skips onto the shared accumulators.
 */
export async function computeDiffStep(
  ctx: ScanWorkflowContext,
  previous: FindPreviousSnapshotData,
): Promise<ComputeDiffData> {
  const currentContentById = indexCurrentContent(ctx.currentSnapshots);

  const resolveNormalizedContent: NormalizedContentLoader = async (snapshot) => {
    const inMemory = currentContentById.get(snapshot.id);
    if (inMemory !== undefined) return inMemory;
    if (ctx.loadNormalizedContent !== undefined) {
      return ctx.loadNormalizedContent(snapshot);
    }
    return null;
  };

  const { data, acc } = await computeDiffs(
    {
      scanId: ctx.scanId,
      diffs: scopedRepo(ctx).diffs,
      box: ctx.adapters.box,
      ...(ctx.boxFolders !== undefined ? { boxFolders: ctx.boxFolders } : {}),
      resolveNormalizedContent,
    },
    previous.pairings,
  );

  // Drain the core warnings onto the shared context. Baselines and per-source
  // failures both contributed warnings; a failed source contributes no
  // ComputedDiff, which is how it is excluded from the stored diffs (11.6).
  for (const message of acc.warnings) {
    addWarning(ctx, message);
  }

  return data;
}

/** Index the current scan's captured snapshots by snapshot id → normalized content. */
function indexCurrentContent(current: CurrentSnapshot[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of current) {
    map.set(entry.snapshotId, entry.normalizedContent);
  }
  return map;
}
