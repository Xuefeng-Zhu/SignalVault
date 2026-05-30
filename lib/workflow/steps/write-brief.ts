import { z } from "zod";

import { type Strategy, type Verdict } from "@/lib/schemas";

import {
  addWarning,
  errorMessage,
  type ScanWorkflowContext,
} from "../context";
import { parseAtBoundary } from "./artifacts";
import type { ClassifyClaimsData } from "./classify-claims";
import type { ComputeDiffData } from "./compute-diff";
import type { DebateData } from "./run-debate";

/**
 * Step 11 — `writeBriefToBoxStep` (status `analyzing`).
 *
 * Renders the final AI-authored intelligence brief as markdown and uploads it
 * to the Box `reports/` subfolder (Requirement 16.5). The brief is a pure
 * function of the evidence the prior steps produced, so it is deterministic for
 * a deterministic (demo) run.
 *
 * The brief covers (design "writeBriefToBoxStep" + Requirement 16):
 *  - the company and the strategy verdict (prediction + confidence + risk),
 *  - the key evidence and counter evidence,
 *  - the recommended actions,
 *  - a claim summary (counts by Claim_Status), and
 *  - a diffs summary (changed pages + baselines).
 *
 * The rendered brief file id is carried forward (for the workflow output's
 * `briefFileId`).
 *
 * ## Degrade, never crash
 *
 * - When no Box `reports/` folder is available, or the upload fails, the cause
 *   is recorded as a warning and `briefFileId` is null; the workflow continues.
 * - A simulated Box adapter surfaces a "simulated storage" warning.
 *
 * The step core takes the context explicitly and uses only the injected Box
 * adapter, so it carries no `server-only` import and is unit-testable with
 * fakes.
 *
 * Requirements: 16.5, 7.2, 23.4
 */

/** Output of {@link writeBriefToBoxStep}. */
export interface WriteBriefData {
  /** The rendered markdown brief (carried forward / useful for tests). */
  brief: string;
  /** Box file id of the uploaded brief, or null when it was omitted. */
  briefFileId: string | null;
}

const WriteBriefDataSchema = z.object({
  brief: z.string().min(1),
  briefFileId: z.string().min(1).nullable(),
});

/** Human-readable label for each strategy prediction enum value. */
const STRATEGY_LABELS: Record<Strategy, string> = {
  moving_upmarket: "Moving upmarket",
  enterprise_readiness: "Enterprise readiness",
  pricing_tightening: "Pricing tightening",
  security_posture_change: "Security posture change",
  messaging_pivot: "Messaging pivot",
  self_serve_push: "Self-serve push",
  insufficient_evidence: "Insufficient evidence",
};

/**
 * Run {@link writeBriefToBoxStep} against the shared workflow context, consuming
 * the concluded verdict (step 10), the classified claims (step 9), and the
 * computed diffs (step 7).
 *
 * Validates its output at the boundary (Requirement 23.6).
 */
export async function writeBriefToBoxStep(
  ctx: ScanWorkflowContext,
  debate: DebateData,
  classified: ClassifyClaimsData,
  diffData: ComputeDiffData,
): Promise<WriteBriefData> {
  const brief = renderBrief(ctx, debate.verdict, classified, diffData, debate.isFallback);
  const briefFileId = await uploadBrief(ctx, brief);

  return parseAtBoundary(
    WriteBriefDataSchema,
    { brief, briefFileId },
    "writeBriefToBoxStep output",
  );
}

/**
 * Render the markdown intelligence brief from the verdict and collected
 * evidence. Pure and deterministic.
 */
