import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_COMPANY_ID,
  DEMO_LATEST_SCAN_ID,
} from "@/lib/adapters/insforge/demo-store";

import { GET } from "./route";

/**
 * Tests for `GET /api/scans/:id` (Requirement 21.5) and its scope-check / 404
 * behavior (Requirements 1.5, 21.7).
 *
 * These exercise the REAL `requireActiveWorkspace` guard + the seeded demo
 * InsForge repository + the demo Box client (no mocks): with `DEMO_MODE=true`,
 * `resolveActiveWorkspace()` resolves the single default demo workspace, and the
 * store is pre-seeded with the Acme AI scan {@link DEMO_LATEST_SCAN_ID} whose
 * status is `completed` with snapshots, diffs, classified claims, the
 * deterministic "Moving upmarket"/82 verdict, and mock Box artifacts.
 */

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

beforeEach(() => {
  process.env.DEMO_MODE = "true";
});

afterEach(() => {
  if (ORIGINAL_DEMO_MODE === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  }
});

function getScan(id: string): Promise<Response> {
  return GET(new Request(`http://test/api/scans/${id}`), { params: { id } });
}

describe("GET /api/scans/:id", () => {
  it("returns the scan status, snapshots, diffs, claims, verdict, and Box artifacts (Req 21.5)", async () => {
    const res = await getScan(DEMO_LATEST_SCAN_ID);
    expect(res.status).toBe(200);

    const body = await res.json();

    // Scan status + lifecycle + Box scan folder id (for BoxEvidenceLink).
    expect(body.scan.id).toBe(DEMO_LATEST_SCAN_ID);
    expect(body.scan.companyId).toBe(DEMO_COMPANY_ID);
    expect(body.scan.status).toBe("completed");
    expect(typeof body.scan.boxScanFolderId).toBe("string");
    // No internal workspaceId leaks into the payload.
    expect(body.scan).not.toHaveProperty("workspaceId");

    // Snapshots carry the three Box artifact references.
    expect(Array.isArray(body.snapshots)).toBe(true);
    expect(body.snapshots.length).toBeGreaterThan(0);
    expect(body.snapshots[0]).toHaveProperty("artifacts.raw");
    expect(body.snapshots[0]).toHaveProperty("artifacts.normalized");
    expect(body.snapshots[0]).toHaveProperty("artifacts.screenshot");

    // Diffs + claims present.
    expect(body.diffs.length).toBeGreaterThan(0);
    expect(body.claims.length).toBeGreaterThan(0);

    // Deterministic seeded verdict.
    expect(body.verdict.strategyPrediction).toBe("moving_upmarket");
    expect(body.verdict.confidence).toBe(82);

    // Evidence folder link + flattened artifact list for the UI.
    expect(body.evidenceFolder).not.toBeNull();
    expect(typeof body.evidenceFolder.url).toBe("string");
    expect(body.evidenceFolder.simulated).toBe(true);
    expect(Array.isArray(body.artifacts)).toBe(true);
    expect(body.artifacts.length).toBeGreaterThan(0);
  });

  it("returns 404 NOT_FOUND for a scan outside the active workspace, leaking no attributes (Req 1.5/21.7)", async () => {
    const res = await getScan("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    // Only the error envelope is present — no scan/snapshots/etc. leak.
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body).not.toHaveProperty("scan");
    expect(body).not.toHaveProperty("snapshots");
  });

  it("returns 404 NOT_FOUND for an unknown scan id", async () => {
    const res = await getScan("does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
