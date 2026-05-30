/**
 * Barrel for the SignalVault Mastra workflow (`signalVaultScanWorkflow`).
 *
 * Re-exports the shared workflow context/state shape and the early steps
 * (`createScanStep`, `planWatchTargetsStep`) so the assembly (task 18.8), the
 * API route (task 20.6), and the property/integration tests have one import
 * site. The remaining step cores are re-exported from `./steps`. None of this
 * is `server-only` (adapters are injected, not constructed here), so it stays
 * testable.
 *
 * The shared context is re-exported with `export *` (rather than a hand-listed
 * set) because `./context` is co-owned by the sibling step tasks (18.2/18.4):
 * `export *` keeps this barrel correct as that module grows.
 */

/* Shared workflow context, boundary schemas, and helpers. */
export * from "./context";

/* Step-definition helper (task 18.1). */
export {
  defineWorkflowStep,
  type StepCore,
  type WorkflowStepConfig,
} from "./steps/define";

/* Step 1 — create scan. */
export {
  CREATE_SCAN_STATUS,
  createScanCore,
  createScanStepConfig,
  createScanStep,
} from "./steps/create-scan";

/* Step 2 — plan watch targets. */
export {
  PLAN_WATCH_TARGETS_STATUS,
  planWatchTargetsCore,
  planWatchTargetsStepConfig,
  planWatchTargetsStep,
} from "./steps/plan-watch-targets";
