import { describe, expect, it } from "vitest";

import {
  createDemoInsForgeClient,
  DEMO_LATEST_SCAN_ID,
  DEMO_WORKSPACE_ID,
} from "@/lib/adapters/insforge/demo-store";
import { createDemoBoxClient } from "@/lib/adapters/box/demo";

import { shapeScanDetail, type ScanDetailRows } from "./scan-detail";

/**
 * Integration test for the `GET /api/scans/:id` data path against the REAL
 * in-memory demo store + demo Box client (no mocks). This exercises the same
 * workspace-scoped reads + pure shaping the route performs, and the
 * cross-workspace 404 (scope → null) behavior (Requirements 21.5, 21.7).
 */

/** Read the scope-checked rows the route reads, then shape them. */
async function loadScanDetail(workspaceId: string, scanId: string) {
  const insforge = createDemoInsForgeClient();
  const repo = insforge.scoped(workspaceId);

  const scan = await repo.scans.get(scanId);
  if (!scan) {
    return { notFound: true as const };
  }

  const [snapshots, diffs, claims, verdict] = await Promise.all([
    repo.snapshots.listForScan(scanId),
    repo.diffs.listForScan(scanId),
    repo.claims.listForScan(scanId),
    repo.verdicts.getForScan(scanId),
  ]);

  const rows: ScanDetailRows = { scan, snapshots, diffs, claims, verdict };
  const box = createDemoBoxClient();
  return {
    notFound: false as const,
    payload: shapeScanDetail(rows, {
      folderWebLink: (id) => box.folderWebLink(id),
      boxSimulated: box.mode === "demo",
    }),
  };
}

describe("GET /api/scans/:id data path (demo store)", () => {
  it("returns the seeded Acme AI scan with snapshots, diffs, claims, verdict, and Box artifacts", async () => {
    const result = await loadScanDetail(DEMO_WORKSPACE_ID, DEMO_LATEST_SCAN_ID);
    expect(result.notFound).toBe(false);
    if (result.notFound) return;

    const { payload } = result;

    expect(payload.scan.id).toBe(DEMO_LATEST_SCAN_ID);
    expect(payload.scan.status).toBe("completed");
    expect(payload.scan.boxScanFolderId).toContain("mock-folder");

    expect(payload.snapshots).toHaveLength(4);
    expect(payload.diffs.length).toBeGreaterThan(0);
    expect(payload.claims.length).toBeGreaterThan(0);

    // Seeded deterministic verdict.
    expect(payload.verdict?.strategyPrediction).toBe("moving_upmarket");
    expect(payload.verdict?.confidence).toBe(82);

    // Box evidence folder link is derived for BoxEvidenceLink and marked simulated.
    expect(payload.evidenceFolder?.simulated).toBe(true);
    expect(payload.evidenceFolder?.url).toContain("box");

    // At least one flattened evidence artifact entry exists for EvidenceArtifactList.
    expect(payload.artifacts.length).toBeGreaterThan(0);
    // No internal workspaceId leaks into the payload.
    expect(payload.scan).not.toHaveProperty("workspaceId");
  });

  it("treats a scan in another workspace as not found (no leakage)", async () => {
    const result = await loadScanDetail("some-other-workspace", DEMO_LATEST_SCAN_ID);
    expect(result.notFound).toBe(true);
  });

  it("treats an unknown scan id as not found", async () => {
    const result = await loadScanDetail(DEMO_WORKSPACE_ID, "does-not-exist");
    expect(result.notFound).toBe(true);
  });
});
