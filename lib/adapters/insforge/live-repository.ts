// Testable core of the live InsForgeClient (InsForge_Adapter).
//
// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the repository logic (workspace scoping,
// array-form inserts, parent-chain checks, camelCase<->snake_case mapping) is
// unit-testable while the live *client entry* (`./live`) stays server-only and
// binds the real `@insforge/sdk` client + the caller's auth token.
//
// Scoping strategy (Requirements 1.4, 21.7): every read and write is
// constrained to the bound `workspaceId` IN APPLICATION CODE — in addition to
// the Postgres RLS policies (migration 0002) which enforce the same membership
// rule independently. This is deliberate defense in depth: a query that somehow
// ran with a wider grant would still be narrowed here.
//   * companies / scans / verdicts / integrations carry `workspace_id`
//     directly, so we add `.eq('workspace_id', workspaceId)`.
//   * watched_sources hang off a company; we verify the company is in the
//     workspace before touching them.
//   * snapshots / diffs / claims hang off a scan; reads use a PostgREST
//     `scans!inner(workspace_id)` embed filtered on the workspace, and writes
//     verify the parent scan is in the workspace first.
//
// Inserts are always issued in ARRAY form (`insert([{ ... }])`) per the InsForge
// convention (Requirement 20.1); the mappers turn adapter shapes into the
// snake_case rows the database stores.
import type {
  Company,
  CompanyRepo,
  ClaimRepo,
  ClaimRow,
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
  VerdictRepo,
  VerdictRow,
  WatchedSource,
  Workspace,
  WorkspaceRepository,
} from "@/lib/adapters/types";
import type { ClaimStatus } from "@/lib/schemas";

import {
  fromClaimRow,
  fromCompanyRow,
  fromDiffRow,
  fromIntegrationRow,
  fromScanRow,
  fromSnapshotRow,
  fromVerdictRow,
  fromWatchedSourceRow,
  fromWorkspaceRow,
  toClaimInsert,
  toCompanyInsert,
  toCompanyUpdate,
  toDiffInsert,
  toIntegrationInsert,
  toScanInsert,
  toSnapshotInsert,
  toSnapshotUpdate,
  toVerdictInsert,
  toWatchedSourceInsert,
  type DbRow,
} from "./mappers";

/* -------------------------------------------------------------------------- */
/* Narrow database interface (the slice of @insforge/sdk we depend on)        */
/* -------------------------------------------------------------------------- */

/** Error shape surfaced by the InsForge / PostgREST client. */
export interface DbError {
  message: string;
  code?: string;
}

/** The `{ data, error }` envelope every InsForge database call resolves to. */
export interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

/**
 * A chainable query builder. Modelled on the subset of the `@insforge/sdk`
 * (PostgREST) builder this adapter actually uses; the server-only entry adapts
 * the real client to this shape, and tests provide a lightweight fake.
 */
export interface QueryBuilder extends PromiseLike<DbResult<DbRow[]>> {
  select(columns?: string): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  in(column: string, values: readonly string[]): QueryBuilder;
  lt(column: string, value: string): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  maybeSingle(): PromiseLike<DbResult<DbRow>>;
}

/** A table handle exposing the read/write builders we use. */
export interface TableHandle {
  select(columns?: string): QueryBuilder;
  insert(rows: DbRow[]): QueryBuilder;
  update(values: DbRow): QueryBuilder;
  upsert(rows: DbRow[], options?: { onConflict?: string }): QueryBuilder;
  /** Delete rows matching the chained filters (used for atomic rollback). */
  delete(): QueryBuilder;
}

