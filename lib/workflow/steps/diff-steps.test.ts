import { describe, expect, it } from "vitest";

import type {
  BoxClient,
  BoxFolderSet,
  BoxUploadResult,
  DiffRepo,
  DiffRow,
  NewDiff,
  Scan,
  ScanRepo,
  Snapshot,
  SnapshotRepo,
} from "@/lib/adapters/types";
import { deserializeDiff } from "@/lib/diff";

import { selectPriorSnapshots } from "./find-previous-snapshot";
import { computeDiffs, type ComputeDiffDeps } from "./compute-diff";
import type { SnapshotPairing } from "./find-previous-snapshot";

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

function scan(id: string, createdAt: string, status: Scan["status"]): Scan {
  return {
    id,
    workspaceId: "ws-1",
    companyId: "co-1",
    status,
    triggerType: "manual",
    failureReason: null,
    boxScanFolderId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function snapshot(id: string, scanId: string, watchedSourceId: string, createdAt: string): Snapshot {
  return {
    id,
    scanId,
    watchedSourceId,
    simulated: false,
    createdAt,
  };
}

/** ScanRepo fake that returns the most recent completed scan before a cutoff. */
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

/** DiffRepo fake recording every created diff row. */
class FakeDiffRepo implements DiffRepo {
  readonly rows: DiffRow[] = [];
  private seq = 0;

  async create(rows: NewDiff[]): Promise<DiffRow[]> {
    return rows.map((row) => {
      this.seq += 1;
      const stored: DiffRow = {
        ...row,
        id: `diff-${this.seq}`,
        createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, this.seq)).toISOString(),
      };
      this.rows.push(stored);
      return stored;
    });
  }

  async listForScan(scanId: string): Promise<DiffRow[]> {
    return this.rows.filter((d) => d.scanId === scanId);
  }
}

/** Box fake recording diff uploads; can be forced to throw or simulate. */
class FakeBox {
  readonly uploads: { folderId: string; name: string; content: string }[] = [];
  throwOnUpload = false;
  simulated = false;
  private seq = 0;

  asClient(): BoxClient {
    const self = this;
    return {
      mode: "demo",
      isConfigured: () => false,
      async upload(
        folderId: string,
        _artifactType: string,
        name: string,
        content: Buffer | string,
      ): Promise<BoxUploadResult> {
        if (self.throwOnUpload) throw new Error("box upload failed");
        self.seq += 1;
        self.uploads.push({ folderId, name, content: String(content) });
        const fileId = `diff-file-${self.seq}`;
        return {
          fileId,
          folderId,
          url: `https://box.test/file/${fileId}`,
          key: `diff/${self.seq}/${name}`,
          simulated: self.simulated,
        };
      },
    } as unknown as BoxClient;
  }
}

const FOLDERS: BoxFolderSet = {
  scanFolderId: "folder-scan",
  subfolders: {
    raw: "folder-raw",
    normalized: "folder-normalized",
    screenshots: "folder-screenshots",
    diff: "folder-diffs",
    claim: "folder-claims",
    report: "folder-reports",
  },
  simulated: false,
};

/* -------------------------------------------------------------------------- */
/* selectPriorSnapshots (Requirements 11.1, 11.3)                             */
/* -------------------------------------------------------------------------- */

