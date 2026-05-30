import { describe, expect, it } from "vitest";

import type {
  ClaimRow,
  DiffRow,
  Scan,
  Snapshot,
  VerdictRow,
} from "@/lib/adapters/types";

import { shapeScanDetail, type ScanDetailRows } from "./scan-detail";

function makeScan(overrides: Partial<Scan> = {}): Scan {
  return {
    id: "scan-1",
    workspaceId: "ws-1",
    companyId: "co-1",
    status: "completed",
    triggerType: "manual",
    failureReason: null,
    boxScanFolderId: "box-folder-1",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:05:00Z",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "snap-1",
    scanId: "scan-1",
    watchedSourceId: "src-1",
    rawArtifactUrl: "https://box/raw",
    rawArtifactKey: "raw-key",
    rawBoxFileId: "box-raw-1",
    normalizedArtifactUrl: "https://box/norm",
    normalizedArtifactKey: "norm-key",
    normalizedBoxFileId: "box-norm-1",
    screenshotArtifactUrl: null,
    screenshotArtifactKey: null,
    screenshotBoxFileId: null,
    contentHash: "hash-raw",
    normalizedTextHash: "hash-norm",
    simulated: false,
    createdAt: "2024-01-01T00:01:00Z",
    ...overrides,
  };
}

function makeDiff(overrides: Partial<DiffRow> = {}): DiffRow {
  return {
    id: "diff-1",
    scanId: "scan-1",
    priorSnapshotId: "snap-0",
    currentSnapshotId: "snap-1",
    changeScore: 42,
    changeSummary: "Pricing changed",
    addedText: "added",
    removedText: "removed",
    modifiedSections: [{ heading: "Pricing", before: "$10", after: "$20" }],
    diffBoxFileId: "box-diff-1",
    createdAt: "2024-01-01T00:02:00Z",
    ...overrides,
  };
}

function makeClaim(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    id: "claim-1",
    scanId: "scan-1",
    snapshotId: "snap-1",
    claimType: "pricing",
    statementText: "We raised prices",
    evidenceText: "$20/mo",
    confidence: 0.9,
    claimStatus: "new",
    riskLevel: "medium",
    createdAt: "2024-01-01T00:03:00Z",
    ...overrides,
  };
}

function makeVerdict(overrides: Partial<VerdictRow> = {}): VerdictRow {
  return {
    id: "verdict-1",
    scanId: "scan-1",
    workspaceId: "ws-1",
    strategyPrediction: "moving_upmarket",
    confidence: 82,
    riskScore: 40,
    recommendedActions: ["Watch pricing"],
    keyEvidence: ["Higher prices"],
    counterEvidence: [],
    isFallback: false,
    createdAt: "2024-01-01T00:04:00Z",
    ...overrides,
  };
}

describe("shapeScanDetail", () => {
  it("shapes scan + snapshots + diffs + claims + verdict with Box artifact fields", () => {
    const rows: ScanDetailRows = {
      scan: makeScan(),
      snapshots: [makeSnapshot()],
      diffs: [makeDiff()],
      claims: [makeClaim()],
      verdict: makeVerdict(),
    };

    const out = shapeScanDetail(rows, {
      folderWebLink: (id) => `https://box.app/folder/${id}`,
      boxSimulated: false,
    });

    // Scan lifecycle + Box scan folder id.
    expect(out.scan).toMatchObject({
      id: "scan-1",
      companyId: "co-1",
      status: "completed",
      failureReason: null,
      boxScanFolderId: "box-folder-1",
    });
    // workspaceId is internal and must not leak into the payload.
    expect(out.scan).not.toHaveProperty("workspaceId");

    // Snapshot carries raw/normalized/screenshot url+key+boxFileId.
    expect(out.snapshots[0]!.artifacts.raw).toEqual({
      url: "https://box/raw",
      key: "raw-key",
      boxFileId: "box-raw-1",
    });
    expect(out.snapshots[0]!.artifacts.screenshot).toEqual({
      url: null,
      key: null,
      boxFileId: null,
    });

    // Diff carries diffBoxFileId and computed fields.
    expect(out.diffs[0]).toMatchObject({
      changeScore: 42,
      diffBoxFileId: "box-diff-1",
      currentSnapshotId: "snap-1",
    });

    // Claim + verdict pass through.
    expect(out.claims[0]).toMatchObject({ claimStatus: "new", riskLevel: "medium" });
    expect(out.verdict).toMatchObject({ strategyPrediction: "moving_upmarket", confidence: 82 });

    // Evidence folder link derived from boxScanFolderId.
    expect(out.evidenceFolder).toEqual({
      boxFolderId: "box-folder-1",
      url: "https://box.app/folder/box-folder-1",
      simulated: false,
    });
  });

  it("flattens one artifact entry per stored artifact (raw, normalized, diff)", () => {
    const out = shapeScanDetail({
      scan: makeScan(),
      snapshots: [makeSnapshot()],
      diffs: [makeDiff()],
      claims: [],
      verdict: null,
    });

    const types = out.artifacts.map((a) => a.type).sort();
    // raw + normalized (screenshot is null) + diff
    expect(types).toEqual(["diff", "normalized", "raw"]);
    const raw = out.artifacts.find((a) => a.type === "raw");
    expect(raw).toMatchObject({ boxUrl: "https://box/raw", fileId: "box-raw-1" });
  });

  it("omits artifacts with no Box location and returns null evidenceFolder/verdict when absent", () => {
    const bareSnapshot = makeSnapshot({
      rawArtifactUrl: null,
      rawArtifactKey: null,
      rawBoxFileId: null,
      normalizedArtifactUrl: null,
      normalizedArtifactKey: null,
      normalizedBoxFileId: null,
    });

    const out = shapeScanDetail({
      scan: makeScan({ boxScanFolderId: null, failureReason: "boom", status: "failed" }),
      snapshots: [bareSnapshot],
      diffs: [makeDiff({ diffBoxFileId: null })],
      claims: [],
      verdict: null,
    });

    expect(out.artifacts).toEqual([]);
    expect(out.evidenceFolder).toBeNull();
    expect(out.verdict).toBeNull();
    expect(out.scan.failureReason).toBe("boom");
    expect(out.scan.status).toBe("failed");
  });

  it("falls back to the raw folder id when no folderWebLink is supplied", () => {
    const out = shapeScanDetail({
      scan: makeScan({ boxScanFolderId: "mock-folder" }),
      snapshots: [],
      diffs: [],
      claims: [],
      verdict: null,
    });
    expect(out.evidenceFolder).toEqual({
      boxFolderId: "mock-folder",
      url: "mock-folder",
      simulated: false,
    });
  });
});
