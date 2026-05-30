import { beforeEach, describe, expect, it } from "vitest";

import type { Session } from "@/lib/adapters/types";

import {
  InsForgeRepositoryError,
  LiveInsForgeClient,
  WorkspaceScopeError,
  type DbError,
  type DbResult,
  type InsforgeDatabaseLike,
  type QueryBuilder,
  type TableHandle,
} from "./live-repository";
import { FakeDatabase } from "./fake-database";
import type { DbRow } from "./mappers";

/* -------------------------------------------------------------------------- */
/* In-memory fake of the narrow InsForge database surface                     */
/*                                                                            */
/* The deterministic in-memory `FakeDatabase` is shared with the Property 1   */
/* test (`workspace-scoping.property.test.ts`) and lives in `./fake-database` */
/* so there is a single source of truth for the fake DB surface.              */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const WS_A = "ws-a";
const WS_B = "ws-b";

/** Seed two workspaces, each with one company and one scan. */
function seedTwoTenants(db: FakeDatabase): {
  companyA: string;
  companyB: string;
  scanA: string;
  scanB: string;
} {
  db.tables.workspaces = [
    { id: WS_A, name: "A", is_demo: false, created_at: "2024-01-01T00:00:00Z" },
    { id: WS_B, name: "B", is_demo: false, created_at: "2024-01-01T00:00:00Z" },
  ];
  db.tables.companies = [
    {
      id: "co-a",
      workspace_id: WS_A,
      name: "Acme",
      domain: "acme.test",
      slug: "acme",
      created_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "co-b",
      workspace_id: WS_B,
      name: "Beta",
      domain: "beta.test",
      slug: "beta",
      created_at: "2024-01-01T00:00:00Z",
    },
  ];
  db.tables.scans = [
    {
      id: "scan-a",
      workspace_id: WS_A,
      company_id: "co-a",
      status: "completed",
      trigger_type: "manual",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "scan-b",
      workspace_id: WS_B,
      company_id: "co-b",
      status: "completed",
      trigger_type: "manual",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ];
  return { companyA: "co-a", companyB: "co-b", scanA: "scan-a", scanB: "scan-b" };
}

function clientFor(db: FakeDatabase): LiveInsForgeClient {
  return new LiveInsForgeClient({ database: db, configured: true });
}

/* -------------------------------------------------------------------------- */
/* Adapter contract                                                           */
/* -------------------------------------------------------------------------- */

describe("LiveInsForgeClient — adapter contract", () => {
  it("reports live mode and reflects credential presence", () => {
    expect(clientFor(new FakeDatabase()).mode).toBe("live");
    expect(
      new LiveInsForgeClient({ database: new FakeDatabase(), configured: true }).isConfigured(),
    ).toBe(true);
    expect(
      new LiveInsForgeClient({ database: new FakeDatabase(), configured: false }).isConfigured(),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Workspace scoping                                                          */
/* -------------------------------------------------------------------------- */

describe("workspace scoping (Requirements 1.4, 21.7)", () => {
  let db: FakeDatabase;

  beforeEach(() => {
    db = new FakeDatabase();
    seedTwoTenants(db);
  });

  it("companies.list returns only the bound workspace's companies", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    const companies = await repoA.companies.list();
    expect(companies.map((c) => c.id)).toEqual(["co-a"]);
  });

  it("companies.get returns null for a company in another workspace", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    expect(await repoA.companies.get("co-b")).toBeNull();
    expect((await repoA.companies.get("co-a"))?.id).toBe("co-a");
  });

  it("scans.listForCompany excludes other tenants", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    const scans = await repoA.scans.listForCompany("co-b");
    expect(scans).toEqual([]);
  });

  it("snapshots.create rejects a scan outside the workspace", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    await expect(
      repoA.snapshots.create([
        { scanId: "scan-b", watchedSourceId: "src-1", simulated: false },
      ]),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
    // Nothing was persisted.
    expect(db.tables.snapshots ?? []).toHaveLength(0);
  });

  it("snapshots.listForScan only returns rows whose parent scan is in the workspace", async () => {
    db.tables.snapshots = [
      { id: "snap-a", scan_id: "scan-a", watched_source_id: "s1", simulated: false, created_at: "2024-01-01T00:00:00Z" },
      { id: "snap-b", scan_id: "scan-b", watched_source_id: "s2", simulated: false, created_at: "2024-01-01T00:00:00Z" },
    ];
    const repoA = clientFor(db).scoped(WS_A);
    expect((await repoA.snapshots.listForScan("scan-a")).map((s) => s.id)).toEqual([
      "snap-a",
    ]);
    // A scan in another workspace yields nothing even if the id is known.
    expect(await repoA.snapshots.listForScan("scan-b")).toEqual([]);
  });

  it("addSources rejects a company outside the workspace", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    await expect(
      repoA.companies.addSources([
        { companyId: "co-b", url: "https://x.test", sourceType: "homepage" },
      ]),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
    expect(db.tables.watched_sources ?? []).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Array-form inserts + mapping                                               */
/* -------------------------------------------------------------------------- */

describe("inserts use array form and map camelCase<->snake_case (Requirement 20.1)", () => {
  let db: FakeDatabase;

  beforeEach(() => {
    db = new FakeDatabase();
    seedTwoTenants(db);
  });

  it("companies.create issues an array insert with workspace_id and returns mapped rows", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    const created = await repoA.companies.create([
      { name: "Gamma", domain: "gamma.test", slug: "gamma" },
    ]);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      workspaceId: WS_A,
      name: "Gamma",
      domain: "gamma.test",
      slug: "gamma",
    });
    expect(typeof created[0]!.id).toBe("string");

    const call = db.insertCalls.find((c) => c.table === "companies");
    expect(Array.isArray(call?.rows)).toBe(true);
    expect(call?.rows[0]).toMatchObject({ workspace_id: WS_A, name: "Gamma" });
  });

  it("verdicts.create maps array/columns and getForScan round-trips them", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    const [verdict] = await repoA.verdicts.create([
      {
        scanId: "scan-a",
        strategyPrediction: "moving_upmarket",
        confidence: 82,
        riskScore: 40,
        recommendedActions: ["watch pricing", "alert sales"],
        keyEvidence: ["enterprise tier added"],
        counterEvidence: [],
        isFallback: false,
      },
    ]);

    expect(verdict).toMatchObject({
      workspaceId: WS_A,
      strategyPrediction: "moving_upmarket",
      confidence: 82,
      riskScore: 40,
      recommendedActions: ["watch pricing", "alert sales"],
    });

    // Persisted row uses snake_case columns.
    const stored = db.tables.verdicts?.[0];
    expect(stored).toMatchObject({
      strategy_prediction: "moving_upmarket",
      risk_score: 40,
      is_fallback: false,
    });

    const fetched = await repoA.verdicts.getForScan("scan-a");
    expect(fetched?.recommendedActions).toEqual(["watch pricing", "alert sales"]);
  });

  it("integrations.upsert replaces on (workspace_id, provider) conflict", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    await repoA.integrations.upsert([
      { provider: "Box", credentialCiphertext: "enc-1", isMock: false },
    ]);
    await repoA.integrations.upsert([
      { provider: "Box", credentialCiphertext: "enc-2", isMock: false },
    ]);

    const all = await repoA.integrations.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ provider: "Box", credentialCiphertext: "enc-2" });
  });

  it("scans.updateStatus persists status + failure reason within the workspace", async () => {
    const repoA = clientFor(db).scoped(WS_A);
    const updated = await repoA.scans.updateStatus("scan-a", "failed", {
      failureReason: "boom",
    });
    expect(updated).toMatchObject({ status: "failed", failureReason: "boom" });
  });
});

