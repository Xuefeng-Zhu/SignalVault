import { z } from "zod";

import { ClaimStatusEnum } from "@/lib/schemas";
import { StrategyEnum } from "@/lib/schemas";
import type { VerdictRow } from "@/lib/adapters/types";

import {
  addWarning,
  errorMessage,
  scopedRepo,
  setScanStatus,
  type ScanWorkflowContext,
} from "../context";
import { PERSISTENCE_MAX_ATTEMPTS, withRetry } from "../retry";
import { parseAtBoundary } from "./artifacts";
import type { ClassifyClaimsData } from "./classify-claims";
import type { ComputeDiffData } from "./compute-diff";
import type { DebateData } from "./run-debate";

/**
 * Step 12 — `completeScanStep` (status `completed`).
 *
 * The final step in the SignalVault scan workflow. It:
 *  1. Persists the verdict from {@link runDebateStep} with retry ≤ 3 extra
 *     attempts (PERSISTENCE_MAX_ATTEMPTS = 4 total). A failure to persist the
 *     verdict is a non-fatal warning — the scan still completes (Requirement
 *     19.4).
 *  2. Persists `completed` status (persist-before-emit, Requirement 7.2) via
 *     {@link setScanStatus}. If the status update itself fails (unrecoverable),
 *     sets status to `failed` and surfaces the failing step (Requirement 19.5).
 *  3. Returns the aggregated result: scanId, verdict row, accumulated
 *     warnings/skipped, and the evidence summary (Requirement 16.6).
 *
 * Requirements: 7.2, 7.6, 16.1, 16.6, 19.4, 19.5
 */

/** The output of this final step: the scan's full aggregated result. */
export interface CompleteScanData {
  scanId: string;
  verdict: VerdictRow | null;
  briefFileId: string | null;
  warnings: string[];
  skipped: Array<{ url: string; reason: string }>;
  data: {
    snapshotCount: number;
    diffCount: number;
    claimCount: number;
  };
}

const CompleteScanDataSchema = z.object({
  scanId: z.string().uuid(),
  verdict: z
    .object({
      id: z.string(),
      scanId: z.string(),
      workspaceId: z.string(),
      strategyPrediction: StrategyEnum,
      confidence: z.number().int().min(0).max(100),
      riskScore: z.number().int().min(0).max(100),
      recommendedActions: z.array(z.string().min(1)).min(1).max(10),
      keyEvidence: z.array(z.string()),
      counterEvidence: z.array(z.string()),
      isFallback: z.boolean(),
      createdAt: z.string(),
    })
    .nullable(),
  briefFileId: z.string().nullable(),
  warnings: z.array(z.string()),
  skipped: z.array(
    z.object({ url: z.string(), reason: z.string().min(1) }),
  ),
  data: z.object({
    snapshotCount: z.number().int().nonnegative(),
    diffCount: z.number().int().nonnegative(),
    claimCount: z.number().int().nonnegative(),
  }),
});

/**
 * Run `completeScanStep` against the shared workflow context.
 *
 * @param ctx  The mutable scan context (carries adapters, evidence, accumulators).
 * @param debate  The verdict from runDebateStep.
 * @param classified  Classified claims from classifyClaimsStep.
 * @param diffData  Computed diffs from computeDiffStep.
 * @param briefFileId  Box file id of the uploaded brief (from writeBriefToBoxStep).
 */
export async function completeScanStep(
  ctx: ScanWorkflowContext,
  debate: DebateData,
  classified: ClassifyClaimsData,
  diffData: ComputeDiffData,
  briefFileId: string | null,
): Promise<CompleteScanData> {
  const repo = scopedRepo(ctx);
  const { verdict } = debate;

  // 1) Persist the verdict (retry ≤ 3 extra attempts = 4 total).
  let persistedVerdict: VerdictRow | null = null;
  const verdictResult = await withRetry(async () => {
    const rows = await repo.verdicts.create([
      {
        scanId: ctx.scanId,
        strategyPrediction: verdict.strategyPrediction,
        confidence: verdict.confidence,
        riskScore: verdict.riskScore,
        recommendedActions: verdict.recommendedActions,
        keyEvidence: verdict.keyEvidence,
        counterEvidence: verdict.counterEvidence,
        isFallback: debate.isFallback,
      },
    ]);
    return rows[0];
  }, PERSISTENCE_MAX_ATTEMPTS);

  if (verdictResult.ok) {
    persistedVerdict = verdictResult.value ?? null;
  } else {
    // Verdict persistence failure is non-fatal (Requirement 19.4); record a
    // warning and continue toward `completed`.
    addWarning(
      ctx,
      `Verdict persistence exhausted ${verdictResult.attempts} attempts: ${verdictResult.lastError}`,
    );
  }

  // 2) Set status to `completed` (persist-before-emit — Requirement 7.2).
  try {
    await setScanStatus(ctx, "completed");
  } catch (err) {
    // Unrecoverable: the status update itself failed. Best-effort: try to mark
    // `failed` so the UI shows the right state (Requirement 19.5).
    const cause = errorMessage(err);
    try {
      await setScanStatus(ctx, "failed", {
        failureReason: `completeScanStep failed to persist status: ${cause}`,
      });
    } catch {
      // Double failure — ignore; the scan row will eventually timeout/be
      // garbage-collected in a future reconciliation pass.
    }
    addWarning(ctx, `Failed to persist completed status: ${cause}`);
    // Re-throw so the workflow runner surfaces the failing step.
    throw new Error(`completeScanStep: status persistence failed: ${cause}`);
  }

  // 3) Aggregate and return.
  const claimCount = classified.classified.length;
  const diffCount = diffData.diffs.length;
  const snapshotCount = ctx.currentSnapshots.length;

  const result: CompleteScanData = {
    scanId: ctx.scanId,
    verdict: persistedVerdict,
    briefFileId,
    warnings: [...ctx.warnings],
    skipped: ctx.skipped.map(({ url, reason }) => ({ url, reason })),
    data: { snapshotCount, diffCount, claimCount },
  };

  return parseAtBoundary(
    CompleteScanDataSchema,
    result,
    "completeScanStep output",
  ) as CompleteScanData;
}
