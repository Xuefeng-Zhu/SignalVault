// Feature: signalvault, Property 3: Authentication establishes exactly one active workspace
//
// Property 3 (design.md "Correctness Properties"):
//   For any user with N >= 0 workspace memberships, after the active-workspace
//   resolution the session has exactly one active workspace; when N = 0 a
//   workspace and a corresponding owner membership are created and selected.
//
// Validates: Requirements 1.2, 1.3
//
// Strategy: drive resolution through the LIVE InsForgeClient core backed by the
// shared in-memory `FakeDatabase`, so the REAL `getActiveWorkspace` logic is
// exercised (honor explicit activeWorkspaceId -> else first membership -> else
// bootstrap a new workspace + owner membership). We generate, for an
// AUTHENTICATED user:
//   * a user id,
//   * 0..N pre-existing workspaces the user is a member of (the N of the
//     property),
//   * some noise: other users with their own workspaces/memberships, so an
//     empty-membership user cannot trivially "find" an existing workspace, and
//   * optionally an explicit `activeWorkspaceId` set to one of the user's own
//     member workspaces (Req 1.2's "set exactly one of the User's member
//     Workspaces"), or left unset.
// We then assert the central invariant: resolution yields `status: 'resolved'`
// with EXACTLY ONE workspace, and:
//   * N >= 1  -> the resolved workspace is one the user already belongs to, and
//               no new workspace/membership was created;
//   * N === 0 -> a new workspace was created AND exactly one owner membership
//               now exists for the user, matching the resolved workspace
//               (Req 1.3).
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { pbtParams } from "../../tests/fast-check.config";
import { FakeDatabase } from "@/lib/adapters/insforge/fake-database";
import { LiveInsForgeClient } from "@/lib/adapters/insforge/live-repository";
import type { DbRow } from "@/lib/adapters/insforge/mappers";
import type { Session } from "@/lib/adapters/types";

import { resolveActiveWorkspaceCore } from "./active-workspace";

/* -------------------------------------------------------------------------- */
/* Generated model                                                            */
/* -------------------------------------------------------------------------- */

interface Scenario {
  /** The authenticated user under test (namespace "u-", never collides with noise). */
  userId: string;
  /** N: number of workspaces the user is already a member of (0..4). */
  membershipCount: number;
  /** Number of OTHER users (each with one workspace + membership) seeded as noise. */
  otherUserCount: number;
  /**
   * When non-null, the index (into the user's own memberships) of the workspace
   * to pass as an explicit `activeWorkspaceId`; null means leave it unset. Only
   * a workspace the user is a member of is ever chosen (Req 1.2).
   */
  explicitActiveIndex: number | null;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    userIdSuffix: fc.hexaString({ minLength: 1, maxLength: 8 }),
    membershipCount: fc.nat({ max: 4 }),
    otherUserCount: fc.nat({ max: 3 }),
  })
  .chain(({ userIdSuffix, membershipCount, otherUserCount }) => {
    // An explicit active id only makes sense when the user has memberships; it
    // must reference one of the user's own member workspaces (Req 1.2).
    const explicitArb: fc.Arbitrary<number | null> =
      membershipCount === 0
        ? fc.constant(null)
        : fc.option(fc.nat({ max: membershipCount - 1 }), { nil: null });
    return fc.record({
      userId: fc.constant(`u-${userIdSuffix}`),
      membershipCount: fc.constant(membershipCount),
      otherUserCount: fc.constant(otherUserCount),
      explicitActiveIndex: explicitArb,
    });
  });

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

interface SeededWorld {
  /** The workspace ids the user is a member of, in creation order. */
  userWorkspaceIds: string[];
}

/**
 * Seed the generated model into `db` as raw snake_case rows (what the DB
 * stores), independent of the code under test. Returns the user's pre-existing
 * member workspace ids so the assertions can check membership.
 */
