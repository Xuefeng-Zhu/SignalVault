import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_COMPANY_ID } from "@/lib/adapters/insforge/demo-store";

import { GET } from "./route";

/**
 * Tests for `GET /api/companies/:id` (Requirement 21.2) and its scope-check /
 * 404 behavior (Requirements 1.5, 21.7).
 *
 * These exercise the REAL guard + the seeded demo InsForge repository (no
 * mocks): with `DEMO_MODE=true`, `resolveActiveWorkspace()` resolves the single
 * default demo workspace, and the demo store is pre-seeded with the Demo_Company
 * "Acme AI" (id {@link DEMO_COMPANY_ID}) whose most recent scan is `completed`
 * with the deterministic "Moving upmarket"/82 verdict and classified claims.
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

function getCompany(id: string): Promise<Response> {
  return GET(new Request(`http://test/api/companies/${id}`), {
    params: { id },
  });
}

describe("GET /api/companies/:id", () => {
  it("returns the company, its sources, and the latest completed scan with verdict + claims", async () => {
    const res = await getCompany(DEMO_COMPANY_ID);
    expect(res.status).toBe(200);

    const body = await res.json();

    // Company + sources (Requirement 21.2).
    expect(body.company.id).toBe(DEMO_COMPANY_ID);
    expect(body.company.name).toBe("Acme AI");
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBeGreaterThan(0);
    for (const source of body.sources) {
      expect(source.companyId).toBe(DEMO_COMPANY_ID);
      expect(typeof source.url).toBe("string");
      expect(typeof source.sourceType).toBe("string");
    }

    // Most recent scan is completed → carries verdict + claims.
    expect(body.latestScan).toBeDefined();
    expect(body.latestScan.status).toBe("completed");
    expect(body.latestScan.verdict.strategyPrediction).toBe("moving_upmarket");
    expect(body.latestScan.verdict.confidence).toBe(82);
    expect(Array.isArray(body.latestScan.claims)).toBe(true);
    expect(body.latestScan.claims.length).toBeGreaterThan(0);
  });

  it("returns 404 NOT_FOUND for an id outside the active workspace, leaking no attributes", async () => {
    const res = await getCompany("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    // No resource attributes leak: only the error envelope is present.
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body).not.toHaveProperty("company");
    expect(body).not.toHaveProperty("sources");
  });
});
