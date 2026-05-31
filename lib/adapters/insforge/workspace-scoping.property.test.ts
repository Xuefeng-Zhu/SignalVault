// Feature: signalvault, Property 1: Workspace scoping excludes other tenants
//
// Property 1 (design.md "Correctness Properties"):
//   For any collection of workspaces each owning companies, scans, snapshots,
//   diffs, claims, and verdicts, and for any chosen active workspace, every
//   record returned by the workspace-scoped repository has a `workspace_id`
//   (directly or via its parent) equal to the active workspace, and no record
//   belonging to any other workspace is ever returned.
//
// Validates: Requirements 1.4
//
// Strategy: generate >= 2 workspaces, each owning a generated number of
// companies, each company owning a generated number of completed scans (each
// scan owning a snapshot), with generated names/domains/slugs. Seed the rows
// directly into a shared in-memory `FakeDatabase` (so the seeding is
// independent of the code under test), then read THROUGH the LIVE repository
// core (`LiveInsForgeClient.scoped(active)`) — the real application-code
// scoping logic (`.eq('workspace_id', ...)` and the `scans!inner(workspace_id)`
// parent-chain embed). We assert that, for an arbitrary chosen active
// workspace, the scoped repo returns exactly the active workspace's rows and
// excludes every other workspace's rows across a direct-`workspace_id` table
// (companies, scans) and a parent-chain-scoped table (snapshots).
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { pbtParams } from "../../../tests/fast-check.config";

import { FakeDatabase } from "./fake-database";
import { LiveInsForgeClient } from "./live-repository";
import type { DbRow } from "./mappers";

/* -------------------------------------------------------------------------- */
/* Generated model                                                            */
/* -------------------------------------------------------------------------- */

interface CompanyModel {
  name: string;
  domain: string;
  slug: string;
  /** Number of completed scans this company owns (each gets one snapshot). */
  scanCount: number;
}

interface WorkspaceModel {
  name: string;
  companies: CompanyModel[];
}

interface Scenario {
  workspaces: WorkspaceModel[];
  /** Index (into `workspaces`) of the workspace to bind the repo to. */
  activeIndex: number;
}

const companyModel: fc.Arbitrary<CompanyModel> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  domain: fc.domain(),
  slug: fc.string({ minLength: 1, maxLength: 24 }),
  scanCount: fc.nat({ max: 3 }),
});

const workspaceModel: fc.Arbitrary<WorkspaceModel> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 24 }),
  companies: fc.array(companyModel, { maxLength: 4 }),
});

/**
 * At least two workspaces (so cross-tenant exclusion is always exercised) plus
 * a valid active-workspace index drawn from the generated workspace count.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .array(workspaceModel, { minLength: 2, maxLength: 4 })
  .chain((workspaces) =>
    fc.record({
      workspaces: fc.constant(workspaces),
      activeIndex: fc.nat({ max: workspaces.length - 1 }),
    }),
  );

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

interface CompanyIds {
  id: string;
  workspaceId: string;
  scanIds: string[];
}

interface SeededWorld {
  /** Per workspace index: the workspace id. */
  workspaceIds: string[];
  /** Per workspace index: the companies (with their scan ids) it owns. */
  companiesByWorkspace: CompanyIds[][];
  /** Per workspace index: the snapshot ids it owns (via its scans). */
  snapshotIdsByWorkspace: string[][];
}

/**
 * Seed the generated model into `db` with deterministic, collision-free ids
 * derived from indices. Returns the id bookkeeping the assertions compare
 * against. Rows are written as raw snake_case columns (what the DB stores), so
 * the seeding does not depend on the repository under test.
 */