/** The narrow database surface the live repository depends on. */
export interface InsforgeDatabaseLike {
  from(table: string): TableHandle;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Raised when a request targets a resource outside the bound workspace
 * (Requirements 21.7, 1.5). Route handlers map this to an authorization error.
 */
export class WorkspaceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

/** Raised when the underlying InsForge database call returns an error. */
export class InsForgeRepositoryError extends Error {
  readonly code?: string;
  constructor(operation: string, error: DbError) {
    super(`InsForge ${operation} failed: ${error.message}`);
    this.name = "InsForgeRepositoryError";
    this.code = error.code;
  }
}

/* -------------------------------------------------------------------------- */
/* Table names                                                                */
/* -------------------------------------------------------------------------- */

const TABLES = {
  workspaces: "workspaces",
  workspaceMembers: "workspace_members",
  companies: "companies",
  watchedSources: "watched_sources",
  scans: "scans",
  snapshots: "snapshots",
  diffs: "diffs",
  claims: "claims",
  verdicts: "verdicts",
  integrations: "integrations",
} as const;

/**
 * PostgREST embed that pulls the parent scan's `workspace_id` alongside a child
 * row. `!inner` makes the join mandatory, so filtering on
 * `scans.workspace_id` excludes any child whose scan is in another workspace.
 */
const SCAN_SCOPE_EMBED = "*, scans!inner(workspace_id)";

/* -------------------------------------------------------------------------- */
/* Result helpers                                                             */
/* -------------------------------------------------------------------------- */

async function rowsOf(operation: string, builder: QueryBuilder): Promise<DbRow[]> {
  const { data, error } = await builder;
  if (error) {
    throw new InsForgeRepositoryError(operation, error);
  }
  return data ?? [];
}

async function maybeRow(
  operation: string,
  builder: PromiseLike<DbResult<DbRow>>,
): Promise<DbRow | null> {
  const { data, error } = await builder;
  if (error) {
    throw new InsForgeRepositoryError(operation, error);
  }
  return data ?? null;
}

/** Unwrap exactly one row from a write that returns its affected rows. */
function firstOrThrow(operation: string, rows: DbRow[]): DbRow {
  const [row] = rows;
  if (!row) {
    throw new InsForgeRepositoryError(operation, {
      message: "expected a row but none was returned (out of scope or blocked)",
    });
  }
  return row;
}

/* -------------------------------------------------------------------------- */
/* Workspace-scoped repository                                                */
/* -------------------------------------------------------------------------- */

/**
 * A {@link WorkspaceRepository} bound to a single `workspaceId`. Constructed by
 * {@link LiveInsForgeClient.scoped}; never accepts a cross-workspace id.
 */
export class LiveWorkspaceRepository implements WorkspaceRepository {
  readonly companies: CompanyRepo;
  readonly scans: ScanRepo;
  readonly snapshots: SnapshotRepo;
  readonly diffs: DiffRepo;
  readonly claims: ClaimRepo;
  readonly verdicts: VerdictRepo;
  readonly integrations: IntegrationRepo;

  constructor(
    private readonly db: InsforgeDatabaseLike,
    private readonly workspaceId: string,
  ) {
    this.companies = this.buildCompanyRepo();
    this.scans = this.buildScanRepo();
    this.snapshots = this.buildSnapshotRepo();
    this.diffs = this.buildDiffRepo();
    this.claims = this.buildClaimRepo();
    this.verdicts = this.buildVerdictRepo();
    this.integrations = this.buildIntegrationRepo();
  }

  /* ----- parent-chain scope guards (defense in depth) -------------------- */

  /** Confirm a company belongs to the bound workspace, or throw. */
  private async assertCompanyInWorkspace(companyId: string): Promise<void> {
    const row = await maybeRow(
      "company scope check",
      this.db
        .from(TABLES.companies)
        .select("id")
        .eq("id", companyId)
        .eq("workspace_id", this.workspaceId)
        .maybeSingle(),
    );
    if (!row) {
      throw new WorkspaceScopeError(
        `company ${companyId} is not in workspace ${this.workspaceId}`,
      );
    }
  }

  /** Confirm a scan belongs to the bound workspace, or throw. */
  private async assertScanInWorkspace(scanId: string): Promise<void> {
    const row = await maybeRow(
      "scan scope check",
      this.db
        .from(TABLES.scans)
        .select("id")
        .eq("id", scanId)
        .eq("workspace_id", this.workspaceId)
        .maybeSingle(),
    );
    if (!row) {
      throw new WorkspaceScopeError(
        `scan ${scanId} is not in workspace ${this.workspaceId}`,
      );
    }
  }

  private async assertScansInWorkspace(scanIds: Iterable<string>): Promise<void> {
    const unique = [...new Set(scanIds)];
    await Promise.all(unique.map((id) => this.assertScanInWorkspace(id)));
  }

  /* ----- companies ------------------------------------------------------- */

