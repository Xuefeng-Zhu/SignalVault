import { guardUrl } from "@/lib/security";

import {
  BaselineStateSchema,
  CAPTURE_TIMEOUT_MS,
  CapturePlanStateSchema,
  appendSkip,
  toThreadedContext,
  withAdapters,
  type BaselineState,
  type CapturePlanState,
  type CaptureRequestPlan,
  type ScanStatus,
  type StepDeps,
  type WorkflowContext,
} from "../context";
import { defineWorkflowStep, type WorkflowStepConfig } from "./define";

/**
 * Step 2 — `planWatchTargetsStep` (Requirements 8.2, 8.3, 8.4, 23.4).
 *
 * Validates the Company's Watched_Source URLs and builds the capture plan the
 * Apify step (18.2) will execute. For each target it runs the pure SSRF guard
 * (`guardUrl`, task 3.x) BEFORE any scrape is attempted (Requirement 8.2):
 *
 *  - an admissible URL becomes a {@link CaptureRequestPlan} with its `pageRole`
 *    and a per-source `timeoutMs` capped at {@link CAPTURE_TIMEOUT_MS} (60s,
 *    Requirement 8.1), and
 *  - a rejected URL is SKIPPED: it is left out of the capture plan and recorded
 *    in the context's `skipped[]` with the guard's rejection reason, while a
 *    matching human-readable warning is appended to `warnings[]` so the scan
 *    detail page can identify each skipped source and why (Requirements 8.3,
 *    8.4). Skipping one source never blocks the others — every remaining valid
 *    source is still planned.
 *
 * This step maps to the `scraping` status (the capture work it plans begins
 * there). It performs no external calls and no persistence — it is a pure
 * planning/validation step over its input — so the status transition itself is
 * persisted by the capture step that consumes the plan (persist-before-emit,
 * Requirement 7.2). Input/output are Zod-validated at the boundary
 * (Requirements 23.5, 23.6).
 */

/** The lifecycle status this step maps to in the design step table. */
export const PLAN_WATCH_TARGETS_STATUS: ScanStatus = "scraping";

/**
 * Pure core for `planWatchTargetsStep`. Runs the SSRF guard over every target,
 * builds the capture plan for the admissible ones, and records SSRF rejections
 * as skips. Deterministic and offline: `guardUrl` performs no I/O, and the core
 * touches no adapter, so it is exercised directly by the property tests.
 */
export async function planWatchTargetsCore(
  input: BaselineState,
  deps: StepDeps,
): Promise<CapturePlanState> {
  // Re-attach adapters so the diagnostics helpers operate on the full context
  // shape; the capture plan is built from the validated input targets.
  let context: WorkflowContext = withAdapters(input, deps.adapters);
  const capturePlan: CaptureRequestPlan[] = [];

  for (const target of input.urls) {
    const verdict = guardUrl(target.url);
    if (verdict.ok) {
      capturePlan.push({
        url: target.url,
        pageRole: target.pageRole,
        timeoutMs: CAPTURE_TIMEOUT_MS,
      });
    } else {
      // SSRF-rejected: skip scraping this source, record the reason, continue
      // with the remaining valid sources (Requirements 8.2, 8.3).
      context = appendSkip(context, {
        url: target.url,
        reason: verdict.reason ?? "rejected by SSRF guard",
      });
    }
  }

  return {
    ...toThreadedContext(context),
    capturePlan,
  };
}

/** Declarative config for the step, consumed by the assembly (task 18.8). */
export const planWatchTargetsStepConfig: WorkflowStepConfig<
  BaselineState,
  CapturePlanState
> = {
  id: "planWatchTargetsStep",
  description:
    "Validate Watched_Source URLs with the SSRF guard, build the capture plan, and record skipped sources.",
  status: PLAN_WATCH_TARGETS_STATUS,
  inputSchema: BaselineStateSchema,
  outputSchema: CapturePlanStateSchema,
  core: planWatchTargetsCore,
};

/** Build the Mastra `Step` for `planWatchTargetsStep` with adapters injected. */
export function planWatchTargetsStep(deps: StepDeps) {
  return defineWorkflowStep(planWatchTargetsStepConfig, deps);
}
