// Feature: signalvault, Property 15: Prior snapshot selection picks the most recent earlier completed scan
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Scan, ScanRepo, Snapshot, SnapshotRepo } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { selectPriorSnapshots } from "./find-previous-snapshot";

/**
 * Property 15 (Validates: Requirements 11.1):
 *
 * For ANY company scan history, `selectPriorSnapshots` must, for each watched
 * source, select AT MOST ONE prior snapshot, and that snapshot must belong to
 * the MOST RECENTLY COMPLETED scan STRICTLY EARLIER than the current scan
 * (cutoff `before`). If no such scan exists, no prior snapshot is selected and
 * every pairing is a baseline (`priorSnapshot === null`).
 *
 * Strategy:
 *  - Generate a set of scans for one company with DISTINCT `createdAt`
 *    timestamps (so "most recent" is well defined) and a mix of `completed`
 *    and non-completed statuses, plus a current-scan cutoff `before`.
 *  - Generate prior snapshots distributed across those scans and a few sources,
 *    with DISTINCT snapshot timestamps (so the per-source tie-break is well
 *    defined), and a set of current snapshots over a few sources.
 *  - Build fakes mirroring `ScanRepo.mostRecentCompleted` (latest `completed`
 *    scan with `createdAt < before`) and `SnapshotRepo.listForScan`.
 *  - Independently recompute the expected prior scan and the expected
 *    per-source prior snapshot from the generated data and compare.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/* -------------------------------------------------------------------------- */
/* Builders + fakes (adapted from diff-steps.test.ts)                         */
/* -------------------------------------------------------------------------- */

const COMPANY_ID = "co-1";
const SOURCES = ["src-a", "src-b", "src-c", "src-d"] as const;

/** Scan timestamps: distinct minute offsets from a fixed base (comparable to `before`). */
const SCAN_BASE_MS = Date.UTC(2024, 0, 1, 0, 0, 0);
/** Snapshot timestamps: distinct second offsets from a different base (only their relative order matters). */
const SNAP_BASE_MS = Date.UTC(2023, 0, 1, 0, 0, 0);

function scanIso(offsetMinutes: number): string {
  return new Date(SCAN_BASE_MS + offsetMinutes * 60_000).toISOString();
}

function snapIso(offsetSeconds: number): string {
  return new Date(SNAP_BASE_MS + offsetSeconds * 1_000).toISOString();
}