/* -------------------------------------------------------------------------- */
/* getActiveWorkspace                                                         */
/* -------------------------------------------------------------------------- */

describe("getActiveWorkspace", () => {
  it("honors an explicit active workspace the user can access", async () => {
    const db = new FakeDatabase();
    seedTwoTenants(db);
    const session: Session = { userId: "user-1", activeWorkspaceId: WS_A };
    const ws = await clientFor(db).getActiveWorkspace(session);
    expect(ws.id).toBe(WS_A);
  });

  it("throws a scope error when the explicit active workspace is inaccessible", async () => {
    const db = new FakeDatabase();
    // No workspaces seeded => loadWorkspace returns null (RLS would hide it).
    const session: Session = { userId: "user-1", activeWorkspaceId: "ws-missing" };
    await expect(clientFor(db).getActiveWorkspace(session)).rejects.toBeInstanceOf(
      WorkspaceScopeError,
    );
  });

  it("bootstraps a workspace + owner membership when the user has none", async () => {
    const db = new FakeDatabase();
    const session: Session = { userId: "user-1" };

    const ws = await clientFor(db).getActiveWorkspace(session);

    expect(ws.name).toBe("My Workspace");
    expect(db.tables.workspaces).toHaveLength(1);
    const membership = db.tables.workspace_members?.[0];
    expect(membership).toMatchObject({
      workspace_id: ws.id,
      user_id: "user-1",
      role: "owner",
    });
  });

  it("resolves the user's existing membership workspace when no active id is set", async () => {
    const db = new FakeDatabase();
    seedTwoTenants(db);
    db.tables.workspace_members = [
      {
        id: "m1",
        workspace_id: WS_B,
        user_id: "user-1",
        role: "member",
        created_at: "2024-01-02T00:00:00Z",
      },
    ];
    const ws = await clientFor(db).getActiveWorkspace({ userId: "user-1" });
    expect(ws.id).toBe(WS_B);
  });
});

/* -------------------------------------------------------------------------- */
/* Error propagation                                                          */
/* -------------------------------------------------------------------------- */

describe("error propagation", () => {
  it("wraps a database error in InsForgeRepositoryError", async () => {
    const error: DbError = { message: "connection reset", code: "PGRST" };
    const db: InsforgeDatabaseLike = {
      from: () =>
        ({
          select: () => failing(),
          insert: () => failing(),
          update: () => failing(),
          upsert: () => failing(),
        }) as unknown as TableHandle,
    };

    function failing(): QueryBuilder {
      const builder: Partial<QueryBuilder> = {};
      const self = (): QueryBuilder => builder as QueryBuilder;
      builder.select = self;
      builder.eq = self;
      builder.in = self;
      builder.lt = self;
      builder.order = self;
      builder.limit = self;
      builder.maybeSingle = () => Promise.resolve({ data: null, error });
      builder.then = (onfulfilled) =>
        Promise.resolve<DbResult<DbRow[]>>({ data: null, error }).then(onfulfilled);
      return builder as QueryBuilder;
    }

    const repo = new LiveInsForgeClient({ database: db, configured: true }).scoped(WS_A);
    await expect(repo.companies.list()).rejects.toBeInstanceOf(InsForgeRepositoryError);
  });
});
