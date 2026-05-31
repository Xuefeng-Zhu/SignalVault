// Feature: signalvault, Property 2: Cross-workspace access is denied without leakage or mutation
//
// Property 2 (design.md "Correctness Properties"):
//   For any resource that belongs to a workspace other than the active
//   workspace, a request for that resource returns an authorization error,
//   returns no attribute of the requested resource, and leaves the requested
//   resource and all workspace data unchanged.
//
// Validates: Requirements 1.5, 21.7
//   - 1.5: a request for a resource in a workspace the user is not (actively) in
//     is denied, returns no attributes of the resource, and leaves the resource
//     and all workspace data unchanged.
//   - 21.7: a request targeting a resource outside the active workspace returns
//     an authorization error (even for a workspace the user is a member of but
//     which is not the active one).
//
// Strategy (drive the LIVE core via the shared `FakeDatabase`, like Property 1):
//   Generate >= 2 workspaces, each owning companies/scans/snapshots plus the
//   child rows (watched_sources / diffs / claims / verdicts), seeded as raw
//   snake_case rows directly into a shared in-memory `FakeDatabase` (so seeding
//   is independent of the code under test). Pick a distinct active workspace A
//   and a victim workspace B (A !== B), scope the LIVE repository to A
//   (`new LiveInsForgeClient({ database, configured: true }).scoped(A)`), then:
//     * READS of B's resources deny + leak nothing — `get`/`getForScan` return
//       null and `list*` return [] (so no attribute of B is ever surfaced), and
//       A's own `list()` never includes a B row.
//     * WRITES targeting B's resources are denied + mutate nothing — each
//       scoped write that targets a B resource rejects with `WorkspaceScopeError`.
//     * NO MUTATION — a deep snapshot of the entire database (`JSON.stringify`
//       of every table) taken before the denied reads/writes is byte-for-byte
//       identical afterwards.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { pbtParams } from "../../../tests/fast-check.config";

import { FakeDatabase } from "./fake-database";
import { LiveInsForgeClient, WorkspaceScopeError } from "./live-repository";
import type { DbRow } from "./mappers";

/* -------------------------------------------------------------------------- */
/* Generated model                                                            */
/* -------------------------------------------------------------------------- */

interface CompanyModel {
  name: string;
  domain: string;
  slug: string;
  /** Number of completed scans this company owns (each gets one snapshot). >= 1. */
  scanCount: number;
}

interface WorkspaceModel {
  name: string;
  /** Each workspace owns at least one company so a victim always has data. */
  companies: CompanyModel[];
}

interface Scenario {
  workspaces: WorkspaceModel[];
  /** Index (into `workspaces`) of the workspace the repo is bound to. */
  activeIndex: number;
  /** 1..n-1 offset used to derive a DISTINCT victim index from `activeIndex`. */
  victimOffset: number;
}

const companyModel: fc.Arbitrary<CompanyModel> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  domain: fc.domain(),
  slug: fc.string({ minLength: 1, maxLength: 24 }),
  // >= 1 so the company always owns a scan + snapshot (+ diff/claim/verdict).
  scanCount: fc.integer({ min: 1, max: 3 }),
});

const workspaceModel: fc.Arbitrary<WorkspaceModel> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 24 }),
  // >= 1 company so the victim workspace always has something to (fail to) touch.
  companies: fc.array(companyModel, { minLength: 1, maxLength: 3 }),
});

/**
 * At least two workspaces (so a cross-tenant victim always exists). The active
 * and victim indices are guaranteed distinct: `victim = (active + offset) % n`
 * with `offset` in `[1, n-1]`.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .array(workspaceModel, { minLength: 2, maxLength: 4 })
  .chain((workspaces) =>
    fc.record({
      workspaces: fc.constant(workspaces),
      activeIndex: fc.nat({ max: workspaces.length - 1 }),
      victimOffset: fc.integer({ min: 1, max: workspaces.length - 1 }),
    }),
  );

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

/** The full set of resource ids owned by one company (for denial assertions). */
interface CompanyIds {
  companyId: string;
  watchedSourceId: string;
  scanIds: string[];
  snapshotIds: string[];
  diffIds: string[];
  claimIds: string[];
  verdictIds: string[];
}

