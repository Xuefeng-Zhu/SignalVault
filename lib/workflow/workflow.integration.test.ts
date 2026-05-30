/**
 * End-to-end integration test for the SignalVault scan workflow in Demo Mode.
 *
 * Runs `runSignalVaultScanWorkflow` for the seeded "Dropbox" demo company and
 * asserts it reaches `completed` with the deterministic "Moving upmarket"
 * verdict at 82% confidence, and that all evidence artifacts are recorded.
 *
 * Requirements: 18.3, 18.5, 18.7
 */
import { describe, expect, it } from "vitest";

import { DemoApifyClient } from "@/lib/adapters/apify/demo";
import { createDemoBoxClient } from "@/lib/adapters/box/demo";
import {
  DemoInsForgeClient,
  DEMO_COMPANY_ID,
  DEMO_WORKSPACE_ID,
} from "@/lib/adapters/insforge/demo-store";
import { createDemoModelClient } from "@/lib/adapters/model/demo";
import type { AdapterSet } from "@/lib/adapters/factory-core";
import { DEMO_CONFIDENCE, DEMO_STRATEGY_PREDICTION } from "@/lib/demo";

import { runSignalVaultScanWorkflow } from "./workflow";

describe("signalVaultScanWorkflow — Demo Mode end-to-end", () => {
  it("reaches completed with the seeded Dropbox verdict (Req 18.3, 18.5)", async () => {
    // Build a fresh demo InsForge client with the seeded Dropbox company.
    const insforge = new DemoInsForgeClient({ seedDemoCompany: true });

    const adapters: AdapterSet = {
      apify: new DemoApifyClient(),
      box: createDemoBoxClient(),
      insforge,
      model: createDemoModelClient(),
    };

    // Create a new queued scan for Dropbox in the demo workspace.
    const repo = insforge.scoped(DEMO_WORKSPACE_ID);
    const scanRows = await repo.scans.create([
      {
        companyId: DEMO_COMPANY_ID,
        triggerType: "test",
        status: "queued",
      },
    ]);
    const scan = scanRows[0];
    expect(scan).toBeDefined();

    // Load the watched sources to build the URL list.
    const sources = await repo.companies.listSources(DEMO_COMPANY_ID);
    expect(sources.length).toBeGreaterThanOrEqual(3);

    const urls = sources.slice(0, 5).map((s) => ({
      url: s.url,
      pageRole: s.sourceType,
    }));

    const input = {
      scanId: scan.id,
      companyId: DEMO_COMPANY_ID,
      companyName: "Dropbox",
      companySlug: "dropbox",
      workspaceId: DEMO_WORKSPACE_ID,
      urls,
      mode: "demo" as const,
    };

    // Run the full workflow.
    const result = await runSignalVaultScanWorkflow(input, adapters);

    // The workflow must succeed.
    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow type

    const data = result.data;

    // The scan must be marked `completed` in the DB.
    const updatedScan = await repo.scans.get(scan.id);
    expect(updatedScan?.status).toBe("completed");

    // The verdict must be the deterministic "Moving upmarket" at 82%.
    expect(data.verdict).not.toBeNull();
    expect(data.verdict?.strategyPrediction).toBe(DEMO_STRATEGY_PREDICTION);
    expect(data.verdict?.confidence).toBe(DEMO_CONFIDENCE);

    // Evidence must be recorded.
    expect(data.data.snapshotCount).toBeGreaterThan(0);

    // The result must carry the correct scanId.
    expect(data.scanId).toBe(scan.id);
  }, 30_000);

  it("workflow input validation rejects invalid input (Req 23.2)", async () => {
    const insforge = new DemoInsForgeClient({ seedDemoCompany: false });
    const adapters: AdapterSet = {
      apify: new DemoApifyClient(),
      box: createDemoBoxClient(),
      insforge,
      model: createDemoModelClient(),
    };

    // Missing required fields.
    const result = await runSignalVaultScanWorkflow({ notValid: true }, adapters);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("validation");
    }
  });
});
