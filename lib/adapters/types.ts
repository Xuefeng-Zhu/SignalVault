import "server-only";

import type { Claim, ClaimStatus, ClaimType, SourceType, Strategy } from "@/lib/schemas";
import type { Diff, ModifiedSection } from "@/lib/diff";

/**
 * Adapter interfaces and shared adapter types for SignalVault.
 *
 * Adapters are the SOLE access points through which System components talk to
 * Apify, Box, InsForge, and the model provider; no other component issues
 * requests to those external services directly (Requirement 23.1). This file
 * defines only the interfaces and supporting domain types — the live and demo
 * implementations, and the selection factory, are authored by later tasks
 * (7.x / 9.x / 11.x / 13.x and 6.2 respectively).
 *
 * Every adapter:
 *  - exposes a narrow TypeScript interface,
 *  - reports live-credential presence via {@link Adapter.isConfigured},
 *  - carries the {@link RunMode} it resolved to via {@link Adapter.mode},
 *  - is constructed only in server-only modules.
 *
 * `import "server-only"` keeps this module (and anything importing concrete
 * adapters through it) out of the browser bundle (Requirement 22).
 */

/* -------------------------------------------------------------------------- */
/* Base adapter                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolved operating mode for a single adapter.
 *
 * This is the canonical adapter `RunMode`. It is structurally identical to the
 * local `RunMode` in `lib/config/env.ts` (`'demo' | 'live'`); that module keeps
 * a local copy only to avoid a build-time dependency on this file, and the two
 * are interchangeable by design.
 */
export type RunMode = "live" | "demo";

export interface Adapter {
  /** True when all required credentials for live operation are present. */
  isConfigured(): boolean;
  /** Resolved mode for this adapter in the current run. */
  readonly mode: RunMode;
}

/* -------------------------------------------------------------------------- */
/* ApifyClient (Apify_Adapter)                                                */
/* -------------------------------------------------------------------------- */

export interface CaptureRequest {
  url: string;
  pageRole: SourceType; // homepage | pricing | docs | ...
  timeoutMs: number; // <= 60_000
}

export interface CaptureResult {
  url: string;
  pageRole: SourceType;
  ok: boolean;
  rawHtml?: string;
  screenshotRef?: string; // Apify key-value store ref or mock ref
  simulated: boolean; // true when demo data was substituted
  skippedReason?: string; // SSRF rejection, timeout, or upstream failure
}

export interface ApifyClient extends Adapter {
  /**
   * Capture each requested URL. Returns exactly one {@link CaptureResult} per
   * request and never throws on a per-source skip/failure (Requirement 8); a
   * skipped source is reported with `ok = false` and a `skippedReason`.
   */
  capture(requests: CaptureRequest[]): Promise<CaptureResult[]>;
}

/* -------------------------------------------------------------------------- */
/* BoxClient (Box_Adapter)                                                    */
/* -------------------------------------------------------------------------- */

export type ArtifactType =
  | "raw"
  | "normalized"
  | "screenshot"
  | "diff"
  | "claim"
  | "report";

export interface BoxFolderSet {
  scanFolderId: string; // /SignalVault/{Company}/scans/{timestamp}
  subfolders: Record<Exclude<ArtifactType, "screenshot"> | "screenshots", string>;
  simulated: boolean;
}

export interface BoxUploadResult {
  fileId: string;
  folderId: string;
  url: string; // persisted alongside key per InsForge storage convention
  key: string;
  simulated: boolean;
}

export interface BoxClient extends Adapter {
  /**
   * Create (or resolve) the scan folder tree
   * `/SignalVault/{Company}/scans/{timestamp}/{raw,normalized,screenshots,diffs,claims,reports}`
   * and return the folder ids (Requirements 10.1, 10.2).
   */
  ensureScanFolders(companyName: string, scanTimestamp: string): Promise<BoxFolderSet>;
  /** Upload an artifact into the subfolder matching its {@link ArtifactType}. */
  upload(
    folderId: string,
    artifactType: ArtifactType,
    name: string,
    content: Buffer | string,
  ): Promise<BoxUploadResult>;
  /** Web link for a folder; mock links are allowed in demo mode (Requirement 10.6). */
  folderWebLink(folderId: string): string;
}

/* -------------------------------------------------------------------------- */
/* Supporting domain types                                                    */
/* -------------------------------------------------------------------------- */

/** Lifecycle status of a Scan (mirrors the `scans.status` CHECK constraint). */
export type ScanStatus =
  | "queued"
  | "scraping"
  | "uploading"
  | "diffing"
  | "analyzing"
  | "completed"
  | "failed";

/** External provider an integration record holds credentials for. */
export type IntegrationProvider = "Apify" | "Box";

/** A workspace tenant boundary (mirrors the `workspaces` table). */
export interface Workspace {
  id: string;
  name: string;
  isDemo: boolean;
  createdAt: string;
}

