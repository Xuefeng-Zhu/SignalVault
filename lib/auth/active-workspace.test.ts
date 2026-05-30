import { describe, expect, it, vi } from "vitest";

import type {
  InsForgeClient,
  Session,
  Workspace,
  WorkspaceRepository,
} from "@/lib/adapters/types";

import { resolveActiveWorkspaceCore } from "./active-workspace";

/**
 * Unit tests for the pure active-workspace resolution core (task 8.1,
 * Requirements 1.1, 1.2, 1.3, 1.6, 1.7). The exactly-one / bootstrap PROPERTY
 * is covered by property test 8.2; these examples pin the branch behavior:
 * demo bypass, authenticated delegation, unauthenticated redirect, and the
 * demo cannot-provide-one fallback.
 */

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
    mode: "demo",
    isConfigured: () => false,
    scoped: () => ({}) as WorkspaceRepository,
    getActiveWorkspace,
  };
}

describe("resolveActiveWorkspaceCore", () => {
  it("resolves the demo default workspace and ignores the session (Req 1.6)", async () => {
    const getActiveWorkspace = vi.fn(async () => WORKSPACE);
    const insforge = fakeClient(getActiveWorkspace);

    const result = await resolveActiveWorkspaceCore({
      insforge,
      demoMode: true,
      session: null,
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.workspace).toEqual(WORKSPACE);
      expect(result.insforge).toBe(insforge);
    }
    // Demo path still calls the client (with a synthetic session) for parity.
    expect(getActiveWorkspace).toHaveBeenCalledOnce();
  });

  it("falls back to the auth flow when demo mode cannot provide a workspace (Req 1.7)", async () => {
    const insforge = fakeClient(
      vi.fn(async () => {
        throw new Error("no default workspace");
      }),
    );

    const result = await resolveActiveWorkspaceCore({
      insforge,
      demoMode: true,
      session: null,
    });

    expect(result.status).toBe("redirect");
    if (result.status === "redirect") {
      expect(result.reason).toContain("demo mode could not provide");
    }
  });

  it("delegates to getActiveWorkspace for an authenticated session (Req 1.2, 1.3)", async () => {
    const session: Session = { userId: "user-1" };
    const getActiveWorkspace = vi.fn(async () => WORKSPACE);
    const insforge = fakeClient(getActiveWorkspace);

    const result = await resolveActiveWorkspaceCore({
      insforge,
      demoMode: false,
      session,
      accessToken: "token-abc",
    });

    expect(getActiveWorkspace).toHaveBeenCalledWith(session);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.workspace).toEqual(WORKSPACE);
      expect(result.accessToken).toBe("token-abc");
    }
  });

  it("redirects without touching the client when unauthenticated (Req 1.1)", async () => {
    const getActiveWorkspace = vi.fn(async () => WORKSPACE);
    const insforge = fakeClient(getActiveWorkspace);

    const result = await resolveActiveWorkspaceCore({
      insforge,
      demoMode: false,
      session: null,
    });

    expect(result.status).toBe("redirect");
    // No scoped resolution attempted for an unauthenticated request.
    expect(getActiveWorkspace).not.toHaveBeenCalled();
  });
});
