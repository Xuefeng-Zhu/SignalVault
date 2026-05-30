import "server-only";

/**
 * SignalVault scan workflow assembly (task 18.8).
 *
 * This module is the single, server-only entry point that wires the twelve
 * workflow step cores into a complete, sequential scan pipeline. The adapters
 * (the sole door to external services — Requirement 23.1) are injected and
 * never constructed here.
 *
 * ## Design
 *
 * Steps 1–2 (`createScanStep`, `planWatchTargetsStep`) use the serializable
 * Mastra-native step pattern (pure cores + `defineWorkflowStep`). Steps 3–12
 * use the mutable `ScanWorkflowContext` pattern, which is sequentially wired
 * here as a single async function.
 *
 * Rather than relying on Mastra's chaining API (which requires every step's
 * I/O to be a Zod-serializable boundary — not satisfied by the mutable context
 * steps), `runSignalVaultScanWorkflow` is a plain `async` function that:
 *
 *  1. Validates the workflow input against `ScanInitInputSchema` (Req 23.2).
 *  2. Calls the step cores in order, threading the context through.
 *  3. Catches any unrecoverable failure, sets the scan to `failed`, and returns
 *     a typed failure result (Requirement 19.5).
 *  4. Validates and returns the workflow output (Req 23.3).
 *
 * Requirements: 23.2, 23.3, 23.4, 23.5, 23.6, 23.7
 */

import type { AdapterSet } from "@/lib/adapters/factory-core";
import { ScanWorkflowInput, ScanWorkflowOutput } from "@/lib/schemas";

import {
  ScanInitInputSchema,
  createScanWorkflowContext,
  errorMessage,
  setScanStatus,
  toThreadedContext,
  withAdapters,
  type ScanInitInput,
} from "./context";
import { createScanCore } from "./steps/create-scan";
import { planWatchTargetsCore } from "./steps/plan-watch-targets";
import {
  runApifyCaptureStep,
  normalizeArtifactsStep,
  uploadSnapshotToBoxStep,
  findPreviousSnapshotStep,
  computeDiffStep,
  extractClaimsStep,
  classifyClaimsStep,
  runDebateStep,
  writeBriefToBoxStep,
  completeScanStep,
  type CompleteScanData,
} from "./steps";
import type { CapturePlan } from "./steps/artifacts";

export type { CompleteScanData };
export type { ScanWorkflowOutput };

/**
 * Run the full SignalVault scan workflow for a queued scan.
 *
 * @param rawInput  The workflow init data (ScanInitInput). Validated at
 *   entry — halts immediately with a typed error if invalid (Requirement 23.2).
 * @param adapters  The four external adapters, already resolved by the
 *   server-only adapter factory (task 6.2). Never constructed here.
 * @returns  The completed workflow output (Requirement 23.3).
 */