function scan(id: string, createdAt: string, status: Scan["status"]): Scan {
  return {
    id,
    workspaceId: "ws-1",
    companyId: COMPANY_ID,
    status,
    triggerType: "manual",
    failureReason: null,
    boxScanFolderId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function snapshot(id: string, scanId: string, watchedSourceId: string, createdAt: string): Snapshot {
  return { id, scanId, watchedSourceId, simulated: false, createdAt };
}

/** ScanRepo fake: most recent `completed` scan for the company before a cutoff. */
function fakeScanRepo(scans: Scan[]): ScanRepo {
  return {
    async mostRecentCompleted(companyId: string, before?: string): Promise<Scan | null> {
      const candidates = scans
        .filter(
          (s) =>
            s.companyId === companyId &&
            s.status === "completed" &&
            (before === undefined || s.createdAt < before),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return candidates[0] ?? null;
    },
  } as unknown as ScanRepo;
}

/** SnapshotRepo fake backed by a flat list, filtered by scan. */
function fakeSnapshotRepo(snapshots: Snapshot[]): SnapshotRepo {
  return {
    async listForScan(scanId: string): Promise<Snapshot[]> {
      return snapshots.filter((s) => s.scanId === scanId);
    },
  } as unknown as SnapshotRepo;
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/** Mix of completed and non-completed statuses, biased so priors are common. */
const statusArb: fc.Arbitrary<Scan["status"]> = fc.constantFrom(
  "completed",
  "completed",
  "completed",
  "scraping",
  "failed",
  "queued",
  "uploading",
  "diffing",
  "analyzing",
);

interface World {
  scanSpecs: { offset: number; status: Scan["status"] }[];
  before: number;
  snapSpecs: { snapOffset: number; scanIndex: number; source: string }[];
  currentSources: string[];
  currentBaseOffset: number;
}

const worldArb: fc.Arbitrary<World> = fc
  .uniqueArray(
    fc.record({
      offset: fc.integer({ min: 0, max: 3_000 }),
      status: statusArb,
    }),
    { selector: (s) => s.offset, minLength: 1, maxLength: 8 },
  )
  .chain((scanSpecs) =>
    fc.record({
      scanSpecs: fc.constant(scanSpecs),
      // Cutoff anywhere in the scan range so both "prior found" and "no prior"
      // (baseline) cases are exercised; strict `<` handles any tie with a scan.
      before: fc.integer({ min: 0, max: 3_000 }),
      // Distinct snapshot offsets => distinct, well-ordered snapshot timestamps.
      snapSpecs: fc.uniqueArray(
        fc.record({
          snapOffset: fc.integer({ min: 0, max: 100_000 }),
          scanIndex: fc.integer({ min: 0, max: scanSpecs.length - 1 }),
          source: fc.constantFrom(...SOURCES),
        }),
        { selector: (s) => s.snapOffset, minLength: 0, maxLength: 24 },
      ),
      currentSources: fc.uniqueArray(fc.constantFrom(...SOURCES), {
        minLength: 1,
        maxLength: SOURCES.length,
      }),
      currentBaseOffset: fc.integer({ min: 0, max: 1_000 }),
    }),
  );

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe("Property 15: prior snapshot selection (Requirements 11.1)", () => {
  it("selects at most one prior snapshot per source from the most recently completed earlier scan", async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async (world) => {
        const beforeIso = scanIso(world.before);

        const scans = world.scanSpecs.map((s, i) => scan(`scan-${i}`, scanIso(s.offset), s.status));
        const priorSnapshots = world.snapSpecs.map((sp) =>
          snapshot(`snap-${sp.snapOffset}`, `scan-${sp.scanIndex}`, sp.source, snapIso(sp.snapOffset)),
        );
        const currentSnapshots = world.currentSources.map((src, i) =>
          snapshot(`cur-${i}`, "scan-current", src, snapIso(200_000 + world.currentBaseOffset + i)),
        );

        // --- Independently compute the expected prior scan from the generated data ---
        // The latest `completed` scan whose createdAt is STRICTLY earlier than `before`.
        const expectedPrior = scans
          .filter((s) => s.status === "completed" && s.createdAt < beforeIso)
          .reduce<Scan | null>(
            (best, s) => (best === null || s.createdAt > best.createdAt ? s : best),
            null,
          );

        // --- Independently compute the expected prior snapshot per source ---
        // At most one per source: the most recently created snapshot of the
        // expected prior scan for that source.
        const expectedBySource = new Map<string, Snapshot>();
        if (expectedPrior !== null) {
          for (const snap of priorSnapshots.filter((s) => s.scanId === expectedPrior.id)) {
            const existing = expectedBySource.get(snap.watchedSourceId);
            if (existing === undefined || snap.createdAt > existing.createdAt) {
              expectedBySource.set(snap.watchedSourceId, snap);
            }
          }
        }

        const result = await selectPriorSnapshots(
          fakeScanRepo(scans),
          fakeSnapshotRepo(priorSnapshots),
          { companyId: COMPANY_ID, before: beforeIso, currentSnapshots },
        );

        // (1) priorScanId is the most-recent completed earlier scan, or null.
        expect(result.priorScanId).toBe(expectedPrior?.id ?? null);

        // One pairing per current snapshot.
        expect(result.pairings.length).toBe(currentSnapshots.length);

        const scanById = new Map(scans.map((s) => [s.id, s]));
        const priorIdBySource = new Map<string, string>();
        const usedPriorIds = new Set<string>();

        for (const pairing of result.pairings) {
          // (2) AT MOST ONE prior snapshot per pairing: a single value, never an array.
          expect(Array.isArray(pairing.priorSnapshot)).toBe(false);

          const expectedSnap = expectedBySource.get(pairing.watchedSourceId) ?? null;
          expect(pairing.priorSnapshot?.id ?? null).toBe(expectedSnap?.id ?? null);

          if (pairing.priorSnapshot !== null) {
            // The selected prior belongs to the chosen prior scan and matches the source.
            expect(pairing.priorSnapshot.scanId).toBe(result.priorScanId);
            expect(pairing.priorSnapshot.watchedSourceId).toBe(pairing.watchedSourceId);

            // (3) The prior comes from a `completed` scan STRICTLY earlier than `before`.
            const owner = scanById.get(pairing.priorSnapshot.scanId);
            expect(owner?.status).toBe("completed");
            expect(owner !== undefined && owner.createdAt < beforeIso).toBe(true);

            // At most one prior per source: same source always resolves to the same prior.
            const seen = priorIdBySource.get(pairing.watchedSourceId);
            if (seen !== undefined) {
              expect(seen).toBe(pairing.priorSnapshot.id);
            }
            priorIdBySource.set(pairing.watchedSourceId, pairing.priorSnapshot.id);
            usedPriorIds.add(pairing.priorSnapshot.id);
          }
        }

        // No more distinct priors than distinct sources => at most one per source.
        const distinctSources = new Set(result.pairings.map((p) => p.watchedSourceId));
        expect(usedPriorIds.size).toBeLessThanOrEqual(distinctSources.size);

        // (4) Baseline: when there is no earlier completed scan, every pairing is null.
        if (expectedPrior === null) {
          expect(result.priorScanId).toBeNull();
          for (const pairing of result.pairings) {
            expect(pairing.priorSnapshot).toBeNull();
          }
        }
      }),
      pbtParams({ numRuns: PBT_MIN_RUNS }),
    );
  });
});
