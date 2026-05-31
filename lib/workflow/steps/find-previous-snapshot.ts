import { z } from "zod";

// `import type` for the adapter surface keeps this module free of the
// `server-only` runtime guard, so the prior-snapshot selection logic stays
// directly unit-/property-testable with injected fake repos (Property 15 /
// task 18.5). The step reaches external state ONLY through the workspace-scoped
// repository on the shared context — never by constructing an adapter itself
// (Requirement 23.1).
import type { ScanRepo, Snapshot, SnapshotRepo } from "@/lib/adapters/types";

import { scopedRepo, setScanStatus, type ScanWorkflowContext } from "../context";
import { parseAtBoundary } from "./artifacts";

/**
 * Step 6 — `findPreviousSnapshotStep` (status `diffing`).
 *
 * For each Watched_Source of the Company this step identifies the prior
 * Snapshot captured by the MOST RECENTLY COMPLETED EARLIER Scan, selecting AT
 * MOST ONE prior snapshot per source (Requirement 11.1). The "earlier" cutoff
 * is the current scan's `createdAt`, and the prior scan is resolved through
 * {@link ScanRepo.mostRecentCompleted} so the selection is the latest
 * `completed` scan whose `createdAt` precedes the current scan.
 *
 * Every current snapshot is paired with either its prior snapshot or `null`.
 * A `null` pairing means the source has no prior snapshot, so it is an initial
 * baseline with no comparison available (Requirement 11.3); `computeDiffStep`
 * (step 7) consumes these pairings to compute diffs and record baselines.
 *
 * The step performs no external side effects beyond the workspace-scoped
 * repository reads (and persisting the `diffing` status), accumulates no
 * warnings of its own (the baseline/no-comparison warning is surfaced by the
 * diff step where the decision is finalized), and never throws on a missing
 * prior scan.
 *
 * Requirements: 11.1, 11.3, 23.4
 */

/**
 * A single current snapshot paired with the prior snapshot it should be diffed
 * against. `priorSnapshot` is `null` when the source has no prior snapshot
 * (initial baseline / no comparison — Requirement 11.3).
 */
export interface SnapshotPairing {
  watchedSourceId: string;
  currentSnapshot: Snapshot;
  priorSnapshot: Snapshot | null;
}

/** Output of {@link findPreviousSnapshotStep}: one pairing per current snapshot. */
export interface FindPreviousSnapshotData {
  pairings: SnapshotPairing[];
  /** Id of the prior completed scan the priors came from, or null when none. */
  priorScanId: string | null;
}

/** Parameters for the pure prior-snapshot selection core. */
export interface SelectPriorSnapshotsParams {
  companyId: string;
  /** The current scan's `createdAt`; only earlier completed scans qualify. */
  before: string;
  /** The snapshots captured by the CURRENT scan, one (typically) per source. */
  currentSnapshots: Snapshot[];
}

/**
 * Zod schema validating the selection input boundary (Requirement 23.5). Ids
 * are validated as non-empty strings rather than UUIDs so the deterministic
 * test store's human-readable ids pass too. Only
 * the fields the selection relies on are asserted; the remaining Snapshot
 * fields pass through untouched.
 */
const SelectPriorSnapshotsParamsSchema = z.object({
  companyId: z.string().min(1),
  before: z.string().min(1),
  currentSnapshots: z.array(
    z
      .object({
        id: z.string().min(1),
        watchedSourceId: z.string().min(1),
        createdAt: z.string().min(1),
      })
      .passthrough(),
  ),
});

/**
 * Choose, for each current snapshot, the prior snapshot to diff against.
 *
 * Selection (Requirement 11.1):
 *  1. Resolve the most recently completed scan earlier than `before` via
 *     {@link ScanRepo.mostRecentCompleted}. When there is none, every current
 *     snapshot is a baseline (`priorSnapshot = null`).
 *  2. List that prior scan's snapshots and index them by `watchedSourceId`,
 *     keeping AT MOST ONE per source. When a prior scan somehow holds more than
 *     one snapshot for a source, the most recently created one wins, so the
 *     choice is deterministic.
 *  3. Pair each current snapshot with the prior snapshot for the same source,
 *     or `null` when the source has no prior snapshot.
 *
 * Pure with respect to its injected repositories: it issues only reads and
 * never mutates. This is the logic Property 15 (task 18.5) exercises with fake
 * repos, so it deliberately takes the repos as parameters rather than reading a
 * context or constructing an adapter.
 */
