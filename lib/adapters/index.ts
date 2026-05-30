/**
 * Barrel for SignalVault's adapter interfaces, shared adapter types, and the
 * demo/live selection factory.
 *
 * Adapters are the sole access points to external services (Requirement 23.1),
 * and the factory re-exported below is their single construction point. This
 * module re-exports the interface/type surface from `./types` and the factory
 * value API from `./factory` (a `server-only` module, so importing this barrel
 * into a client component fails the build — keeping credentials server-side per
 * Requirement 22.1).
 */
export {
  createAdapters,
  getApifyClient,
  getBoxClient,
  getInsForgeClient,
  getModelClient,
  type AdapterContext,
  type AdapterSet,
} from "./factory";

export {
  selectAdapters,
  selectImpl,
  type AdapterImplPair,
  type AdapterImplPairs,
} from "./factory-core";

export type {
  // Base
  RunMode,
  Adapter,
  // Apify
  ApifyClient,
  CaptureRequest,
  CaptureResult,
  // Box
  BoxClient,
  ArtifactType,
  BoxFolderSet,
  BoxUploadResult,
  // InsForge + repositories
  InsForgeClient,
  WorkspaceRepository,
  CompanyRepo,
  ScanRepo,
  SnapshotRepo,
  DiffRepo,
  ClaimRepo,
  VerdictRepo,
  IntegrationRepo,
  // Model
  ModelClient,
  InferenceRequest,
  InferenceMessage,
  // Supporting domain types
  Session,
  Workspace,
  ScanStatus,
  IntegrationProvider,
  Company,
  WatchedSource,
  Scan,
  Snapshot,
  DiffRow,
  ClaimRow,
  VerdictRow,
  Integration,
  // Insert (write) shapes
  NewCompany,
  NewWatchedSource,
  NewScan,
  NewSnapshot,
  NewDiff,
  NewClaim,
  NewVerdict,
  NewIntegration,
  // Re-exported diff types
  Diff,
  ModifiedSection,
} from "./types";