/**
 * The authenticated session passed to {@link InsForgeClient.getActiveWorkspace}.
 * Minimal by design: it carries the authenticated user and, when known, the id
 * of the workspace the user has made active.
 */
export interface Session {
  userId: string;
  activeWorkspaceId?: string;
}

/** A monitored Company (mirrors the `companies` table). */
export interface Company {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  slug: string;
  createdAt: string;
}

/** A public URL watched for a Company (mirrors the `watched_sources` table). */
export interface WatchedSource {
  id: string;
  companyId: string;
  url: string;
  sourceType: SourceType;
  createdAt: string;
}

/** A scan run over a Company's watched sources (mirrors the `scans` table). */
export interface Scan {
  id: string;
  workspaceId: string;
  companyId: string;
  status: ScanStatus;
  triggerType: string;
  failureReason?: string | null;
  boxScanFolderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Captured evidence for one source in one scan (mirrors the `snapshots` table). */
export interface Snapshot {
  id: string;
  scanId: string;
  watchedSourceId: string;
  rawArtifactUrl?: string | null;
  rawArtifactKey?: string | null;
  rawBoxFileId?: string | null;
  normalizedArtifactUrl?: string | null;
  normalizedArtifactKey?: string | null;
  normalizedBoxFileId?: string | null;
  screenshotArtifactUrl?: string | null;
  screenshotArtifactKey?: string | null;
  screenshotBoxFileId?: string | null;
  contentHash?: string | null; // hash of raw HTML
  normalizedTextHash?: string | null; // hash of normalized content
  simulated: boolean;
  createdAt: string;
}

/**
 * A persisted diff between a prior and current snapshot (mirrors the `diffs`
 * table). Reuses the canonical {@link Diff} content (prior/current snapshot
 * refs + computed change fields) and adds the persistence-only columns.
 */
export interface DiffRow extends Diff {
  id: string;
  scanId: string;
  diffBoxFileId?: string | null;
  createdAt: string;
}

/**
 * A persisted public claim (mirrors the `claims` table). Reuses the shared
 * {@link Claim} fields and adds persistence + classification columns.
 */
export interface ClaimRow extends Claim {
  id: string;
  scanId: string;
  snapshotId: string;
  claimStatus?: ClaimStatus | null;
  riskLevel?: string | null;
  createdAt: string;
}

/**
 * A persisted strategy verdict (mirrors the `verdicts` table). The
 * strategy/confidence/risk/action fields match the shared `Verdict` schema.
 */
export interface VerdictRow {
  id: string;
  scanId: string;
  workspaceId: string;
  strategyPrediction: Strategy;
  confidence: number; // int 0..100
  riskScore: number; // int 0..100
  recommendedActions: string[]; // 1..10 entries
  keyEvidence: string[];
  counterEvidence: string[];
  isFallback: boolean;
  createdAt: string;
}

/** A stored external-provider credential record (mirrors the `integrations` table). */
export interface Integration {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  credentialCiphertext?: string | null; // encrypted (live) or mock placeholder (demo)
  isMock: boolean;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Insert (write) shapes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Insert shapes for the repositories. Per InsForge convention, inserts take an
 * array (`insert([{ ... }])`), which the repository `create`/`add`/`upsert`
 * methods reflect by accepting arrays of these shapes. Server-generated columns
 * (`id`, `createdAt`/`updatedAt`) are omitted; `workspaceId` is omitted on
 * workspace-owned rows because the repository is already bound to a workspace
 * (see {@link WorkspaceRepository}).
 */
export type NewCompany = Omit<Company, "id" | "workspaceId" | "createdAt">;
export type NewWatchedSource = Omit<WatchedSource, "id" | "createdAt">;
export type NewScan = Omit<
  Scan,
  "id" | "workspaceId" | "createdAt" | "updatedAt" | "status"
> & { status?: ScanStatus };
export type NewSnapshot = Omit<Snapshot, "id" | "createdAt">;
export type NewDiff = Omit<DiffRow, "id" | "createdAt">;
export type NewClaim = Omit<ClaimRow, "id" | "createdAt">;
export type NewVerdict = Omit<VerdictRow, "id" | "workspaceId" | "createdAt">;
export type NewIntegration = Omit<Integration, "id" | "workspaceId" | "createdAt">;

/* -------------------------------------------------------------------------- */
/* InsForgeClient (InsForge_Adapter) + workspace-scoped repositories          */
/* -------------------------------------------------------------------------- */

/**
 * Repository for Companies and their Watched_Sources, bound to one workspace.
 * No method accepts a `workspaceId`; the binding prevents cross-tenant queries
 * (Requirements 1.4, 21.7).
 */
export interface CompanyRepo {
  /** Insert companies (array form) into the bound workspace. */
  create(rows: NewCompany[]): Promise<Company[]>;
  /** All companies in the bound workspace. */
  list(): Promise<Company[]>;
  /** A single company by id, or null when it is outside the bound workspace. */
  get(id: string): Promise<Company | null>;
  update(id: string, patch: Partial<NewCompany>): Promise<Company>;
  /**
   * Delete a company in the bound workspace, cascading to its Watched_Sources
   * via the `ON DELETE CASCADE` foreign key. A no-op when `id` is absent or
   * owned by another workspace — mirroring a workspace-filtered SQL `DELETE`.
   * Used for best-effort atomic rollback when Watched_Source creation fails
   * after the company row was already created (Requirement 4.8).
   */
  delete(id: string): Promise<void>;
  /** Insert watched sources (array form) for a company in the bound workspace. */
  addSources(rows: NewWatchedSource[]): Promise<WatchedSource[]>;
  /** Watched sources for a company in the bound workspace. */
  listSources(companyId: string): Promise<WatchedSource[]>;
}

export interface ScanRepo {
  create(rows: NewScan[]): Promise<Scan[]>;
  get(id: string): Promise<Scan | null>;
  /** Scans for a company in the bound workspace, newest first. */
  listForCompany(companyId: string): Promise<Scan[]>;
  /** Update a scan's status (and optional failure reason / box folder id). */
  updateStatus(
    id: string,
    status: ScanStatus,
    patch?: Partial<Pick<Scan, "failureReason" | "boxScanFolderId">>,
  ): Promise<Scan>;
  /**
   * The most recently completed scan for a company that started before
   * `before` — used by `findPreviousSnapshotStep` to locate prior evidence
   * (Requirement 11.1). Returns null when there is no earlier completed scan.
   */
  mostRecentCompleted(companyId: string, before?: string): Promise<Scan | null>;
}

export interface SnapshotRepo {
  create(rows: NewSnapshot[]): Promise<Snapshot[]>;
  get(id: string): Promise<Snapshot | null>;
  /** Snapshots produced by a scan in the bound workspace. */
  listForScan(scanId: string): Promise<Snapshot[]>;
  /** Patch evidence refs/hashes after upload + normalization. */
  update(id: string, patch: Partial<NewSnapshot>): Promise<Snapshot>;
}

export interface DiffRepo {
  create(rows: NewDiff[]): Promise<DiffRow[]>;
  /** Diffs computed for a scan in the bound workspace. */
  listForScan(scanId: string): Promise<DiffRow[]>;
}

export interface ClaimRepo {
  create(rows: NewClaim[]): Promise<ClaimRow[]>;
  /** Claims extracted within a scan in the bound workspace. */
  listForScan(scanId: string): Promise<ClaimRow[]>;
  /** Persist the classifier's status for a claim. */
  updateStatus(id: string, status: ClaimStatus): Promise<ClaimRow>;
}

export interface VerdictRepo {
  create(rows: NewVerdict[]): Promise<VerdictRow[]>;
  /** The verdict concluding a scan, or null when none has been persisted. */
  getForScan(scanId: string): Promise<VerdictRow | null>;
}

export interface IntegrationRepo {
  /** Insert or replace integration credentials (array form) for the workspace. */
  upsert(rows: NewIntegration[]): Promise<Integration[]>;
  get(provider: IntegrationProvider): Promise<Integration | null>;
  list(): Promise<Integration[]>;
}

/**
 * A repository bound to a single `workspaceId`. Every read/write is constrained
 * to that workspace so callers cannot accidentally query another tenant
 * (Requirements 1.4, 21.7).
 */
export interface WorkspaceRepository {
  companies: CompanyRepo;
  scans: ScanRepo;
  snapshots: SnapshotRepo;
  diffs: DiffRepo;
  claims: ClaimRepo;
  verdicts: VerdictRepo;
  integrations: IntegrationRepo;
}

export interface InsForgeClient extends Adapter {
  /**
   * Returns a workspace-scoped repository; every query is constrained to
   * `workspaceId` (Requirements 1.4, 21.7).
   */
  scoped(workspaceId: string): WorkspaceRepository;
  /** Resolve the active workspace for an authenticated session. */
  getActiveWorkspace(session: Session): Promise<Workspace>;
  // Realtime publish is handled DB-side via triggers; clients subscribe.
}

/* -------------------------------------------------------------------------- */
/* ModelClient (Model_Adapter)                                                */
/* -------------------------------------------------------------------------- */

export interface InferenceMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface InferenceRequest {
  system: string;
  messages: InferenceMessage[];
  responseSchemaName: string; // for tracing
  timeoutMs: number; // <= 60_000
}

export interface ModelClient extends Adapter {
  /** Returns raw model text; callers validate against a Zod schema. */
  complete(req: InferenceRequest): Promise<{ text: string; simulated: boolean }>;
}

// Re-export the shared diff type used by DiffRow so adapter consumers have a
// single import site for the adapter surface.
export type { Diff, ModifiedSection };
