// `import type` for the adapter surface keeps this module free of the
// `server-only` runtime guard that `@/lib/adapters/types` pulls in, so the
// in-memory store and its workspace-scoping logic stay unit-testable while the
// demo *client entry* (`./demo`) remains server-only. This mirrors the apify
// (`demo-capture`/`demo`) and model (`demo-inference`/`demo`) adapter splits.
// The demo store holds no secrets, so there is nothing credential-sensitive to
// keep out of the browser bundle here.
import { createHash, randomUUID } from "node:crypto";

import { makeDiff } from "@/lib/diff";
import {
  ACME_DEMO_COMPANY,
  ACME_WATCHED_SOURCES,
  acmeClaims,
  acmeSnapshots,
  DEMO_VERDICT,
  type DemoSnapshot,
  type DemoSourceRole,
} from "@/lib/demo";
import type { ClaimStatus } from "@/lib/schemas";
import type {
  Company,
  CompanyRepo,
  DiffRepo,
  DiffRow,
  InsForgeClient,
  Integration,
  IntegrationProvider,
  IntegrationRepo,
  NewClaim,
  NewCompany,
  NewDiff,
  NewIntegration,
  NewScan,
  NewSnapshot,
  NewVerdict,
  NewWatchedSource,
  RunMode,
  Scan,
  ScanRepo,
  ScanStatus,
  Session,
  Snapshot,
  SnapshotRepo,
  ClaimRepo,
  ClaimRow,
  VerdictRepo,
  VerdictRow,
  WatchedSource,
  Workspace,
  WorkspaceRepository,
} from "@/lib/adapters/types";

/**
 * Deterministic, in-memory demo implementation of {@link InsForgeClient}
 * (InsForge_Adapter) and its workspace-scoped {@link WorkspaceRepository}.
 *
 * The adapter factory (task 6.2) selects this store whenever `DEMO_MODE` is
 * active or InsForge credentials are missing (Requirements 18.1, 1.6). It holds
 * no secrets and makes no network calls: every table is an in-memory `Map`, and
 * the store is pre-seeded with a single default demo Workspace plus the
 * Demo_Company "Acme AI", its four Watched_Sources, and a reproducible scan
 * history built entirely from the deterministic `lib/demo` seed.
 *
 * The repository surface, scoping semantics, and array-form inserts are
 * IDENTICAL to the live client (task 7.1) so the factory can swap live/demo
 * transparently. Every repository is bound to one `workspaceId`; no method
 * accepts a cross-workspace id, and reads/writes for another tenant return
 * empty results or throw, mirroring the RLS isolation of the live backend
 * (Requirements 1.4, 21.7).
 *
 * Determinism notes:
 *  - Seeded rows use stable, human-readable ids (see the `DEMO_*_ID` exports);
 *    rows created at runtime use {@link randomUUID}, exactly as a real DB would
 *    hand back server-generated ids.
 *  - Timestamps come from a monotonic, instance-local clock anchored at a fixed
 *    epoch, so insertion order (and therefore "newest first" / "most recent
 *    completed" queries) is stable and reproducible. `lib/demo` remains the
 *    source of determinism for scan *content*; this store only needs to behave
 *    like a database.
 *
 * Each `DemoInsForgeClient` instance owns its own state. Callers that need state
 * to persist across requests within a process should hold a single instance.
 */

/* -------------------------------------------------------------------------- */
/* Stable seed identifiers                                                    */
/* -------------------------------------------------------------------------- */

/** Stable id of the single default demo Workspace (Requirement 1.6). */
export const DEMO_WORKSPACE_ID = "demo-workspace-acme";
/** Human-readable name of the default demo Workspace. */
export const DEMO_WORKSPACE_NAME = "Demo Workspace";
/** Stable id of the seeded Demo_Company "Acme AI". */
export const DEMO_COMPANY_ID = "demo-company-acme-ai";
/** Stable id of the older, baseline (previous-state) seeded Scan. */
export const DEMO_BASELINE_SCAN_ID = "demo-scan-acme-baseline";
/** Stable id of the newer, latest (current-state) seeded Scan that holds the verdict. */
export const DEMO_LATEST_SCAN_ID = "demo-scan-acme-latest";