export async function selectPriorSnapshots(
  scans: ScanRepo,
  snapshots: SnapshotRepo,
  params: SelectPriorSnapshotsParams,
): Promise<FindPreviousSnapshotData> {
  // Validate the boundary; keep the statically-typed input for the logic.
  SelectPriorSnapshotsParamsSchema.parse(params);
  const { companyId, before, currentSnapshots } = params;

  const priorScan = await scans.mostRecentCompleted(companyId, before);

  if (priorScan === null) {
    // No earlier completed scan: every source is an initial baseline.
    return {
      priorScanId: null,
      pairings: currentSnapshots.map((currentSnapshot) => ({
        watchedSourceId: currentSnapshot.watchedSourceId,
        currentSnapshot,
        priorSnapshot: null,
      })),
    };
  }

  const priorSnapshots = await snapshots.listForScan(priorScan.id);
  const priorBySource = indexMostRecentBySource(priorSnapshots);

  return {
    priorScanId: priorScan.id,
    pairings: currentSnapshots.map((currentSnapshot) => ({
      watchedSourceId: currentSnapshot.watchedSourceId,
      currentSnapshot,
      priorSnapshot: priorBySource.get(currentSnapshot.watchedSourceId) ?? null,
    })),
  };
}

/**
 * Index snapshots by `watchedSourceId`, retaining AT MOST ONE per source
 * (Requirement 11.1). Ties are broken toward the most recently created
 * snapshot so the result is deterministic regardless of input order.
 */
function indexMostRecentBySource(rows: Snapshot[]): Map<string, Snapshot> {
  const bySource = new Map<string, Snapshot>();
  for (const row of rows) {
    const existing = bySource.get(row.watchedSourceId);
    if (existing === undefined || row.createdAt > existing.createdAt) {
      bySource.set(row.watchedSourceId, row);
    }
  }
  return bySource;
}

/** Boundary schema for the step's output: at least the ids the diff step needs. */
const SnapshotRefSchema = z
  .object({ id: z.string().min(1), watchedSourceId: z.string().min(1) })
  .passthrough();

const FindPreviousSnapshotDataSchema = z.object({
  priorScanId: z.string().min(1).nullable(),
  pairings: z.array(
    z.object({
      watchedSourceId: z.string().min(1),
      currentSnapshot: SnapshotRefSchema,
      priorSnapshot: SnapshotRefSchema.nullable(),
    }),
  ),
});

/**
 * Run {@link findPreviousSnapshotStep} against the shared workflow context.
 *
 * Reads the current scan's persisted snapshots through the workspace-scoped
 * repository (Requirements 1.4, 21.7), resolves the most-recent-completed
 * earlier scan, and returns one pairing per current snapshot. Persists the
 * `diffing` status before returning so the timeline advances (Requirement 7.2),
 * and validates its output at the boundary (Requirement 23.6).
 */
export async function findPreviousSnapshotStep(
  ctx: ScanWorkflowContext,
): Promise<FindPreviousSnapshotData> {
  // Steps 6–7 map to the `diffing` status (design step table). Persist before
  // emitting any progress (Requirement 7.2).
  await setScanStatus(ctx, "diffing");

  const repo = scopedRepo(ctx);
  const currentSnapshots = await repo.snapshots.listForScan(ctx.scanId);

  const data = await selectPriorSnapshots(repo.scans, repo.snapshots, {
    companyId: ctx.companyId,
    before: ctx.scanCreatedAt,
    currentSnapshots,
  });

  // Validate the output shape at the boundary (Requirement 23.6) without
  // discarding the precise `Snapshot` typing of `data`.
  parseAtBoundary(
    FindPreviousSnapshotDataSchema,
    data,
    "findPreviousSnapshotStep output",
  );
  return data;
}