describe("selectPriorSnapshots (Requirements 11.1, 11.3)", () => {
  it("pairs each current snapshot with the prior from the most recent completed earlier scan", async () => {
    const scans = [
      scan("scan-old", "2024-01-01T00:00:00.000Z", "completed"),
      scan("scan-mid", "2024-02-01T00:00:00.000Z", "completed"),
      scan("scan-cur", "2024-03-01T00:00:00.000Z", "scraping"),
    ];
    const priors = [
      snapshot("snap-old-a", "scan-old", "src-a", "2024-01-01T00:00:01.000Z"),
      snapshot("snap-mid-a", "scan-mid", "src-a", "2024-02-01T00:00:01.000Z"),
      snapshot("snap-mid-b", "scan-mid", "src-b", "2024-02-01T00:00:02.000Z"),
    ];
    const current = [
      snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z"),
      snapshot("snap-cur-b", "scan-cur", "src-b", "2024-03-01T00:00:02.000Z"),
    ];

    const result = await selectPriorSnapshots(
      fakeScanRepo(scans),
      fakeSnapshotRepo(priors),
      { companyId: "co-1", before: "2024-03-01T00:00:00.000Z", currentSnapshots: current },
    );

    // The most-recent completed earlier scan is scan-mid, not scan-old.
    expect(result.priorScanId).toBe("scan-mid");
    const bySource = new Map(result.pairings.map((p) => [p.watchedSourceId, p]));
    expect(bySource.get("src-a")?.priorSnapshot?.id).toBe("snap-mid-a");
    expect(bySource.get("src-b")?.priorSnapshot?.id).toBe("snap-mid-b");
  });

  it("marks every source as baseline when there is no earlier completed scan", async () => {
    const scans = [scan("scan-cur", "2024-03-01T00:00:00.000Z", "scraping")];
    const current = [snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z")];

    const result = await selectPriorSnapshots(
      fakeScanRepo(scans),
      fakeSnapshotRepo([]),
      { companyId: "co-1", before: "2024-03-01T00:00:00.000Z", currentSnapshots: current },
    );

    expect(result.priorScanId).toBeNull();
    expect(result.pairings[0]?.priorSnapshot).toBeNull();
  });

  it("selects at most one prior snapshot per source, preferring the most recent", async () => {
    const scans = [scan("scan-prev", "2024-02-01T00:00:00.000Z", "completed")];
    // Two prior snapshots for the same source within the prior scan.
    const priors = [
      snapshot("snap-prev-a1", "scan-prev", "src-a", "2024-02-01T00:00:01.000Z"),
      snapshot("snap-prev-a2", "scan-prev", "src-a", "2024-02-01T00:00:09.000Z"),
    ];
    const current = [snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z")];

    const result = await selectPriorSnapshots(
      fakeScanRepo(scans),
      fakeSnapshotRepo(priors),
      { companyId: "co-1", before: "2024-03-01T00:00:00.000Z", currentSnapshots: current },
    );

    const pairing = result.pairings[0];
    expect(pairing?.priorSnapshot?.id).toBe("snap-prev-a2");
  });
});

/* -------------------------------------------------------------------------- */
/* computeDiffs (Requirements 11.2, 11.3, 11.5, 11.6, 12.5)                   */
/* -------------------------------------------------------------------------- */

function deps(diffs: DiffRepo, box: BoxClient, content: Record<string, string>): ComputeDiffDeps {
  return {
    scanId: "scan-cur",
    diffs,
    box,
    boxFolders: FOLDERS,
    resolveNormalizedContent: async (snap) => content[snap.id] ?? null,
  };
}

function pairing(
  watchedSourceId: string,
  current: Snapshot,
  prior: Snapshot | null,
): SnapshotPairing {
  return { watchedSourceId, currentSnapshot: current, priorSnapshot: prior };
}

describe("computeDiffs (Requirements 11.2, 11.3, 11.5)", () => {
  it("computes, persists, serializes, and uploads a diff for a source with a prior snapshot", async () => {
    const diffRepo = new FakeDiffRepo();
    const box = new FakeBox();
    const prior = snapshot("snap-prev-a", "scan-prev", "src-a", "2024-02-01T00:00:01.000Z");
    const current = snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z");

    const { data } = await computeDiffs(
      deps(diffRepo, box.asClient(), {
        "snap-prev-a": "# Pricing\n\n$10 per seat",
        "snap-cur-a": "# Pricing\n\n$25 per seat",
      }),
      [pairing("src-a", current, prior)],
    );

    expect(data.diffs).toHaveLength(1);
    expect(data.baselines).toHaveLength(0);

    const computed = data.diffs[0]!;
    // change_score is an integer in [0, 100], > 0 for changed content (Req 11.2).
    expect(Number.isInteger(computed.diff.changeScore)).toBe(true);
    expect(computed.diff.changeScore).toBeGreaterThan(0);
    expect(computed.diff.changeScore).toBeLessThanOrEqual(100);
    expect(computed.diff.priorSnapshotId).toBe("snap-prev-a");
    expect(computed.diff.currentSnapshotId).toBe("snap-cur-a");

    // Persisted as a diff record (Req 11.2) with the diff box file id (Req 11.5).
    expect(diffRepo.rows).toHaveLength(1);
    expect(computed.artifactUploaded).toBe(true);
    expect(computed.diff.diffBoxFileId).toBe("diff-file-1");

    // The report was uploaded to the diffs/ subfolder and round-trips (Req 11.5, 12).
    expect(box.uploads).toHaveLength(1);
    expect(box.uploads[0]!.folderId).toBe("folder-diffs");
    const roundTripped = deserializeDiff(box.uploads[0]!.content);
    expect(roundTripped.currentSnapshotId).toBe("snap-cur-a");
    expect(roundTripped.changeScore).toBe(computed.diff.changeScore);
  });

  it("records a baseline and stores no diff when there is no prior snapshot (Req 11.3)", async () => {
    const diffRepo = new FakeDiffRepo();
    const box = new FakeBox();
    const current = snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z");

    const { data, acc } = await computeDiffs(
      deps(diffRepo, box.asClient(), { "snap-cur-a": "# Pricing\n\n$25 per seat" }),
      [pairing("src-a", current, null)],
    );

    expect(data.diffs).toHaveLength(0);
    expect(data.baselines).toEqual([
      { watchedSourceId: "src-a", currentSnapshotId: "snap-cur-a" },
    ]);
    expect(diffRepo.rows).toHaveLength(0);
    expect(box.uploads).toHaveLength(0);
    expect(acc.warnings.some((w) => w.includes("baseline"))).toBe(true);
  });
});

describe("computeDiffs resilience (Requirements 11.6, 12.5)", () => {
  it("excludes a source whose diff cannot be computed and continues with the rest (Req 11.6)", async () => {
    const diffRepo = new FakeDiffRepo();
    const box = new FakeBox();
    const priorA = snapshot("snap-prev-a", "scan-prev", "src-a", "2024-02-01T00:00:01.000Z");
    const currentA = snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z");
    const priorB = snapshot("snap-prev-b", "scan-prev", "src-b", "2024-02-01T00:00:02.000Z");
    const currentB = snapshot("snap-cur-b", "scan-cur", "src-b", "2024-03-01T00:00:02.000Z");

    // src-a's prior content is missing -> resolver returns null -> recoverable failure.
    const { data, acc } = await computeDiffs(
      deps(diffRepo, box.asClient(), {
        "snap-cur-a": "current a",
        "snap-prev-b": "prior b",
        "snap-cur-b": "current b changed",
      }),
      [pairing("src-a", currentA, priorA), pairing("src-b", currentB, priorB)],
    );

    // src-a excluded; src-b still computed (Req 11.6).
    expect(data.diffs.map((d) => d.watchedSourceId)).toEqual(["src-b"]);
    expect(diffRepo.rows).toHaveLength(1);
    expect(acc.warnings.some((w) => w.includes("Failed to compute the diff"))).toBe(true);
  });

  it("omits the diff report artifact but keeps the diff record when upload/serialize fails (Req 12.5)", async () => {
    const diffRepo = new FakeDiffRepo();
    const box = new FakeBox();
    box.throwOnUpload = true;
    const prior = snapshot("snap-prev-a", "scan-prev", "src-a", "2024-02-01T00:00:01.000Z");
    const current = snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z");

    const { data, acc } = await computeDiffs(
      deps(diffRepo, box.asClient(), {
        "snap-prev-a": "prior content",
        "snap-cur-a": "current content changed",
      }),
      [pairing("src-a", current, prior)],
    );

    // The diff record is still stored (Req 11.6 not triggered), but the artifact
    // is omitted and its box file id is absent (Req 12.5).
    expect(data.diffs).toHaveLength(1);
    expect(diffRepo.rows).toHaveLength(1);
    expect(data.diffs[0]!.artifactUploaded).toBe(false);
    expect(data.diffs[0]!.diff.diffBoxFileId).toBeNull();
    expect(acc.warnings.some((w) => w.includes("omitted"))).toBe(true);
  });

  it("surfaces a simulated-storage warning when the diff artifact is stored via mock Box", async () => {
    const diffRepo = new FakeDiffRepo();
    const box = new FakeBox();
    box.simulated = true;
    const prior = snapshot("snap-prev-a", "scan-prev", "src-a", "2024-02-01T00:00:01.000Z");
    const current = snapshot("snap-cur-a", "scan-cur", "src-a", "2024-03-01T00:00:01.000Z");

    const { acc } = await computeDiffs(
      deps(diffRepo, box.asClient(), {
        "snap-prev-a": "prior content",
        "snap-cur-a": "current content changed",
      }),
      [pairing("src-a", current, prior)],
    );

    expect(acc.warnings.some((w) => w.includes("simulated"))).toBe(true);
  });
});
