// Feature: signalvault, Property 25: Status is persisted before any progress is emitted
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { AdapterSet } from "@/lib/adapters/factory-core";
import type {
  ApifyClient,
  BoxClient,
  ModelClient,
  NewVerdict,
  VerdictRow,
  WorkspaceRepository,
} from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { createScanWorkflowContext, type ScanWorkflowContext } from "../context";
import { completeScanStep } from "./complete-scan";
import type { DebateData } from "./run-debate";
import type { ClassifyClaimsData } from "./classify-claims";
import type { ComputeDiffData } from "./compute-diff";

/**
 * Property 25 (Validates: Requirement 7.2):
 *
 * `completeScanStep` MUST persist the scan status to `completed` in the
 * repository before returning. Since the realtime trigger fires off the DB
 * write, any watcher that polls after the function resolves will see
 * `completed`. This property verifies that invariant: after the step returns
 * `ok`, the scan's persisted status is `completed`.
 */

const SCAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/** Track the scan status and the order of operations. */
class StatusTrackingRepo {
  persistedStatuses: string[] = [];
  verdictCreated = false;
  statusAtVerdictTime: string | null = null;

  private seq = 0;

  asRepository(): WorkspaceRepository {
    const self = this;
    return {
      scans: {
        async updateStatus(_id: string, status: string): Promise<unknown> {
          self.persistedStatuses.push(status);
          return { id: _id, status };
        },
      },
      verdicts: {
        async create(rows: NewVerdict[]): Promise<VerdictRow[]> {
          self.verdictCreated = true;
          self.statusAtVerdictTime = self.persistedStatuses.at(-1) ?? null;
          return rows.map((row) => ({
            id: `verdict-${++self.seq}`,
            workspaceId: WORKSPACE_ID,
            createdAt: new Date().toISOString(),
            ...row,
          }));
        },
        async getForScan(): Promise<VerdictRow | null> {
          return null;
        },
      },
    } as unknown as WorkspaceRepository;
  }
}

function fakeInsForge(repo: StatusTrackingRepo): {
  scoped: () => WorkspaceRepository;
  isConfigured: () => boolean;
  mode: "live";
} {
  return {
    scoped: () => repo.asRepository(),
    isConfigured: () => true,
    mode: "live" as const,
  };
}

function makeCtx(repo: StatusTrackingRepo): ScanWorkflowContext {
  const adapters: AdapterSet = {
    apify: {} as ApifyClient,
    box: {} as BoxClient,
    insforge: fakeInsForge(repo) as unknown as typeof adapters.insforge,
    model: {} as ModelClient,
  };
  return createScanWorkflowContext({
    scanId: SCAN_ID,
    workspaceId: WORKSPACE_ID,
    companyId: COMPANY_ID,
    companyName: "Dropbox",
    companySlug: "dropbox",
    scanTimestamp: "2024-01-01T00-00-00",
    mode: "live",
    adapters,
  });
}

const debateData: DebateData = {
  verdict: {
    strategyPrediction: "moving_upmarket",
    confidence: 82,
    riskScore: 20,
    recommendedActions: ["Monitor pricing page"],
    keyEvidence: ["Price increase detected"],
    counterEvidence: [],
  },
  isFallback: false,
  failureCause: null,
};

const classifiedData: ClassifyClaimsData = { classified: [] };
const diffData: ComputeDiffData = { diffs: [], baselines: [] };

describe("Property 25: status persisted before workflow completes", () => {
  it("completeScanStep persists completed status before returning", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const repo = new StatusTrackingRepo();
        const ctx = makeCtx(repo);

        const result = await completeScanStep(
          ctx,
          debateData,
          classifiedData,
          diffData,
          null,
        );

        // The step must return the correct scanId.
        expect(result.scanId).toBe(SCAN_ID);

        // Status `completed` must have been persisted.
        expect(repo.persistedStatuses).toContain("completed");

        // The final persisted status must be `completed`.
        expect(repo.persistedStatuses.at(-1)).toBe("completed");
      }),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("verdict is persisted and result carries the verdict row", async () => {
    const repo = new StatusTrackingRepo();
    const ctx = makeCtx(repo);

    const result = await completeScanStep(
      ctx,
      debateData,
      classifiedData,
      diffData,
      null,
    );

    expect(repo.verdictCreated).toBe(true);
    expect(result.verdict).not.toBeNull();
    expect(result.verdict?.strategyPrediction).toBe("moving_upmarket");
    expect(result.verdict?.confidence).toBe(82);
  });

  it("continues to completed even when verdict persistence fails", async () => {
    const repo = new StatusTrackingRepo();
    // Override to throw
    repo.asRepository = () => ({
      scans: {
        async updateStatus(_id: string, status: string): Promise<unknown> {
          repo.persistedStatuses.push(status);
          return { id: _id, status };
        },
      },
      verdicts: {
        async create(): Promise<VerdictRow[]> {
          throw new Error("simulated persistence failure");
        },
        async getForScan(): Promise<VerdictRow | null> { return null; },
      },
    } as unknown as WorkspaceRepository);

    const ctx = makeCtx(repo);
    const result = await completeScanStep(
      ctx,
      debateData,
      classifiedData,
      diffData,
      null,
    );

    // Scan is still completed (Requirement 19.4).
    expect(result.scanId).toBe(SCAN_ID);
    expect(repo.persistedStatuses).toContain("completed");
    // Verdict is null because persistence failed.
    expect(result.verdict).toBeNull();
    // A warning was recorded.
    expect(result.warnings.some((w) => w.includes("persistence"))).toBe(true);
  });
});