interface SeededWorld {
  /** Per workspace index: the workspace id. */
  workspaceIds: string[];
  /** Per workspace index: the companies (with their child resource ids) it owns. */
  companiesByWorkspace: CompanyIds[][];
}

/**
 * Seed the generated model into `db` with deterministic, collision-free ids
 * derived from indices. Rows are written as raw snake_case columns (what the DB
 * stores) so the seeding does not depend on the repository under test. Every
 * scoped table is populated: companies + watched_sources (direct/parent
 * workspace), scans (direct workspace_id), and snapshots/diffs/claims
 * (parent-chain via the scan) plus verdicts (direct workspace_id).
 */
function seed(db: FakeDatabase, workspaces: WorkspaceModel[]): SeededWorld {
  const workspaceIds: string[] = [];
  const companiesByWorkspace: CompanyIds[][] = [];

  const workspaceRows: DbRow[] = [];
  const companyRows: DbRow[] = [];
  const watchedSourceRows: DbRow[] = [];
  const scanRows: DbRow[] = [];
  const snapshotRows: DbRow[] = [];
  const diffRows: DbRow[] = [];
  const claimRows: DbRow[] = [];
  const verdictRows: DbRow[] = [];

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

      const watchedSourceId = `src-${wi}-${ci}`;
      watchedSourceRows.push({
        id: watchedSourceId,
        company_id: companyId,
        url: `https://${company.domain}/`,
        source_type: "homepage",
        created_at: ts(),
      });

      const scanIds: string[] = [];
      const snapshotIds: string[] = [];
      const diffIds: string[] = [];
      const claimIds: string[] = [];
      const verdictIds: string[] = [];

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
          watched_source_id: watchedSourceId,
          simulated: false,
          created_at: ts(),
        });

        const diffId = `diff-${wi}-${ci}-${si}`;
        diffIds.push(diffId);
        diffRows.push({
          id: diffId,
          scan_id: scanId,
          prior_snapshot_id: null,
          current_snapshot_id: snapshotId,
          change_score: 0,
          change_summary: "seeded",
          added_text: "",
          removed_text: "",
          modified_sections: [],
          diff_box_file_id: null,
          created_at: ts(),
        });

        const claimId = `claim-${wi}-${ci}-${si}`;
        claimIds.push(claimId);
        claimRows.push({
          id: claimId,
          scan_id: scanId,
          snapshot_id: snapshotId,
          claim_type: "pricing",
          statement_text: "seeded statement",
          evidence_text: "seeded evidence",
          confidence: 0.5,
          claim_status: "new",
          risk_level: null,
          created_at: ts(),
        });

        const verdictId = `verdict-${wi}-${ci}-${si}`;
        verdictIds.push(verdictId);
        verdictRows.push({
          id: verdictId,
          scan_id: scanId,
          workspace_id: workspaceId,
          strategy_prediction: "moving_upmarket",
          confidence: 50,
          risk_score: 50,
          recommended_actions: ["seeded action"],
          key_evidence: [],
          counter_evidence: [],
          is_fallback: false,
          created_at: ts(),
        });
      }

      companies.push({
        companyId,
        watchedSourceId,
        scanIds,
        snapshotIds,
        diffIds,
        claimIds,
        verdictIds,
      });
    });

    companiesByWorkspace.push(companies);
  });

  db.tables.workspaces = workspaceRows;
  db.tables.companies = companyRows;
  db.tables.watched_sources = watchedSourceRows;
  db.tables.scans = scanRows;
  db.tables.snapshots = snapshotRows;
  db.tables.diffs = diffRows;
  db.tables.claims = claimRows;
  db.tables.verdicts = verdictRows;

  return { workspaceIds, companiesByWorkspace };
}

