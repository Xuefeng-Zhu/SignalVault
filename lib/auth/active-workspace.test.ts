import { describe, expect, it, vi } from "vitest";

import type {
  InsForgeClient,
  Session,
  Workspace,
  WorkspaceRepository,
} from "@/lib/adapters/types";

import { resolveActiveWorkspaceCore } from "./active-workspace";

/** Unit tests for the pure active-workspace resolution core (task 8.1). */

const WORKSPACE: Workspace = {
  id: "ws-1",
  name: "Test Workspace",
  isDemo: false,
  createdAt: "2024-01-01T00:00:00.000Z",
};

/** A minimal fake InsForgeClient whose `getActiveWorkspace` is configurable. */
function fakeClient(
  getActiveWorkspace: InsForgeClient["getActiveWorkspace"],
): InsForgeClient {
  return {
    mode: "live",
    isConfigured: () => true,
    scoped: () => ({}) as WorkspaceRepository,
    getActiveWorkspace,
  };
}

describe("resolveActiveWorkspaceCore", () => {
  it("delegates to getActiveWorkspace for an authenticated session (Req 1.2, 1.3)", async () => {
    const session: Session = { userId: "user-1" };
    const getActiveWorkspace = vi.fn(async () => WORKSPACE);
    const insforge = fakeClient(getActiveWorkspace);

    const result = await resolveActiveWorkspaceCore({
      insforge,
      session,
      accessToken: "token-abc",
    });

    expect(getActiveWorkspace).toHaveBeenCalledWith(session);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.workspace).toEqual(WORKSPACE);
      expect(result.insforge).toBe(insforge);
      expect(result.accessToken).toBe("token-abc");
    }
  });

  it("redirects without touching the client when unauthenticated (Req 1.1)", async () => {
    const getActiveWorkspace = vi.fn(async () => WORKSPACE);
    const insforge = fakeClient(getActiveWorkspace);

    const result = await resolveActiveWorkspaceCore({
      insforge,
      session: null,
    });

    expect(result.status).toBe("redirect");
    // No scoped resolution attempted for an unauthenticated request.
    expect(getActiveWorkspace).not.toHaveBeenCalled();
  });
});