function seed(db: FakeDatabase, workspaces: WorkspaceModel[]): SeededWorld {
  const workspaceIds: string[] = [];
  const companiesByWorkspace: CompanyIds[][] = [];
  const snapshotIdsByWorkspace: string[][] = [];

  const workspaceRows: DbRow[] = [];
  const companyRows: DbRow[] = [];
  const scanRows: DbRow[] = [];
  const snapshotRows: DbRow[] = [];

  let clock = 0;
  const ts = (): string => {
    clock += 1;
    return new Date(Date.UTC(2024, 0, 1, 0, 0, clock)).toISOString();
  };

  workspaces.forEach((workspace, wi) => {
    const workspaceId = `ws-${wi}`;
    workspaceIds.push(workspaceId);
    workspaceRows.push({
      id: workspaceId,
      name: workspace.name,
      created_at: ts(),
    });

    const companies: CompanyIds[] = [];
    const snapshotIds: string[] = [];

    workspace.companies.forEach((company, ci) => {
      const companyId = `co-${wi}-${ci}`;
      companyRows.push({
        id: companyId,
        workspace_id: workspaceId,
        name: company.name,
        domain: company.domain,
        slug: company.slug,
        created_at: ts(),
      });

      const scanIds: string[] = [];
      for (let si = 0; si < company.scanCount; si += 1) {
        const scanId = `scan-${wi}-${ci}-${si}`;
        scanIds.push(scanId);
        const created = ts();
        scanRows.push({
          id: scanId,
          workspace_id: workspaceId,
          company_id: companyId,
          status: "completed",
          trigger_type: "manual",
          created_at: created,
          updated_at: created,
        });

        const snapshotId = `snap-${wi}-${ci}-${si}`;
        snapshotIds.push(snapshotId);
        snapshotRows.push({
          id: snapshotId,
          scan_id: scanId,
          watched_source_id: `src-${wi}-${ci}-${si}`,
          simulated: false,
          created_at: ts(),
        });
      }

      companies.push({ id: companyId, workspaceId, scanIds });
    });

    companiesByWorkspace.push(companies);
    snapshotIdsByWorkspace.push(snapshotIds);
  });

  db.tables.workspaces = workspaceRows;
  db.tables.companies = companyRows;
  db.tables.scans = scanRows;
  db.tables.snapshots = snapshotRows;

  return { workspaceIds, companiesByWorkspace, snapshotIdsByWorkspace };
}

function repoFor(db: FakeDatabase, workspaceId: string) {
  return new LiveInsForgeClient({ database: db, configured: true }).scoped(workspaceId);
}

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe("Property 1: workspace scoping excludes other tenants (Requirement 1.4)", () => {
  it("scoped repo returns only the active workspace's rows and excludes every other tenant", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ workspaces, activeIndex }) => {
        const db = new FakeDatabase();
        const world = seed(db, workspaces);
        const active = world.workspaceIds[activeIndex]!;
        const repo = repoFor(db, active);

        const activeCompanies = world.companiesByWorkspace[activeIndex]!;
        const activeCompanyIds = new Set(activeCompanies.map((c) => c.id));

        // Everything that belongs to some OTHER workspace.
        const otherCompanyIds = world.companiesByWorkspace
          .filter((_, wi) => wi !== activeIndex)
          .flatMap((companies) => companies.map((c) => c.id));
        const otherScanIds = world.companiesByWorkspace
          .filter((_, wi) => wi !== activeIndex)
          .flatMap((companies) => companies.flatMap((c) => c.scanIds));
        const otherSnapshotIds = world.snapshotIdsByWorkspace
          .filter((_, wi) => wi !== activeIndex)
          .flat();

        /* ---- companies (direct workspace_id) ---------------------------- */

        // list() returns exactly the active workspace's companies, nothing else.
        const listed = await repo.companies.list();
        expect(new Set(listed.map((c) => c.id))).toEqual(activeCompanyIds);
        for (const company of listed) {
          expect(company.workspaceId).toBe(active);
        }

        // get() resolves the active workspace's companies...
        for (const company of activeCompanies) {
          const got = await repo.companies.get(company.id);
          expect(got).not.toBeNull();
          expect(got!.workspaceId).toBe(active);
        }
        // ...and never a company owned by another workspace.
        for (const id of otherCompanyIds) {
          expect(await repo.companies.get(id)).toBeNull();
        }

        /* ---- scans (direct workspace_id) -------------------------------- */

        for (const company of activeCompanies) {
          const scans = await repo.scans.listForCompany(company.id);
          expect(new Set(scans.map((s) => s.id))).toEqual(new Set(company.scanIds));
          for (const scan of scans) {
            expect(scan.workspaceId).toBe(active);
            expect(scan.companyId).toBe(company.id);
          }
        }
        // A company owned by another workspace yields no scans, even by id.
        for (const id of otherCompanyIds) {
          expect(await repo.scans.listForCompany(id)).toEqual([]);
        }
        // get() never returns a scan from another workspace.
        for (const id of otherScanIds) {
          expect(await repo.scans.get(id)).toBeNull();
        }

        /* ---- snapshots (parent-chain via scans!inner(workspace_id)) ----- */

        for (const company of activeCompanies) {
          for (const scanId of company.scanIds) {
            const snapshots = await repo.snapshots.listForScan(scanId);
            // Each active scan owns exactly one seeded snapshot.
            expect(snapshots).toHaveLength(1);
          }
        }
        // Snapshots whose parent scan is in another workspace are excluded,
        // and fetching one by its (known) id returns null.
        for (const scanId of otherScanIds) {
          expect(await repo.snapshots.listForScan(scanId)).toEqual([]);
        }
        for (const id of otherSnapshotIds) {
          expect(await repo.snapshots.get(id)).toBeNull();
        }
      }),
      pbtParams(),
    );
  });
});