export function renderBrief(
  ctx: ScanWorkflowContext,
  verdict: Verdict,
  classified: ClassifyClaimsData,
  diffData: ComputeDiffData,
  isFallback: boolean,
): string {
  const strategyLabel = STRATEGY_LABELS[verdict.strategyPrediction];
  const lines: string[] = [];

  lines.push(`# SignalVault Intelligence Brief: ${ctx.companyName}`);
  lines.push("");

  // Strategy verdict (prediction + confidence + risk).
  lines.push("## Strategy Verdict");
  lines.push("");
  lines.push(`- **Strategy prediction:** ${strategyLabel}`);
  lines.push(`- **Confidence:** ${verdict.confidence} / 100`);
  lines.push(`- **Risk score:** ${verdict.riskScore} / 100`);
  if (isFallback) {
    lines.push(
      "- _Note: a deterministic fallback verdict was substituted for this scan._",
    );
  }
  lines.push("");

  // Key evidence (supporting the shift).
  lines.push("## Key Evidence");
  lines.push("");
  lines.push(...bulletsOrNone(verdict.keyEvidence));
  lines.push("");

  // Counter evidence (against the shift).
  lines.push("## Counter Evidence");
  lines.push("");
  lines.push(...bulletsOrNone(verdict.counterEvidence));
  lines.push("");

  // Recommended actions.
  lines.push("## Recommended Actions");
  lines.push("");
  verdict.recommendedActions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action}`);
  });
  lines.push("");

  // Claim summary (counts by status).
  lines.push("## Claim Summary");
  lines.push("");
  lines.push(...renderClaimSummary(classified));
  lines.push("");

  // Diffs summary (changed pages + baselines).
  lines.push("## Detected Changes");
  lines.push("");
  lines.push(...renderDiffSummary(diffData));
  lines.push("");

  return lines.join("\n");
}

/** Render claim counts grouped by Claim_Status, plus the total. */
function renderClaimSummary(classified: ClassifyClaimsData): string[] {
  const total = classified.classified.length;
  if (total === 0) {
    return ["No public claims were extracted for this scan."];
  }

  const counts = new Map<string, number>();
  for (const { status } of classified.classified) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  const lines = [`Extracted **${total}** public claim(s):`, ""];
  // Stable, status-enum order so the brief is deterministic.
  for (const status of [...counts.keys()].sort()) {
    lines.push(`- ${status}: ${counts.get(status)}`);
  }
  return lines;
}

/** Render the diffs summary: changed pages with their change scores + baselines. */
function renderDiffSummary(diffData: ComputeDiffData): string[] {
  const lines: string[] = [];

  if (diffData.diffs.length === 0) {
    lines.push("No page changes were computed for this scan.");
  } else {
    lines.push(`Computed **${diffData.diffs.length}** page diff(s):`);
    lines.push("");
    for (const computed of diffData.diffs) {
      const { diff } = computed;
      const summary = diff.changeSummary.trim() || "(no summary)";
      lines.push(`- change score ${diff.changeScore}/100 — ${summary}`);
    }
  }

  if (diffData.baselines.length > 0) {
    lines.push("");
    lines.push(
      `${diffData.baselines.length} source(s) recorded as an initial baseline (no prior snapshot to compare).`,
    );
  }

  return lines;
}

/** Render a markdown bullet list, or a placeholder line when the list is empty. */
function bulletsOrNone(items: string[]): string[] {
  if (items.length === 0) {
    return ["- (none)"];
  }
  return items.map((item) => `- ${item}`);
}

/**
 * Upload the rendered brief to the Box `reports/` subfolder (Requirement 16.5).
 * Returns the Box file id, or null when no `reports/` folder is available or the
 * upload fails (recorded as a warning; the workflow continues).
 */
async function uploadBrief(
  ctx: ScanWorkflowContext,
  brief: string,
): Promise<string | null> {
  const reportsFolderId = ctx.boxFolders?.subfolders.report;
  if (reportsFolderId === undefined) {
    addWarning(
      ctx,
      "No Box reports/ folder available; the intelligence brief artifact was omitted.",
    );
    return null;
  }

  try {
    const result = await ctx.adapters.box.upload(
      reportsFolderId,
      "report",
      `intelligence-brief-${ctx.scanId}.md`,
      brief,
    );
    if (result.simulated) {
      addWarning(ctx, "Intelligence brief stored with simulated Box storage.");
    }
    return result.fileId;
  } catch (error) {
    addWarning(
      ctx,
      `Failed to upload the intelligence brief; the artifact was omitted: ${errorMessage(error)}`,
    );
    return null;
  }
}