function repoFor(db: FakeDatabase, workspaceId: string) {
  return new LiveInsForgeClient({ database: db, configured: true }).scoped(workspaceId);
}

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe("Property 2: cross-workspace access is denied without leakage or mutation (Requirements 1.5, 21.7)", () => {
  it("an A-scoped repo can never read or mutate workspace B's resources", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ workspaces, activeIndex, victimOffset }) => {
        const db = new FakeDatabase();
        const world = seed(db, workspaces);

        const n = world.workspaceIds.length;
        const victimIndex = (activeIndex + victimOffset) % n;
        // The derived victim is always a DISTINCT, real workspace.
        expect(victimIndex).not.toBe(activeIndex);

        const active = world.workspaceIds[activeIndex]!;
        const repo = repoFor(db, active);

        // Pick a concrete victim company in B (>= 1 guaranteed) and one of its
        // scans (>= 1 guaranteed), with its child resources.
        const victim = world.companiesByWorkspace[victimIndex]![0]!;
        const bCompanyId = victim.companyId;
        const bWatchedSourceId = victim.watchedSourceId;
        const bScanId = victim.scanIds[0]!;
        const bSnapshotId = victim.snapshotIds[0]!;

        // Every company id that belongs to the victim workspace B.
        const bCompanyIds = new Set(
          world.companiesByWorkspace[victimIndex]!.map((c) => c.companyId),
        );

        // Deep snapshot of ALL data BEFORE any A-scoped operation. Req 1.5: the
        // resource and all workspace data must be left unchanged.
        const before = JSON.stringify(db.tables);

        /* ---- READS deny + leak nothing -------------------------------- */

        // Direct-workspace reads of B return null / [] (no attribute leaked).
        expect(await repo.companies.get(bCompanyId)).toBeNull();
        expect(await repo.scans.get(bScanId)).toBeNull();
        expect(await repo.scans.listForCompany(bCompanyId)).toEqual([]);

        // Parent-chain reads of B return [] / null (no attribute leaked).
        expect(await repo.snapshots.get(bSnapshotId)).toBeNull();
        expect(await repo.snapshots.listForScan(bScanId)).toEqual([]);
        expect(await repo.diffs.listForScan(bScanId)).toEqual([]);
        expect(await repo.claims.listForScan(bScanId)).toEqual([]);
        expect(await repo.verdicts.getForScan(bScanId)).toBeNull();

        // A's own list() never surfaces any B company (no cross-tenant leakage).
        const listed = await repo.companies.list();
        for (const company of listed) {
          expect(company.workspaceId).toBe(active);
          expect(bCompanyIds.has(company.id)).toBe(false);
        }

        /* ---- WRITES deny (WorkspaceScopeError) + mutate nothing ------- */

        // Parent-scoped writes that target a B resource must be rejected with an
        // authorization error (Req 21.7) before persisting anything (Req 1.5).
        await expect(
          repo.companies.addSources([
            { companyId: bCompanyId, url: "https://attacker.test/x", sourceType: "pricing" },
          ]),
        ).rejects.toBeInstanceOf(WorkspaceScopeError);

        await expect(
          repo.snapshots.create([
            { scanId: bScanId, watchedSourceId: bWatchedSourceId, simulated: false },
          ]),
        ).rejects.toBeInstanceOf(WorkspaceScopeError);

        await expect(
          repo.diffs.create([
            {
              scanId: bScanId,
              priorSnapshotId: null,
              currentSnapshotId: bSnapshotId,
              changeScore: 100,
              changeSummary: "injected",
              addedText: "injected",
              removedText: "",
              modifiedSections: [],
            },
          ]),
        ).rejects.toBeInstanceOf(WorkspaceScopeError);

        await expect(
          repo.claims.create([
            {
              scanId: bScanId,
              snapshotId: bSnapshotId,
              claimType: "pricing",
              statementText: "injected",
              evidenceText: "injected",
              confidence: 0.9,
            },
          ]),
        ).rejects.toBeInstanceOf(WorkspaceScopeError);

        await expect(
          repo.verdicts.create([
            {
              scanId: bScanId,
              strategyPrediction: "moving_upmarket",
              confidence: 99,
              riskScore: 99,
              recommendedActions: ["injected"],
              keyEvidence: [],
              counterEvidence: [],
              isFallback: false,
            },
          ]),
        ).rejects.toBeInstanceOf(WorkspaceScopeError);

        /* ---- NO MUTATION ---------------------------------------------- */

        // The entire database is byte-for-byte unchanged after the denied reads
        // and writes: B's resources (and every other workspace's) are intact and
        // no attacker row was inserted anywhere.
        const after = JSON.stringify(db.tables);
        expect(after).toBe(before);
      }),
      pbtParams(),
    );
  });
});
