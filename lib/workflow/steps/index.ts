/**
 * Barrel for the `signalVaultScanWorkflow` step cores.
 *
 * Steps are authored as pure cores that receive the shared
 * {@link import('../context').ScanWorkflowContext} (and thus their adapters)
 * explicitly, so they stay unit-/property-testable and never construct an
 * adapter themselves (Requirement 23.1). The server-only workflow assembly
 * (task 18.8) wires them in order.
 */

/* Step 3 — capture. */
export { runApifyCaptureStep } from "./run-apify-capture";

/* Step 4 — normalize. */
export { normalizeArtifactsStep } from "./normalize-artifacts";

/* Step 5 — upload snapshots to Box. */
export { uploadSnapshotToBoxStep } from "./upload-snapshot-to-box";

/* Step 6 — find previous snapshot. */
export {
  findPreviousSnapshotStep,
  selectPriorSnapshots,
  type FindPreviousSnapshotData,
  type SnapshotPairing,
  type SelectPriorSnapshotsParams,
} from "./find-previous-snapshot";

/* Step 7 — compute diff. */
export {
  computeDiffStep,
  computeDiffs,
  type ComputeDiffData,
  type ComputeDiffDeps,
  type ComputedDiff,
  type BaselineSource,
} from "./compute-diff";

/* Step 8 — extract claims. */
export {
  extractClaimsStep,
  type ExtractClaimsData,
} from "./extract-claims";

/* Step 9 — classify claims. */
export {
  classifyClaimsStep,
  type ClassifyClaimsData,
  type ClassifiedClaimRow,
} from "./classify-claims";

/* Step 10 — run debate. */
export {
  runDebateStep,
  type DebateData,
} from "./run-debate";

/* Step 11 — write brief to Box. */
export {
  writeBriefToBoxStep,
  renderBrief,
  type WriteBriefData,
} from "./write-brief";

/* Step 12 — complete scan. */
export {
  completeScanStep,
  type CompleteScanData,
} from "./complete-scan";