/** Options controlling what the in-memory store is seeded with. */
export interface DemoInsForgeOptions {
  /**
   * When true (default), seed the Demo_Company "Acme AI", its Watched_Sources,
   * and the reproducible baseline + latest scan history. The default Workspace
   * is always created regardless so {@link InsForgeClient.getActiveWorkspace}
   * can resolve it (Requirement 1.6).
   */
  seedDemoCompany?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Deep copy used so the store never hands out (or stores) shared references. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Deterministic SHA-256 hex digest of a UTF-8 string. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Newest-first comparator over an ISO `createdAt` timestamp. */
function byCreatedAtDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** Map each Demo source role to its normalized content for one snapshot state. */
function contentByRole(snapshot: DemoSnapshot): Map<DemoSourceRole, string> {
  const map = new Map<DemoSourceRole, string>();
  for (const source of snapshot.sources) {
    map.set(source.pageRole, source.normalizedContent);
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Backing store                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The in-memory "database": one `Map<id, row>` per table plus a monotonic
 * clock. Scoping is enforced by the repositories, not here; this type only
 * stores rows and resolves the owning workspace for rows that reference a scan
 * or company instead of carrying `workspaceId` directly.
 */
class DemoStore {
  readonly workspaces = new Map<string, Workspace>();
  readonly companies = new Map<string, Company>();
  readonly watchedSources = new Map<string, WatchedSource>();
  readonly scans = new Map<string, Scan>();
  readonly snapshots = new Map<string, Snapshot>();
  readonly diffs = new Map<string, DiffRow>();
  readonly claims = new Map<string, ClaimRow>();
  readonly verdicts = new Map<string, VerdictRow>();
  readonly integrations = new Map<string, Integration>();

  /** Anchored at a fixed epoch so seeded timestamps are reproducible. */
  private readonly baseEpochMs = Date.parse("2024-01-01T00:00:00.000Z");
  private tick = 0;

  /** Strictly increasing ISO timestamp; successive calls are 1s apart. */
  now(): string {
    return new Date(this.baseEpochMs + this.tick++ * 1000).toISOString();
  }

  /** Store a defensive copy of `row` and return a fresh copy to the caller. */
  put<T extends { id: string }>(map: Map<string, T>, row: T): T {
    const stored = clone(row);
    map.set(row.id, stored);
    return clone(stored);
  }

  /** The `workspaceId` that owns a scan, or undefined when the scan is unknown. */
  scanWorkspace(scanId: string): string | undefined {
    return this.scans.get(scanId)?.workspaceId;
  }

  /** The `workspaceId` that owns a company, or undefined when unknown. */
  companyWorkspace(companyId: string): string | undefined {
    return this.companies.get(companyId)?.workspaceId;
  }
}

/* -------------------------------------------------------------------------- */
/* Workspace-scoped repositories                                              */
/* -------------------------------------------------------------------------- */

/**
 * Companies + Watched_Sources for one workspace. Inserts land in the bound
 * workspace; reads exclude rows owned by any other workspace (Requirements
 * 1.4, 21.7).
 */
class DemoCompanyRepo implements CompanyRepo {
  constructor(
    private readonly store: DemoStore,
    private readonly workspaceId: string,
  ) {}

  async create(rows: NewCompany[]): Promise<Company[]> {
    return rows.map((row) =>
      this.store.put<Company>(this.store.companies, {
        id: randomUUID(),
        workspaceId: this.workspaceId,
        name: row.name,
        domain: row.domain,
        slug: row.slug,
        createdAt: this.store.now(),
      }),
    );
  }

  async list(): Promise<Company[]> {
    return [...this.store.companies.values()]
      .filter((c) => c.workspaceId === this.workspaceId)
      .map(clone);
  }

  async get(id: string): Promise<Company | null> {
    const company = this.store.companies.get(id);
    return company && company.workspaceId === this.workspaceId ? clone(company) : null;
  }

  async update(id: string, patch: Partial<NewCompany>): Promise<Company> {
    const company = this.store.companies.get(id);
    if (!company || company.workspaceId !== this.workspaceId) {
      throw new Error(`Company ${id} not found in workspace ${this.workspaceId}`);
    }
    const updated: Company = {
      ...company,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
    };
    return this.store.put(this.store.companies, updated);
  }

  async delete(id: string): Promise<void> {
    const company = this.store.companies.get(id);
    // No-op when absent or owned by another workspace (workspace-filtered
    // delete semantics) so a cross-tenant id can never remove another tenant's
    // data (Requirements 1.4, 21.7).
    if (!company || company.workspaceId !== this.workspaceId) {
      return;
    }
    // Cascade to the company's Watched_Sources, mirroring the
    // `ON DELETE CASCADE` foreign key in the live schema.
    for (const source of [...this.store.watchedSources.values()]) {
      if (source.companyId === id) {
        this.store.watchedSources.delete(source.id);
      }
    }
    this.store.companies.delete(id);
  }

  async addSources(rows: NewWatchedSource[]): Promise<WatchedSource[]> {
    return rows.map((row) => {
      // Guard: only attach sources to companies inside the bound workspace.
      if (this.store.companyWorkspace(row.companyId) !== this.workspaceId) {
        throw new Error(
          `Company ${row.companyId} not found in workspace ${this.workspaceId}`,
        );
      }
      return this.store.put<WatchedSource>(this.store.watchedSources, {
        id: randomUUID(),
        companyId: row.companyId,
        url: row.url,
        sourceType: row.sourceType,
        createdAt: this.store.now(),
      });
    });
  }

  async listSources(companyId: string): Promise<WatchedSource[]> {
    if (this.store.companyWorkspace(companyId) !== this.workspaceId) {
      return [];
    }
    return [...this.store.watchedSources.values()]
      .filter((s) => s.companyId === companyId)
      .map(clone);
  }
}

/** Scans for one workspace. */
class DemoScanRepo implements ScanRepo {
  constructor(
    private readonly store: DemoStore,
    private readonly workspaceId: string,
  ) {}

  async create(rows: NewScan[]): Promise<Scan[]> {
    return rows.map((row) => {
      const ts = this.store.now();
      return this.store.put<Scan>(this.store.scans, {
        id: randomUUID(),
        workspaceId: this.workspaceId,
        companyId: row.companyId,
        status: row.status ?? "queued",
        triggerType: row.triggerType,
        failureReason: row.failureReason ?? null,
        boxScanFolderId: row.boxScanFolderId ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
    });
  }

  async get(id: string): Promise<Scan | null> {
    const scan = this.store.scans.get(id);
    return scan && scan.workspaceId === this.workspaceId ? clone(scan) : null;
  }

  async listForCompany(companyId: string): Promise<Scan[]> {
    return [...this.store.scans.values()]
      .filter((s) => s.workspaceId === this.workspaceId && s.companyId === companyId)
      .sort(byCreatedAtDesc)
      .map(clone);
  }

  async updateStatus(
    id: string,
    status: ScanStatus,
    patch?: Partial<Pick<Scan, "failureReason" | "boxScanFolderId">>,
  ): Promise<Scan> {
    const scan = this.store.scans.get(id);
    if (!scan || scan.workspaceId !== this.workspaceId) {
      throw new Error(`Scan ${id} not found in workspace ${this.workspaceId}`);
    }
    const updated: Scan = {
      ...scan,
      status,
      ...(patch && "failureReason" in patch
        ? { failureReason: patch.failureReason ?? null }
        : {}),
      ...(patch && "boxScanFolderId" in patch
        ? { boxScanFolderId: patch.boxScanFolderId ?? null }
        : {}),
      updatedAt: this.store.now(),
    };
    return this.store.put(this.store.scans, updated);
  }

  async mostRecentCompleted(companyId: string, before?: string): Promise<Scan | null> {
    const candidates = [...this.store.scans.values()]
      .filter(
        (s) =>
          s.workspaceId === this.workspaceId &&
          s.companyId === companyId &&
          s.status === "completed" &&
          (before === undefined || s.createdAt < before),
      )
      .sort(byCreatedAtDesc);
    return candidates.length > 0 ? clone(candidates[0]!) : null;
  }
}

/** Snapshots, scoped through their owning scan's workspace. */
class DemoSnapshotRepo implements SnapshotRepo {
  constructor(
    private readonly store: DemoStore,
    private readonly workspaceId: string,
  ) {}

  /** True when `scanId` belongs to the bound workspace. */
  private ownsScan(scanId: string): boolean {
    return this.store.scanWorkspace(scanId) === this.workspaceId;
  }

  async create(rows: NewSnapshot[]): Promise<Snapshot[]> {
    return rows.map((row) => {
      if (!this.ownsScan(row.scanId)) {
        throw new Error(`Scan ${row.scanId} not found in workspace ${this.workspaceId}`);
      }
      return this.store.put<Snapshot>(this.store.snapshots, {
        ...row,
        id: randomUUID(),
        createdAt: this.store.now(),
      });
    });
  }

  async get(id: string): Promise<Snapshot | null> {
    const snapshot = this.store.snapshots.get(id);
    return snapshot && this.ownsScan(snapshot.scanId) ? clone(snapshot) : null;
  }

  async listForScan(scanId: string): Promise<Snapshot[]> {
    if (!this.ownsScan(scanId)) {
      return [];
    }
    return [...this.store.snapshots.values()]
      .filter((s) => s.scanId === scanId)
      .map(clone);
  }

  async update(id: string, patch: Partial<NewSnapshot>): Promise<Snapshot> {
    const snapshot = this.store.snapshots.get(id);
    if (!snapshot || !this.ownsScan(snapshot.scanId)) {
      throw new Error(`Snapshot ${id} not found in workspace ${this.workspaceId}`);
    }
    // `scanId` is immutable on update; drop it if present in the patch.
    const { scanId: _scanId, ...rest } = patch;
    const updated: Snapshot = { ...snapshot, ...rest };
    return this.store.put(this.store.snapshots, updated);
  }
}

/** Diffs, scoped through their owning scan's workspace. */
class DemoDiffRepo implements DiffRepo {
  constructor(
    private readonly store: DemoStore,
    private readonly workspaceId: string,
  ) {}

  async create(rows: NewDiff[]): Promise<DiffRow[]> {
    return rows.map((row) => {
      if (this.store.scanWorkspace(row.scanId) !== this.workspaceId) {
        throw new Error(`Scan ${row.scanId} not found in workspace ${this.workspaceId}`);
      }
      return this.store.put<DiffRow>(this.store.diffs, {
        ...row,
        id: randomUUID(),
        createdAt: this.store.now(),
      });
    });
  }

  async listForScan(scanId: string): Promise<DiffRow[]> {
    if (this.store.scanWorkspace(scanId) !== this.workspaceId) {
      return [];
    }
    return [...this.store.diffs.values()]
      .filter((d) => d.scanId === scanId)
      .map(clone);
  }
}

/** Claims, scoped through their owning scan's workspace. */
class DemoClaimRepo implements ClaimRepo {
  constructor(
    private readonly store: DemoStore,
    private readonly workspaceId: string,
  ) {}

  async create(rows: NewClaim[]): Promise<ClaimRow[]> {
    return rows.map((row) => {
      if (this.store.scanWorkspace(row.scanId) !== this.workspaceId) {
        throw new Error(`Scan ${row.scanId} not found in workspace ${this.workspaceId}`);
      }
      return this.store.put<ClaimRow>(this.store.claims, {
        ...row,
        id: randomUUID(),
        createdAt: this.store.now(),
      });
    });
  }

  async listForScan(scanId: string): Promise<ClaimRow[]> {
    if (this.store.scanWorkspace(scanId) !== this.workspaceId) {
      return [];
    }
    return [...this.store.claims.values()]
      .filter((c) => c.scanId === scanId)
      .map(clone);
  }

  async updateStatus(id: string, status: ClaimStatus): Promise<ClaimRow> {
    const claim = this.store.claims.get(id);
    if (!claim || this.store.scanWorkspace(claim.scanId) !== this.workspaceId) {
      throw new Error(`Claim ${id} not found in workspace ${this.workspaceId}`);
    }
    const updated: ClaimRow = { ...claim, claimStatus: status };
    return this.store.put(this.store.claims, updated);
  }
}

/** Verdicts for one workspace. */
class DemoVerdictRepo implements VerdictRepo {
  constructor(
    private readonly store: DemoStore,
    private readonly workspaceId: string,
  ) {}

  async create(rows: NewVerdict[]): Promise<VerdictRow[]> {
    return rows.map((row) => {
      if (this.store.scanWorkspace(row.scanId) !== this.workspaceId) {
        throw new Error(`Scan ${row.scanId} not found in workspace ${this.workspaceId}`);
      }
      return this.store.put<VerdictRow>(this.store.verdicts, {
        ...row,
        id: randomUUID(),
        workspaceId: this.workspaceId,
        createdAt: this.store.now(),
      });
    });
  }

  async getForScan(scanId: string): Promise<VerdictRow | null> {
    if (this.store.scanWorkspace(scanId) !== this.workspaceId) {
      return null;
    }
    const verdict = [...this.store.verdicts.values()].find(
      (v) => v.scanId === scanId && v.workspaceId === this.workspaceId,
    );
    return verdict ? clone(verdict) : null;
  }
}

/** Integration credential records for one workspace. */
class DemoIntegrationRepo implements IntegrationRepo {
  constructor(
    private readonly store: DemoStore,
    private readonly workspaceId: string,
  ) {}

  async upsert(rows: NewIntegration[]): Promise<Integration[]> {
    return rows.map((row) => {
      // Replace any existing record for this workspace + provider.
      const existing = [...this.store.integrations.values()].find(
        (i) => i.workspaceId === this.workspaceId && i.provider === row.provider,
      );
      const id = existing?.id ?? randomUUID();
      const createdAt = existing?.createdAt ?? this.store.now();
      return this.store.put<Integration>(this.store.integrations, {
        id,
        workspaceId: this.workspaceId,
        provider: row.provider,
        credentialCiphertext: row.credentialCiphertext ?? null,
        isMock: row.isMock,
        createdAt,
      });
    });
  }

  async get(provider: IntegrationProvider): Promise<Integration | null> {
    const integration = [...this.store.integrations.values()].find(
      (i) => i.workspaceId === this.workspaceId && i.provider === provider,
    );
    return integration ? clone(integration) : null;
  }

  async list(): Promise<Integration[]> {
    return [...this.store.integrations.values()]
      .filter((i) => i.workspaceId === this.workspaceId)
      .map(clone);
  }
}

/** A {@link WorkspaceRepository} bound to one workspace, backed by a {@link DemoStore}. */
class DemoWorkspaceRepository implements WorkspaceRepository {
  readonly companies: CompanyRepo;
  readonly scans: ScanRepo;
  readonly snapshots: SnapshotRepo;
  readonly diffs: DiffRepo;
  readonly claims: ClaimRepo;
  readonly verdicts: VerdictRepo;
  readonly integrations: IntegrationRepo;

  constructor(store: DemoStore, workspaceId: string) {
    this.companies = new DemoCompanyRepo(store, workspaceId);
    this.scans = new DemoScanRepo(store, workspaceId);
    this.snapshots = new DemoSnapshotRepo(store, workspaceId);
    this.diffs = new DemoDiffRepo(store, workspaceId);
    this.claims = new DemoClaimRepo(store, workspaceId);
    this.verdicts = new DemoVerdictRepo(store, workspaceId);
    this.integrations = new DemoIntegrationRepo(store, workspaceId);
  }
}

/* -------------------------------------------------------------------------- */
/* Demo InsForge client                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Demo implementation of {@link InsForgeClient}. Wraps an in-memory
 * {@link DemoStore}, exposes workspace-scoped repositories via {@link scoped},
 * and resolves every session to the single default demo Workspace.
 */
export class DemoInsForgeClient implements InsForgeClient {
  /** This adapter is the demo path; it never operates against a live backend. */
  readonly mode: RunMode = "demo";

  private readonly store = new DemoStore();
  private readonly defaultWorkspace: Workspace;

  constructor(options: DemoInsForgeOptions = {}) {
    this.defaultWorkspace = this.seed(options.seedDemoCompany ?? true);
  }

  /** Always false: the demo store holds no live InsForge credentials (Requirement 18.1). */
  isConfigured(): boolean {
    return false;
  }

  /**
   * Return a repository constrained to `workspaceId`. Every query through the
   * returned repository is scoped to that workspace; rows owned by any other
   * workspace are excluded (Requirements 1.4, 21.7).
   */
  scoped(workspaceId: string): WorkspaceRepository {
    return new DemoWorkspaceRepository(this.store, workspaceId);
  }

  /**
   * Resolve the active workspace for a session. In Demo_Mode there is exactly
   * one default Workspace and it is always returned, so the demo flow proceeds
   * without external authentication (Requirement 1.6). The `session` argument is
   * accepted for interface parity with the live client but is not consulted.
   */
  async getActiveWorkspace(_session: Session): Promise<Workspace> {
    return clone(this.defaultWorkspace);
  }

  /** Expose the stable default workspace id for callers/middleware. */
  get defaultWorkspaceId(): string {
    return this.defaultWorkspace.id;
  }

  /* ------------------------------------------------------------------------ */
  /* Seeding                                                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * Seed the default demo Workspace and (optionally) the Demo_Company "Acme AI"
   * with a reproducible two-scan history derived from the `lib/demo` seed:
   *
   *  - a baseline scan carrying the previous-state snapshots, and
   *  - a latest (completed) scan carrying the current-state snapshots, the
   *    diffs between previous and current per source, the classified claims,
   *    and the deterministic "Moving upmarket" verdict (confidence 82).
   *
   * Returns the default Workspace so the constructor can retain it.
   */
  private seed(seedDemoCompany: boolean): Workspace {
    const workspace: Workspace = {
      id: DEMO_WORKSPACE_ID,
      name: DEMO_WORKSPACE_NAME,
      isDemo: true,
      createdAt: this.store.now(),
    };
    this.store.workspaces.set(workspace.id, clone(workspace));

    if (!seedDemoCompany) {
      return workspace;
    }

    // --- Company + watched sources ---------------------------------------
    const company: Company = {
      id: DEMO_COMPANY_ID,
      workspaceId: workspace.id,
      name: ACME_DEMO_COMPANY.name,
      domain: ACME_DEMO_COMPANY.domain,
      slug: ACME_DEMO_COMPANY.slug,
      createdAt: this.store.now(),
    };
    this.store.companies.set(company.id, clone(company));

    // Stable per-role source ids so snapshots/diffs can reference them.
    const sourceIdByRole = new Map<DemoSourceRole, string>();
    for (const source of ACME_WATCHED_SOURCES) {
      const id = `demo-source-${company.slug}-${source.pageRole}`;
      sourceIdByRole.set(source.pageRole, id);
      const watched: WatchedSource = {
        id,
        companyId: company.id,
        url: source.url,
        sourceType: source.pageRole,
        createdAt: this.store.now(),
      };
      this.store.watchedSources.set(watched.id, clone(watched));
    }

    const previous = acmeSnapshots.find((s) => s.state === "previous");
    const current = acmeSnapshots.find((s) => s.state === "current");
    if (!previous || !current) {
      // Defensive: the seed always provides both states. Without them, return
      // the workspace with just the company so the store stays consistent.
      return workspace;
    }

    // --- Baseline scan (previous-state snapshots) ------------------------
    const baselineScan: Scan = {
      id: DEMO_BASELINE_SCAN_ID,
      workspaceId: workspace.id,
      companyId: company.id,
      status: "completed",
      triggerType: "seed",
      failureReason: null,
      boxScanFolderId: `mock-folder-scan-${DEMO_BASELINE_SCAN_ID}`,
      createdAt: this.store.now(),
      updatedAt: this.store.now(),
    };
    this.store.scans.set(baselineScan.id, clone(baselineScan));

    const previousSnapshotIdByRole = this.seedSnapshots(
      baselineScan.id,
      previous,
      sourceIdByRole,
      "previous",
    );

    // --- Latest scan (current-state snapshots + diffs + claims + verdict) -
    const latestScan: Scan = {
      id: DEMO_LATEST_SCAN_ID,
      workspaceId: workspace.id,
      companyId: company.id,
      status: "completed",
      triggerType: "seed",
      failureReason: null,
      boxScanFolderId: `mock-folder-scan-${DEMO_LATEST_SCAN_ID}`,
      createdAt: this.store.now(),
      updatedAt: this.store.now(),
    };
    this.store.scans.set(latestScan.id, clone(latestScan));

    const currentSnapshotIdByRole = this.seedSnapshots(
      latestScan.id,
      current,
      sourceIdByRole,
      "current",
    );

    this.seedDiffs(latestScan.id, previous, current, previousSnapshotIdByRole, currentSnapshotIdByRole);
    this.seedClaims(latestScan.id, currentSnapshotIdByRole, previousSnapshotIdByRole);
    this.seedVerdict(latestScan.id, workspace.id);

    return workspace;
  }

  /**
   * Seed one snapshot row per Demo source for a scan, deriving deterministic
   * content hashes from the seeded normalized content. Returns a map from
   * source role to the created snapshot id.
   */
  private seedSnapshots(
    scanId: string,
    snapshot: DemoSnapshot,
    sourceIdByRole: Map<DemoSourceRole, string>,
    state: "previous" | "current",
  ): Map<DemoSourceRole, string> {
    const snapshotIdByRole = new Map<DemoSourceRole, string>();
    for (const source of snapshot.sources) {
      const watchedSourceId = sourceIdByRole.get(source.pageRole);
      if (watchedSourceId === undefined) {
        continue;
      }
      const id = `demo-snapshot-${state}-${source.pageRole}`;
      snapshotIdByRole.set(source.pageRole, id);
      const hash = sha256Hex(source.normalizedContent);
      const row: Snapshot = {
        id,
        scanId,
        watchedSourceId,
        rawArtifactUrl: `https://mock.box/file/mock-raw-${id}`,
        rawArtifactKey: `mock-raw/${id}`,
        rawBoxFileId: `mock-file-raw-${id}`,
        normalizedArtifactUrl: `https://mock.box/file/mock-normalized-${id}`,
        normalizedArtifactKey: `mock-normalized/${id}`,
        normalizedBoxFileId: `mock-file-normalized-${id}`,
        screenshotArtifactUrl: `https://mock.box/file/mock-screenshot-${id}`,
        screenshotArtifactKey: `mock-screenshots/${id}`,
        screenshotBoxFileId: `mock-file-screenshot-${id}`,
        contentHash: hash,
        normalizedTextHash: hash,
        simulated: true,
        createdAt: this.store.now(),
      };
      this.store.snapshots.set(row.id, clone(row));
    }
    return snapshotIdByRole;
  }

  /**
   * Seed one diff row per source comparing the previous and current normalized
   * content, using the canonical {@link makeDiff} so the seeded diffs match what
   * the real diff engine would compute.
   */
  private seedDiffs(
    scanId: string,
    previous: DemoSnapshot,
    current: DemoSnapshot,
    previousSnapshotIdByRole: Map<DemoSourceRole, string>,
    currentSnapshotIdByRole: Map<DemoSourceRole, string>,
  ): void {
    const priorContent = contentByRole(previous);
    const currentContent = contentByRole(current);

    for (const [role, currentSnapshotId] of currentSnapshotIdByRole) {
      const prior = priorContent.get(role) ?? "";
      const curr = currentContent.get(role) ?? "";
      const priorSnapshotId = previousSnapshotIdByRole.get(role) ?? null;
      const diff = makeDiff(prior, curr, priorSnapshotId, currentSnapshotId);
      const id = `demo-diff-${role}`;
      const row: DiffRow = {
        ...diff,
        id,
        scanId,
        diffBoxFileId: `mock-file-diff-${id}`,
        createdAt: this.store.now(),
      };
      this.store.diffs.set(row.id, clone(row));
    }
  }

  /**
   * Seed the classified claims for the latest scan. Each claim is attached to
   * the snapshot (current or previous) whose state grounds its evidence text,
   * preserving the seeded {@link ClaimStatus}.
   */
  private seedClaims(
    scanId: string,
    currentSnapshotIdByRole: Map<DemoSourceRole, string>,
    previousSnapshotIdByRole: Map<DemoSourceRole, string>,
  ): void {
    acmeClaims.forEach((demoClaim, index) => {
      const lookup =
        demoClaim.snapshotState === "current"
          ? currentSnapshotIdByRole
          : previousSnapshotIdByRole;
      const snapshotId = lookup.get(demoClaim.pageRole);
      if (snapshotId === undefined) {
        return;
      }
      const id = `demo-claim-${index}`;
      const row: ClaimRow = {
        id,
        scanId,
        snapshotId,
        claimType: demoClaim.claimType,
        statementText: demoClaim.statementText,
        evidenceText: demoClaim.evidenceText,
        confidence: demoClaim.confidence,
        claimStatus: demoClaim.claimStatus,
        riskLevel: null,
        createdAt: this.store.now(),
      };
      this.store.claims.set(row.id, clone(row));
    });
  }

  /**
   * Seed the deterministic Demo_Company verdict ("Moving upmarket", confidence
   * 82) concluding the latest scan (Requirements 18.5, 18.6).
   */
  private seedVerdict(scanId: string, workspaceId: string): void {
    const id = `demo-verdict-${scanId}`;
    const row: VerdictRow = {
      id,
      scanId,
      workspaceId,
      strategyPrediction: DEMO_VERDICT.strategyPrediction,
      confidence: DEMO_VERDICT.confidence,
      riskScore: DEMO_VERDICT.riskScore,
      recommendedActions: [...DEMO_VERDICT.recommendedActions],
      keyEvidence: [...DEMO_VERDICT.keyEvidence],
      counterEvidence: [...DEMO_VERDICT.counterEvidence],
      isFallback: DEMO_VERDICT.isFallback,
      createdAt: this.store.now(),
    };
    this.store.verdicts.set(row.id, clone(row));
  }
}

/**
 * Construct a {@link DemoInsForgeClient}. Mirrors the factory's expected call
 * site (task 6.2). By default the store is seeded with the Demo_Company.
 */
export function createDemoInsForgeClient(
  options: DemoInsForgeOptions = {},
): DemoInsForgeClient {
  return new DemoInsForgeClient(options);
}