  private buildCompanyRepo(): CompanyRepo {
    const { db, workspaceId } = this;
    return {
      create: async (rows: NewCompany[]): Promise<Company[]> => {
        if (rows.length === 0) {
          return [];
        }
        const inserted = await rowsOf(
          "companies.create",
          db
            .from(TABLES.companies)
            .insert(rows.map((row) => toCompanyInsert(workspaceId, row)))
            .select(),
        );
        return inserted.map(fromCompanyRow);
      },

      list: async (): Promise<Company[]> => {
        const found = await rowsOf(
          "companies.list",
          db
            .from(TABLES.companies)
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("name", { ascending: true }),
        );
        return found.map(fromCompanyRow);
      },

      get: async (id: string): Promise<Company | null> => {
        const row = await maybeRow(
          "companies.get",
          db
            .from(TABLES.companies)
            .select("*")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle(),
        );
        return row ? fromCompanyRow(row) : null;
      },

      update: async (id: string, patch: Partial<NewCompany>): Promise<Company> => {
        const updated = await rowsOf(
          "companies.update",
          db
            .from(TABLES.companies)
            .update(toCompanyUpdate(patch))
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .select(),
        );
        return fromCompanyRow(firstOrThrow("companies.update", updated));
      },

      delete: async (id: string): Promise<void> => {
        // Workspace-filtered delete: the `.eq('workspace_id', …)` predicate
        // means a cross-tenant id matches no row, so another tenant's data is
        // never removed (Requirements 1.4, 21.7). The `watched_sources` FK is
        // `ON DELETE CASCADE`, so the company's sources are removed with it —
        // giving best-effort atomic rollback when source creation fails after
        // the company row was inserted (Requirement 4.8).
        await rowsOf(
          "companies.delete",
          db
            .from(TABLES.companies)
            .delete()
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .select(),
        );
      },

      addSources: async (rows: NewWatchedSource[]): Promise<WatchedSource[]> => {
        if (rows.length === 0) {
          return [];
        }
        // Scope via parent: every target company must be in the workspace.
        await Promise.all(
          [...new Set(rows.map((row) => row.companyId))].map((companyId) =>
            this.assertCompanyInWorkspace(companyId),
          ),
        );
        const inserted = await rowsOf(
          "companies.addSources",
          db
            .from(TABLES.watchedSources)
            .insert(rows.map(toWatchedSourceInsert))
            .select(),
        );
        return inserted.map(fromWatchedSourceRow);
      },

      listSources: async (companyId: string): Promise<WatchedSource[]> => {
        await this.assertCompanyInWorkspace(companyId);
        const found = await rowsOf(
          "companies.listSources",
          db
            .from(TABLES.watchedSources)
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: true }),
        );
        return found.map(fromWatchedSourceRow);
      },
    };
  }

  /* ----- scans ----------------------------------------------------------- */

  private buildScanRepo(): ScanRepo {
    const { db, workspaceId } = this;
    return {
      create: async (rows: NewScan[]): Promise<Scan[]> => {
        if (rows.length === 0) {
          return [];
        }
        const inserted = await rowsOf(
          "scans.create",
          db
            .from(TABLES.scans)
            .insert(rows.map((row) => toScanInsert(workspaceId, row)))
            .select(),
        );
        return inserted.map(fromScanRow);
      },

      get: async (id: string): Promise<Scan | null> => {
        const row = await maybeRow(
          "scans.get",
          db
            .from(TABLES.scans)
            .select("*")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle(),
        );
        return row ? fromScanRow(row) : null;
      },

      listForCompany: async (companyId: string): Promise<Scan[]> => {
        const found = await rowsOf(
          "scans.listForCompany",
          db
            .from(TABLES.scans)
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("company_id", companyId)
            .order("created_at", { ascending: false }),
        );
        return found.map(fromScanRow);
      },

      updateStatus: async (
        id: string,
        status: ScanStatus,
        patch?: Partial<Pick<Scan, "failureReason" | "boxScanFolderId">>,
      ): Promise<Scan> => {
        const values: DbRow = {
          status,
          updated_at: new Date().toISOString(),
        };
        if (patch && "failureReason" in patch) {
          values.failure_reason = patch.failureReason ?? null;
        }
        if (patch && "boxScanFolderId" in patch) {
          values.box_scan_folder_id = patch.boxScanFolderId ?? null;
        }
        const updated = await rowsOf(
          "scans.updateStatus",
          db
            .from(TABLES.scans)
            .update(values)
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .select(),
        );
        return fromScanRow(firstOrThrow("scans.updateStatus", updated));
      },

      mostRecentCompleted: async (
        companyId: string,
        before?: string,
      ): Promise<Scan | null> => {
        let builder = db
          .from(TABLES.scans)
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("company_id", companyId)
          .eq("status", "completed");
        if (before !== undefined) {
          builder = builder.lt("created_at", before);
        }
        const found = await rowsOf(
          "scans.mostRecentCompleted",
          builder.order("created_at", { ascending: false }).limit(1),
        );
        const [row] = found;
        return row ? fromScanRow(row) : null;
      },
    };
  }

  /* ----- snapshots (parent: scan) ---------------------------------------- */

  private buildSnapshotRepo(): SnapshotRepo {
    const { db } = this;
    return {
      create: async (rows: NewSnapshot[]): Promise<Snapshot[]> => {
        if (rows.length === 0) {
          return [];
        }
        await this.assertScansInWorkspace(rows.map((row) => row.scanId));
        const inserted = await rowsOf(
          "snapshots.create",
          db
            .from(TABLES.snapshots)
            .insert(rows.map(toSnapshotInsert))
            .select(),
        );
        return inserted.map(fromSnapshotRow);
      },

      get: async (id: string): Promise<Snapshot | null> => {
        const row = await maybeRow(
          "snapshots.get",
          db
            .from(TABLES.snapshots)
            .select(SCAN_SCOPE_EMBED)
            .eq("id", id)
            .eq("scans.workspace_id", this.workspaceId)
            .maybeSingle(),
        );
        return row ? fromSnapshotRow(row) : null;
      },

      listForScan: async (scanId: string): Promise<Snapshot[]> => {
        const found = await rowsOf(
          "snapshots.listForScan",
          db
            .from(TABLES.snapshots)
            .select(SCAN_SCOPE_EMBED)
            .eq("scan_id", scanId)
            .eq("scans.workspace_id", this.workspaceId)
            .order("created_at", { ascending: true }),
        );
        return found.map(fromSnapshotRow);
      },

      update: async (id: string, patch: Partial<NewSnapshot>): Promise<Snapshot> => {
        // Confirm the snapshot's parent scan is in the workspace before writing.
        const existing = await maybeRow(
          "snapshots.update scope check",
          db
            .from(TABLES.snapshots)
            .select(SCAN_SCOPE_EMBED)
            .eq("id", id)
            .eq("scans.workspace_id", this.workspaceId)
            .maybeSingle(),
        );
        if (!existing) {
          throw new WorkspaceScopeError(
            `snapshot ${id} is not in workspace ${this.workspaceId}`,
          );
        }
        const updated = await rowsOf(
          "snapshots.update",
          db
            .from(TABLES.snapshots)
            .update(toSnapshotUpdate(patch))
            .eq("id", id)
            .select(),
        );
        return fromSnapshotRow(firstOrThrow("snapshots.update", updated));
      },
    };
  }

  /* ----- diffs (parent: scan) -------------------------------------------- */

  private buildDiffRepo(): DiffRepo {
    const { db } = this;
    return {
      create: async (rows: NewDiff[]): Promise<DiffRow[]> => {
        if (rows.length === 0) {
          return [];
        }
        await this.assertScansInWorkspace(rows.map((row) => row.scanId));
        const inserted = await rowsOf(
          "diffs.create",
          db.from(TABLES.diffs).insert(rows.map(toDiffInsert)).select(),
        );
        return inserted.map(fromDiffRow);
      },

      listForScan: async (scanId: string): Promise<DiffRow[]> => {
        const found = await rowsOf(
          "diffs.listForScan",
          db
            .from(TABLES.diffs)
            .select(SCAN_SCOPE_EMBED)
            .eq("scan_id", scanId)
            .eq("scans.workspace_id", this.workspaceId)
            .order("created_at", { ascending: true }),
        );
        return found.map(fromDiffRow);
      },
    };
  }

  /* ----- claims (parent: scan) ------------------------------------------- */

  private buildClaimRepo(): ClaimRepo {
    const { db } = this;
    return {
      create: async (rows: NewClaim[]): Promise<ClaimRow[]> => {
        if (rows.length === 0) {
          return [];
        }
        await this.assertScansInWorkspace(rows.map((row) => row.scanId));
        const inserted = await rowsOf(
          "claims.create",
          db.from(TABLES.claims).insert(rows.map(toClaimInsert)).select(),
        );
        return inserted.map(fromClaimRow);
      },

      listForScan: async (scanId: string): Promise<ClaimRow[]> => {
        const found = await rowsOf(
          "claims.listForScan",
          db
            .from(TABLES.claims)
            .select(SCAN_SCOPE_EMBED)
            .eq("scan_id", scanId)
            .eq("scans.workspace_id", this.workspaceId)
            .order("created_at", { ascending: true }),
        );
        return found.map(fromClaimRow);
      },

      updateStatus: async (id: string, status: ClaimStatus): Promise<ClaimRow> => {
        const existing = await maybeRow(
          "claims.updateStatus scope check",
          db
            .from(TABLES.claims)
            .select(SCAN_SCOPE_EMBED)
            .eq("id", id)
            .eq("scans.workspace_id", this.workspaceId)
            .maybeSingle(),
        );
        if (!existing) {
          throw new WorkspaceScopeError(
            `claim ${id} is not in workspace ${this.workspaceId}`,
          );
        }
        const updated = await rowsOf(
          "claims.updateStatus",
          db
            .from(TABLES.claims)
            .update({ claim_status: status })
            .eq("id", id)
            .select(),
        );
        return fromClaimRow(firstOrThrow("claims.updateStatus", updated));
      },
    };
  }

  /* ----- verdicts (workspace_id directly) -------------------------------- */

  private buildVerdictRepo(): VerdictRepo {
    const { db, workspaceId } = this;
    return {
      create: async (rows: NewVerdict[]): Promise<VerdictRow[]> => {
        if (rows.length === 0) {
          return [];
        }
        // Defense in depth: the verdict's scan must be in this workspace too.
        await this.assertScansInWorkspace(rows.map((row) => row.scanId));
        const inserted = await rowsOf(
          "verdicts.create",
          db
            .from(TABLES.verdicts)
            .insert(rows.map((row) => toVerdictInsert(workspaceId, row)))
            .select(),
        );
        return inserted.map(fromVerdictRow);
      },

      getForScan: async (scanId: string): Promise<VerdictRow | null> => {
        const found = await rowsOf(
          "verdicts.getForScan",
          db
            .from(TABLES.verdicts)
            .select("*")
            .eq("scan_id", scanId)
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false })
            .limit(1),
        );
        const [row] = found;
        return row ? fromVerdictRow(row) : null;
      },
    };
  }

  /* ----- integrations (workspace_id directly) ---------------------------- */

  private buildIntegrationRepo(): IntegrationRepo {
    const { db, workspaceId } = this;
    return {
      upsert: async (rows: NewIntegration[]): Promise<Integration[]> => {
        if (rows.length === 0) {
          return [];
        }
        // UNIQUE(workspace_id, provider): conflicts replace the prior row.
        const upserted = await rowsOf(
          "integrations.upsert",
          db
            .from(TABLES.integrations)
            .upsert(
              rows.map((row) => toIntegrationInsert(workspaceId, row)),
              { onConflict: "workspace_id,provider" },
            )
            .select(),
        );
        return upserted.map(fromIntegrationRow);
      },

      get: async (provider: IntegrationProvider): Promise<Integration | null> => {
        const row = await maybeRow(
          "integrations.get",
          db
            .from(TABLES.integrations)
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("provider", provider)
            .maybeSingle(),
        );
        return row ? fromIntegrationRow(row) : null;
      },

      list: async (): Promise<Integration[]> => {
        const found = await rowsOf(
          "integrations.list",
          db
            .from(TABLES.integrations)
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("provider", { ascending: true }),
        );
        return found.map(fromIntegrationRow);
      },
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Live InsForge client                                                       */
/* -------------------------------------------------------------------------- */

/** Construction options for the testable {@link LiveInsForgeClient} core. */
export interface LiveInsForgeClientOptions {
  /** The narrow database surface (the server-only entry adapts the SDK). */
  database: InsforgeDatabaseLike;
  /**
   * Whether live InsForge credentials are present. Supplied by the server-only
   * `./live` entry from `isInsforgeConfigured()` so this core never imports the
   * server-only env module directly.
   */
  configured: boolean;
  /** Name applied to a workspace created during first-login bootstrap. */
  defaultWorkspaceName?: string;
}

const DEFAULT_WORKSPACE_NAME = "My Workspace";

/**
 * Live {@link InsForgeClient}. Hands out workspace-scoped repositories and
 * resolves the active workspace for a session. The database it talks to is
 * already authenticated as the calling user (the server-only entry attaches the
 * user's access token), so Postgres RLS sees `auth.uid()` and scopes rows to
 * the user's member workspaces — the application-code scoping in
 * {@link LiveWorkspaceRepository} layers on top of that.
 */
export class LiveInsForgeClient implements InsForgeClient {
  readonly mode: RunMode = "live";

  private readonly db: InsforgeDatabaseLike;
  private readonly configured: boolean;
  private readonly defaultWorkspaceName: string;

  constructor(options: LiveInsForgeClientOptions) {
    this.db = options.database;
    this.configured = options.configured;
    this.defaultWorkspaceName = options.defaultWorkspaceName ?? DEFAULT_WORKSPACE_NAME;
  }

  /** Reflects InsForge credential presence (Requirement 22.1 / 18.2). */
  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Return a repository whose every query is constrained to `workspaceId`
   * (Requirements 1.4, 21.7).
   */
  scoped(workspaceId: string): WorkspaceRepository {
    return new LiveWorkspaceRepository(this.db, workspaceId);
  }

  /**
   * Resolve the active workspace for an authenticated session:
   *  1. honor an explicit `activeWorkspaceId` when the user is a member of it,
   *  2. otherwise fall back to the user's earliest membership,
   *  3. otherwise bootstrap a new workspace + owner membership (Requirement 1.3)
   *     so the session always has exactly one active workspace (Requirement 1.2).
   *
   * Membership reads/writes pass through RLS using the caller's token.
   */
  async getActiveWorkspace(session: Session): Promise<Workspace> {
    if (session.activeWorkspaceId) {
      const explicit = await this.loadWorkspace(session.activeWorkspaceId);
      if (explicit) {
        return explicit;
      }
      // Member-but-not-active or non-member: do not silently fall through to a
      // different workspace — surface a scope error (Requirements 21.7, 1.5).
      throw new WorkspaceScopeError(
        `active workspace ${session.activeWorkspaceId} is not accessible to user ${session.userId}`,
      );
    }

    const membershipWorkspaceId = await this.firstMembershipWorkspaceId(session.userId);
    if (membershipWorkspaceId) {
      const existing = await this.loadWorkspace(membershipWorkspaceId);
      if (existing) {
        return existing;
      }
    }

    return this.bootstrapWorkspace(session.userId);
  }

  private async loadWorkspace(workspaceId: string): Promise<Workspace | null> {
    const row = await maybeRow(
      "workspaces.get",
      this.db
        .from(TABLES.workspaces)
        .select("*")
        .eq("id", workspaceId)
        .maybeSingle(),
    );
    return row ? fromWorkspaceRow(row) : null;
  }

  private async firstMembershipWorkspaceId(userId: string): Promise<string | null> {
    const found = await rowsOf(
      "workspace_members.firstForUser",
      this.db
        .from(TABLES.workspaceMembers)
        .select("workspace_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1),
    );
    const [row] = found;
    return row ? String(row.workspace_id) : null;
  }

  private async bootstrapWorkspace(userId: string): Promise<Workspace> {
    const created = await rowsOf(
      "workspaces.bootstrap",
      this.db
        .from(TABLES.workspaces)
        .insert([{ name: this.defaultWorkspaceName }])
        .select(),
    );
    const workspace = fromWorkspaceRow(firstOrThrow("workspaces.bootstrap", created));

    // Claim the freshly created (empty) workspace with an owner membership.
    await rowsOf(
      "workspace_members.bootstrap",
      this.db
        .from(TABLES.workspaceMembers)
        .insert([{ workspace_id: workspace.id, user_id: userId, role: "owner" }])
        .select(),
    );

    return workspace;
  }
}

/** Construct the testable live InsForge client core from explicit options. */
export function createLiveInsForgeClientCore(
  options: LiveInsForgeClientOptions,
): LiveInsForgeClient {
  return new LiveInsForgeClient(options);
}
