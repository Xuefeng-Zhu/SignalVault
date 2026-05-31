/**
 * In-memory implementation of {@link InsForgeClient} for tests.
 *
 * Provides the same workspace-scoped repository semantics as the live client
 * but stores everything in memory. No network, no credentials, no demo seed
 * data. Each instance owns its own isolated state.
 */
import { createHash, randomUUID } from "node:crypto";

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

/* -------------------------------------------------------------------------- */
/* Stable fixture identifiers                                                 */
/* -------------------------------------------------------------------------- */

/** Stable id of the default test workspace. */
export const TEST_WORKSPACE_ID = "test-workspace-default";
/** Human-readable name of the default test workspace. */
export const TEST_WORKSPACE_NAME = "Test Workspace";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function clone<T>(value: T): T {
  return structuredClone(value);
}

function byCreatedAtDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/* -------------------------------------------------------------------------- */
/* Backing store                                                              */
/* -------------------------------------------------------------------------- */

class InMemoryStore {
  readonly workspaces = new Map<string, Workspace>();
  readonly companies = new Map<string, Company>();
  readonly watchedSources = new Map<string, WatchedSource>();
  readonly scans = new Map<string, Scan>();
  readonly snapshots = new Map<string, Snapshot>();
  readonly diffs = new Map<string, DiffRow>();
  readonly claims = new Map<string, ClaimRow>();
  readonly verdicts = new Map<string, VerdictRow>();
  readonly integrations = new Map<string, Integration>();

  private readonly baseEpochMs = Date.parse("2026-05-01T00:00:00.000Z");
  private tick = 0;

  now(): string {
    return new Date(this.baseEpochMs + this.tick++ * 1000).toISOString();
  }

  put<T extends { id: string }>(map: Map<string, T>, row: T): T {
    const stored = clone(row);
    map.set(row.id, stored);
    return clone(stored);
  }

  scanWorkspace(scanId: string): string | undefined {
    return this.scans.get(scanId)?.workspaceId;
  }

  companyWorkspace(companyId: string): string | undefined {
    return this.companies.get(companyId)?.workspaceId;
  }
}

/* -------------------------------------------------------------------------- */
/* Workspace-scoped repositories                                              */
/* -------------------------------------------------------------------------- */

class MemoryCompanyRepo implements CompanyRepo {
  constructor(
    private readonly store: InMemoryStore,
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
    if (!company || company.workspaceId !== this.workspaceId) {
      return;
    }
    for (const source of [...this.store.watchedSources.values()]) {
      if (source.companyId === id) {
        this.store.watchedSources.delete(source.id);
      }
    }
    this.store.companies.delete(id);
  }

  async addSources(rows: NewWatchedSource[]): Promise<WatchedSource[]> {
    return rows.map((row) => {
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

class MemoryScanRepo implements ScanRepo {
  constructor(
    private readonly store: InMemoryStore,
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

class MemorySnapshotRepo implements SnapshotRepo {
  constructor(
    private readonly store: InMemoryStore,
    private readonly workspaceId: string,
  ) {}

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
    const { scanId: _scanId, ...rest } = patch;
    const updated: Snapshot = { ...snapshot, ...rest };
    return this.store.put(this.store.snapshots, updated);
  }
}

class MemoryDiffRepo implements DiffRepo {
  constructor(
    private readonly store: InMemoryStore,
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

class MemoryClaimRepo implements ClaimRepo {
  constructor(
    private readonly store: InMemoryStore,
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

class MemoryVerdictRepo implements VerdictRepo {
  constructor(
    private readonly store: InMemoryStore,
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

class MemoryIntegrationRepo implements IntegrationRepo {
  constructor(
    private readonly store: InMemoryStore,
    private readonly workspaceId: string,
  ) {}

  async upsert(rows: NewIntegration[]): Promise<Integration[]> {
    return rows.map((row) => {
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

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly companies: CompanyRepo;
  readonly scans: ScanRepo;
  readonly snapshots: SnapshotRepo;
  readonly diffs: DiffRepo;
  readonly claims: ClaimRepo;
  readonly verdicts: VerdictRepo;
  readonly integrations: IntegrationRepo;

  constructor(store: InMemoryStore, workspaceId: string) {
    this.companies = new MemoryCompanyRepo(store, workspaceId);
    this.scans = new MemoryScanRepo(store, workspaceId);
    this.snapshots = new MemorySnapshotRepo(store, workspaceId);
    this.diffs = new MemoryDiffRepo(store, workspaceId);
    this.claims = new MemoryClaimRepo(store, workspaceId);
    this.verdicts = new MemoryVerdictRepo(store, workspaceId);
    this.integrations = new MemoryIntegrationRepo(store, workspaceId);
  }
}

/* -------------------------------------------------------------------------- */
/* In-memory InsForge client                                                  */
/* -------------------------------------------------------------------------- */

/**
 * In-memory implementation of {@link InsForgeClient} for tests.
 * Each instance owns isolated state. No demo seeding, no credentials.
 */
export class InMemoryInsForgeClient implements InsForgeClient {
  readonly mode: RunMode = "live";

  private readonly store = new InMemoryStore();
  private readonly defaultWorkspace: Workspace;

  constructor() {
    this.defaultWorkspace = {
      id: TEST_WORKSPACE_ID,
      name: TEST_WORKSPACE_NAME,
      isDemo: false,
      createdAt: this.store.now(),
    };
    this.store.workspaces.set(this.defaultWorkspace.id, clone(this.defaultWorkspace));
  }

  isConfigured(): boolean {
    return true;
  }

  scoped(workspaceId: string): WorkspaceRepository {
    return new MemoryWorkspaceRepository(this.store, workspaceId);
  }

  async getActiveWorkspace(_session: Session): Promise<Workspace> {
    return clone(this.defaultWorkspace);
  }

  get defaultWorkspaceId(): string {
    return this.defaultWorkspace.id;
  }
}

/**
 * Construct an {@link InMemoryInsForgeClient}.
 * Drop-in replacement for the old `createDemoInsForgeClient({ seedDemoCompany: false })`.
 */
export function createInMemoryInsForgeClient(): InMemoryInsForgeClient {
  return new InMemoryInsForgeClient();
}