export async function runSignalVaultScanWorkflow(
  rawInput: unknown,
  adapters: AdapterSet,
): Promise<{ ok: true; data: CompleteScanData } | { ok: false; error: string }> {
  // Step 0 — validate the workflow input boundary (Requirement 23.2).
  const inputParse = ScanInitInputSchema.safeParse(rawInput);
  if (!inputParse.success) {
    return {
      ok: false,
      error: `Workflow input validation failed: ${inputParse.error.message}`,
    };
  }
  const input: ScanInitInput = inputParse.data;

  // Step 1 — createScanCore: confirm the queued scan and build baseline state.
  let baselineState;
  try {
    baselineState = await createScanCore(input, { adapters });
  } catch (err) {
    return { ok: false, error: `createScanStep failed: ${errorMessage(err)}` };
  }

  // Step 2 — planWatchTargetsCore: validate URLs, run the SSRF guard, build the
  // capture plan.
  let capturePlanState;
  try {
    capturePlanState = await planWatchTargetsCore(baselineState, { adapters });
  } catch (err) {
    return {
      ok: false,
      error: `planWatchTargetsStep failed: ${errorMessage(err)}`,
    };
  }

  // Re-attach adapters to the serialized threaded context.
  const threaded = capturePlanState;
  const ctx = createScanWorkflowContext({
    scanId: threaded.scanId,
    workspaceId: threaded.workspaceId,
    companyId: threaded.companyId,
    companyName: threaded.companyName,
    companySlug: threaded.companySlug,
    scanTimestamp: new Date().toISOString(),
    // Use the real scan createdAt from the DB row (carried by createScanCore)
    // so findPreviousSnapshotStep uses the authoritative cutoff.
    scanCreatedAt: threaded.scanCreatedAt,
    mode: threaded.mode,
    adapters,
  });
  // Carry forward any SSRF skips from the planning step.
  for (const skip of threaded.skipped) {
    ctx.skipped.push({ url: skip.url, pageRole: skip.pageRole ?? "homepage", reason: skip.reason });
  }
  ctx.warnings.push(...threaded.warnings);

  // Build the CapturePlan by joining planWatchTargetsCore's capture request list
  // with the watched source IDs from the DB (runApifyCaptureStep requires them).
  const repo = adapters.insforge.scoped(input.workspaceId);
  const watchedSources = await repo.companies.listSources(input.companyId);
  const sourceIdByUrl = new Map<string, string>(
    watchedSources.map((s) => [s.url, s.id]),
  );

  const capturePlan: CapturePlan = threaded.capturePlan
    .map((req) => {
      const watchedSourceId = sourceIdByUrl.get(req.url);
      if (!watchedSourceId) return null;
      return { watchedSourceId, request: req };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Steps 3–12 use the mutable ScanWorkflowContext. Any unrecoverable failure
  // (i.e., a throw that escapes the step) is caught here: the scan is set to
  // `failed` and the error is returned (Requirement 19.5).
  try {
    // Step 3 — runApifyCaptureStep
    const captured = await runApifyCaptureStep(ctx, capturePlan);

    // Step 4 — normalizeArtifactsStep
    const normalized = await normalizeArtifactsStep(ctx, captured);

    // Step 5 — uploadSnapshotToBoxStep
    const uploadResult = await uploadSnapshotToBoxStep(ctx, normalized);

    // Carry the Box folder set and uploaded snapshot ids onto the context so
    // later steps can reference them.
    ctx.boxFolders = uploadResult.folderSet;
    // Populate currentSnapshots from the uploaded snapshots.
    for (const up of uploadResult.snapshots) {
      ctx.currentSnapshots.push({
        snapshotId: up.snapshotId,
        watchedSourceId: up.watchedSourceId,
        normalizedContent: up.normalizedContent,
      });
    }

    // Step 6 — findPreviousSnapshotStep
    const previous = await findPreviousSnapshotStep(ctx);

    // Step 7 — computeDiffStep
    const diffData = await computeDiffStep(ctx, previous);

    // Step 8 — extractClaimsStep
    const extracted = await extractClaimsStep(ctx);

    // Step 9 — classifyClaimsStep
    const classified = await classifyClaimsStep(ctx, extracted, previous);

    // Step 10 — runDebateStep
    const debate = await runDebateStep(ctx, classified, diffData);

    // Step 11 — writeBriefToBoxStep
    const brief = await writeBriefToBoxStep(ctx, debate, classified, diffData);

    // Step 12 — completeScanStep (persists verdict + sets status=completed)
    const result = await completeScanStep(
      ctx,
      debate,
      classified,
      diffData,
      brief.briefFileId,
    );

    return { ok: true, data: result };
  } catch (err) {
    // Unrecoverable step failure: set the scan to `failed` so the UI shows the
    // right terminal state (Requirement 19.5).
    const cause = errorMessage(err);
    try {
      await setScanStatus(ctx, "failed", { failureReason: cause });
    } catch (secondaryErr) {
      // Best-effort; log but don't throw over the original error.
      console.error(
        `[SignalVault] Failed to mark scan ${ctx.scanId} as failed:`,
        secondaryErr,
      );
    }
    return { ok: false, error: cause };
  }
}