function seed(db: FakeDatabase, scenario: Scenario): SeededWorld {
  const workspaceRows: DbRow[] = [];
  const memberRows: DbRow[] = [];
  const userWorkspaceIds: string[] = [];

  let clock = 0;
  const ts = (): string => {
    clock += 1;
    // Monotonic ISO timestamps so created_at ordering is deterministic.
    return new Date(Date.UTC(2024, 0, 1, 0, 0, clock)).toISOString();
  };

  // The user's own member workspaces (the N of the property).
  for (let i = 0; i < scenario.membershipCount; i += 1) {
    const workspaceId = `ws-main-${i}`;
    userWorkspaceIds.push(workspaceId);
    workspaceRows.push({
      id: workspaceId,
      name: `Main Workspace ${i}`,
      created_at: ts(),
    });
    memberRows.push({
      id: `m-main-${i}`,
      workspace_id: workspaceId,
      user_id: scenario.userId,
      role: "member",
      created_at: ts(),
    });
  }

  // Noise: other users, each owning one workspace + membership. Ensures a
  // zero-membership user cannot accidentally resolve to an existing workspace.
  for (let j = 0; j < scenario.otherUserCount; j += 1) {
    const workspaceId = `ws-other-${j}`;
    workspaceRows.push({
      id: workspaceId,
      name: `Other Workspace ${j}`,
      created_at: ts(),
    });
    memberRows.push({
      id: `m-other-${j}`,
      workspace_id: workspaceId,
      user_id: `o-${j}`,
      role: "owner",
      created_at: ts(),
    });
  }

  db.tables.workspaces = workspaceRows;
  db.tables.workspace_members = memberRows;

  return { userWorkspaceIds };
}

/** All membership rows currently recorded for `userId`. */
function membershipsOf(db: FakeDatabase, userId: string): DbRow[] {
  return (db.tables.workspace_members ?? []).filter(
    (row) => row.user_id === userId,
  );
}

/* -------------------------------------------------------------------------- */
/* Property 3                                                                 */
/* -------------------------------------------------------------------------- */

describe("Property 3: authentication establishes exactly one active workspace (Req 1.2, 1.3)", () => {
  it("resolves exactly one active workspace, bootstrapping one when the user has none", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const db = new FakeDatabase();
        const { userWorkspaceIds } = seed(db, scenario);

        const workspacesBefore = (db.tables.workspaces ?? []).length;
        const userMembershipsBefore = membershipsOf(db, scenario.userId).length;

        const session: Session = {
          userId: scenario.userId,
          ...(scenario.explicitActiveIndex !== null
            ? { activeWorkspaceId: userWorkspaceIds[scenario.explicitActiveIndex]! }
            : {}),
        };

        const insforge = new LiveInsForgeClient({ database: db, configured: true });

        // Exercise the REAL getActiveWorkspace logic via the pure resolution core.
        const result = await resolveActiveWorkspaceCore({
          insforge,
          session,
          accessToken: "token-xyz",
        });

        // An authenticated session ALWAYS resolves to exactly one workspace.
        expect(result.status).toBe("resolved");
        if (result.status !== "resolved") {
          return;
        }
        // Exactly one workspace object (not a collection) is established, and the
        // access token is threaded through for the scoped client.
        expect(result.workspace).toBeDefined();
        expect(typeof result.workspace.id).toBe("string");
        expect(result.workspace.id.length).toBeGreaterThan(0);
        expect(result.accessToken).toBe("token-xyz");

        const resolvedId = result.workspace.id;
        const userMembershipsAfter = membershipsOf(db, scenario.userId);
        const workspacesAfter = (db.tables.workspaces ?? []).length;

        // CENTRAL "exactly one" invariant: the resolved workspace corresponds to
        // EXACTLY ONE membership of the user (no zero, no duplicates).
        const matchingMemberships = userMembershipsAfter.filter(
          (row) => row.workspace_id === resolvedId,
        );
        expect(matchingMemberships).toHaveLength(1);

        if (scenario.membershipCount === 0) {
          // Req 1.3: with no prior membership, a workspace AND an owner
          // membership are CREATED and selected.
          expect(workspacesAfter).toBe(workspacesBefore + 1);
          // The user now has exactly one membership: the freshly bootstrapped one.
          expect(userMembershipsAfter).toHaveLength(1);
          expect(matchingMemberships[0]).toMatchObject({
            workspace_id: resolvedId,
            user_id: scenario.userId,
            role: "owner",
          });
          // The created workspace exists in the workspaces table.
          const created = (db.tables.workspaces ?? []).find(
            (row) => row.id === resolvedId,
          );
          expect(created).toBeDefined();
        } else {
          // Req 1.2: the resolved workspace is one the user already belongs to,
          // and nothing new was created.
          expect(userWorkspaceIds).toContain(resolvedId);
          expect(workspacesAfter).toBe(workspacesBefore);
          expect(userMembershipsAfter).toHaveLength(userMembershipsBefore);

          // When an explicit member workspace was requested, it is honored.
          if (scenario.explicitActiveIndex !== null) {
            expect(resolvedId).toBe(
              userWorkspaceIds[scenario.explicitActiveIndex],
            );
          }
        }
      }),
      pbtParams(),
    );
  });
});
