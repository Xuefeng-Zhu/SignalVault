import type { Scan } from "@/lib/adapters/types";

import {
  BaselineStateSchema,
  ScanInitInputSchema,
  initWorkflowContext,
  toThreadedContext,
  type BaselineState,
  type ScanContext,
  type ScanInitInput,
  type ScanStatus,
  type StepDeps,
  type WorkflowContext,
} from "../context";
import { defineWorkflowStep, type WorkflowStepConfig } from "./define";

/**
 * Step 1 — `createScanStep` (Requirement 23.4).
 *
 * Confirms the Scan record and establishes the baseline workflow state the rest
 * of the steps thread through. The Scan row itself is created by the API route
 * (task 20.6) with status `queued` and `trigger_type 'manual'` (Requirement
 * 6.1); this step does NOT create it. Instead it:
 *
 *  1. confirms the scan exists in the workspace-scoped InsForge repository
 *     (the repo is bound to the caller's workspace, so a scan from another
 *     tenant is invisible and treated as "not found" — Requirements 1.4, 21.7),
 *  2. confirms the row is in the `queued` baseline status this step maps to,
 *     and
 *  3. seeds the initial {@link WorkflowContext} (identity + injected adapters +
 *     empty `warnings`/`skipped`) plus the 3–5 watch targets carried forward to
 *     `planWatchTargetsStep`.
 *
 * It performs no external mutation: the scan is already `queued`, so confirming
 * the baseline requires only a read. Input/output are Zod-validated at the step
 * boundary (Requirements 23.5, 23.6).
 */

/** The lifecycle status this step maps to in the design step table. */
export const CREATE_SCAN_STATUS: ScanStatus = "queued";

/**
 * Pure core for `createScanStep`. Confirms the queued scan and returns the
 * baseline state. Adapters are injected via {@link StepDeps}, so the core is
 * fully testable offline against the demo/in-memory InsForge client.
 *
 * @throws if the scan does not exist in the bound workspace (a cross-tenant or
 *   unknown scan), or if it is not in the expected `queued` baseline status.
 */
export async function createScanCore(
  input: ScanInitInput,
  deps: StepDeps,
): Promise<BaselineState> {
  const repo = deps.adapters.insforge.scoped(input.workspaceId);

  const scan: Scan | null = await repo.scans.get(input.scanId);
  if (scan === null) {
    // Either the scan doesn't exist or it belongs to another workspace; the
    // workspace-scoped repo cannot tell them apart by design (Requirements
    // 1.4, 21.7). Halt the step — there is no baseline to establish.
    throw new Error(
      `createScanStep: scan ${input.scanId} not found in workspace ${input.workspaceId}`,
    );
  }

  if (scan.companyId !== input.companyId) {
    throw new Error(
      `createScanStep: scan ${input.scanId} belongs to company ${scan.companyId}, not ${input.companyId}`,
    );
  }

  if (scan.status !== CREATE_SCAN_STATUS) {
    throw new Error(
      `createScanStep: scan ${input.scanId} has status "${scan.status}", expected baseline "${CREATE_SCAN_STATUS}"`,
    );
  }

  const scanContext: ScanContext = {
    scanId: scan.id,
    workspaceId: input.workspaceId,
    companyId: scan.companyId,
    companyName: input.companyName,
    companySlug: input.companySlug,
    mode: input.mode,
  };

  const context: WorkflowContext = initWorkflowContext(scanContext, deps.adapters);

  return {
    ...toThreadedContext(context),
    urls: input.urls,
  };
}

/** Declarative config for the step, consumed by the assembly (task 18.8). */
export const createScanStepConfig: WorkflowStepConfig<ScanInitInput, BaselineState> = {
  id: "createScanStep",
  description: "Confirm the queued scan record and establish the baseline workflow state.",
  status: CREATE_SCAN_STATUS,
  inputSchema: ScanInitInputSchema,
  outputSchema: BaselineStateSchema,
  core: createScanCore,
};

/** Build the Mastra `Step` for `createScanStep` with adapters injected. */
export function createScanStep(deps: StepDeps) {
  return defineWorkflowStep(createScanStepConfig, deps);
}
