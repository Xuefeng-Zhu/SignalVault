import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryInsForgeClient } from "@/tests/fixtures/in-memory-insforge";
import type { InsForgeClient, Scan } from "@/lib/adapters/types";

import { BaselineStateSchema, type ScanInitInput } from "../context";
import { CREATE_SCAN_STATUS, createScanCore } from "./create-scan";
import { makeStepDeps } from "./test-helpers";

/**
 * Unit tests for `createScanStep`'s pure core (task 18.1, Requirement 23.4).
 *
 * The core confirms a queued scan (created by the API route) in the
 * workspace-scoped InsForge repo and seeds the baseline workflow state. These
 * tests inject a real demo in-memory InsForge client and exercise the core
 * directly — no Mastra runtime, no network.
 */

/** Seed a `queued` scan in the store and return the ids + a valid init input. */
async function seedQueuedScan(
  insforge: InsForgeClient,
): Promise<{ scan: Scan; workspaceId: string; companyId: string; input: ScanInitInput }> {
  const workspaceId = randomUUID();
  const companyId = randomUUID();
  const repo = insforge.scoped(workspaceId);
  const [scan] = await repo.scans.create([
    { companyId, triggerType: "manual", status: "queued" },
  ]);

  const input: ScanInitInput = {
    scanId: scan!.id,
    workspaceId,
    companyId,
    companyName: "Dropbox",
    companySlug: "dropbox",
    urls: [
      { url: "https://acme.example/pricing", pageRole: "pricing" },
      { url: "https://acme.example/docs", pageRole: "docs" },
      { url: "https://acme.example/", pageRole: "homepage" },
    ],
    mode: "demo",
  };

  return { scan: scan!, workspaceId, companyId, input };
}

describe("createScanCore", () => {
  it("confirms a queued scan and returns the baseline state", async () => {
    const insforge = createInMemoryInsForgeClient();
    const { deps } = makeStepDeps(insforge);
    const { input } = await seedQueuedScan(insforge);

    const baseline = await createScanCore(input, deps);

    // Output matches the boundary schema.
    expect(BaselineStateSchema.safeParse(baseline).success).toBe(true);

    // Identity threaded through unchanged.
    expect(baseline.scanId).toBe(input.scanId);
    expect(baseline.workspaceId).toBe(input.workspaceId);
    expect(baseline.companyId).toBe(input.companyId);
    expect(baseline.companyName).toBe("Dropbox");
    expect(baseline.companySlug).toBe("dropbox");
    expect(baseline.mode).toBe("demo");

    // Watch targets carried forward; diagnostics start empty.
    expect(baseline.urls).toEqual(input.urls);
    expect(baseline.warnings).toEqual([]);
    expect(baseline.skipped).toEqual([]);
  });

  it("maps to the 'queued' baseline status", () => {
    expect(CREATE_SCAN_STATUS).toBe("queued");
  });

  it("throws when the scan does not exist in the bound workspace", async () => {
    const insforge = createInMemoryInsForgeClient();
    const { deps } = makeStepDeps(insforge);
    const { input } = await seedQueuedScan(insforge);

    const missing: ScanInitInput = { ...input, scanId: randomUUID() };
    await expect(createScanCore(missing, deps)).rejects.toThrow(/not found/);
  });

  it("treats a scan in another workspace as not found (workspace scoping)", async () => {
    const insforge = createInMemoryInsForgeClient();
    const { deps } = makeStepDeps(insforge);
    const { input } = await seedQueuedScan(insforge);

    // Same scanId, but a different (random) active workspace — the scoped repo
    // cannot see it, so the step must halt (Requirements 1.4, 21.7).
    const otherWorkspace: ScanInitInput = { ...input, workspaceId: randomUUID() };
    await expect(createScanCore(otherWorkspace, deps)).rejects.toThrow(/not found/);
  });

  it("throws when the scan belongs to a different company", async () => {
    const insforge = createInMemoryInsForgeClient();
    const { deps } = makeStepDeps(insforge);
    const { input } = await seedQueuedScan(insforge);

    const wrongCompany: ScanInitInput = { ...input, companyId: randomUUID() };
    await expect(createScanCore(wrongCompany, deps)).rejects.toThrow(/company/);
  });

  it("throws when the scan is not in the queued baseline status", async () => {
    const insforge = createInMemoryInsForgeClient();
    const { deps } = makeStepDeps(insforge);
    const { input, workspaceId, scan } = await seedQueuedScan(insforge);

    // Advance the scan past the baseline; confirming it must now fail.
    await insforge.scoped(workspaceId).scans.updateStatus(scan.id, "scraping");

    await expect(createScanCore(input, deps)).rejects.toThrow(/expected baseline/);
  });
});
