// Testable core of active-workspace resolution (task 8.1, Requirements 1.2,
// 1.3, 1.6, 1.7).
//
// `import type` for the adapter surface keeps this module free of the
// `server-only` runtime guard that `@/lib/adapters/types` pulls in, so the
// resolution logic is unit/property-testable (property test 8.2) while the
// server-only request wiring lives in `./active-workspace.server`. This mirrors
// the live/demo client splits (`live`/`live-repository`, `demo`/`demo-store`).
//
// The hard guarantee this module provides: for an AUTHENTICATED session it
// resolves EXACTLY ONE active workspace (Requirement 1.2), delegating to
// `InsForgeClient.getActiveWorkspace`, which honors an explicit
// `activeWorkspaceId`, else the user's first membership, else BOOTSTRAPS a new
// workspace + owner membership when the user has none (Requirement 1.3). In
// Demo_Mode the demo client returns the single default workspace (Requirement
// 1.6). When neither a demo workspace nor an authenticated session is available
// the caller is told to fall back to the auth flow (Requirements 1.1, 1.7).

import type { InsForgeClient, Session, Workspace } from "@/lib/adapters/types";

/**
 * Outcome of resolving the active workspace.
 *
 * - `resolved`: a single active workspace is available; the caller may render
 *   scoped content using `client.scoped(workspace.id)`.
 * - `redirect`: no workspace could be resolved (unauthenticated and no demo
 *   default); the caller MUST redirect to the auth flow and render nothing
 *   scoped (Requirements 1.1, 1.7).
 */
export type ActiveWorkspaceResolution =
  | {
      readonly status: "resolved";
      /** The single active workspace for this request (Requirement 1.2). */
      readonly workspace: Workspace;
      /** The InsForge client used, so callers can derive a scoped repository. */
      readonly insforge: InsForgeClient;
      /** The access token threaded into the client, when one was present. */
      readonly accessToken?: string;
    }
  | {
      readonly status: "redirect";
      /** Why resolution fell back to the auth flow (for logging/diagnostics). */
      readonly reason: string;
    };

/** Inputs to the pure resolution core. */
export interface ResolveActiveWorkspaceCoreInput {
  /**
   * The InsForge client to resolve against. In Demo_Mode this is the demo
   * store (which always yields the default workspace); otherwise it is the live
   * client bound to the caller's access token for RLS.
   */
  insforge: InsForgeClient;
  /**
   * Whether Demo_Mode is active for this request. When true the demo client's
   * default workspace is used and no authenticated session is required
   * (Requirement 1.6).
   */
  demoMode: boolean;
  /**
   * The authenticated session, or null when the request carries no valid
   * session. Ignored in Demo_Mode.
   */
  session: Session | null;
  /** The access token associated with the session, when present. */
  accessToken?: string;
}

/**
 * Pure active-workspace resolution. No I/O of its own beyond the injected
 * `insforge` client; safe to unit/property-test directly.
 *
 * Resolution order:
 *  1. Demo_Mode → the demo client's single default workspace (Requirement 1.6).
 *     The demo `getActiveWorkspace` never throws and always yields one
 *     workspace, so Demo_Mode never falls through to the auth flow in practice.
 *     If it ever failed to provide one, we surface a `redirect` so the System
 *     falls back to the auth flow (Requirement 1.7).
 *  2. Authenticated session → delegate to `getActiveWorkspace(session)`, which
 *     guarantees exactly one active workspace, bootstrapping one when the user
 *     has none (Requirements 1.2, 1.3).
 *  3. Otherwise → `redirect`: unauthenticated access must not resolve scoped
 *     data (Requirement 1.1).
 */
export async function resolveActiveWorkspaceCore(
  input: ResolveActiveWorkspaceCoreInput,
): Promise<ActiveWorkspaceResolution> {
  const { insforge, demoMode, session, accessToken } = input;

  if (demoMode) {
    // Demo_Mode: the session is irrelevant; the demo client owns a single
    // default workspace. Pass a synthetic demo session for interface parity.
    try {
      const workspace = await insforge.getActiveWorkspace(
        session ?? { userId: "demo-user" },
      );
      return { status: "resolved", workspace, insforge };
    } catch (error) {
      // Demo_Mode could not provide a default workspace — fall back to the auth
      // flow (Requirement 1.7).
      return {
        status: "redirect",
        reason: `demo mode could not provide a default workspace: ${describeError(error)}`,
      };
    }
  }

  if (!session) {
    // Unauthenticated: never resolve scoped data (Requirement 1.1).
    return { status: "redirect", reason: "no authenticated session" };
  }

  // Authenticated: resolve exactly one active workspace, bootstrapping when the
  // user has no membership yet (Requirements 1.2, 1.3).
  const workspace = await insforge.getActiveWorkspace(session);
  return { status: "resolved", workspace, insforge, accessToken };
}

/** Best-effort string for an unknown thrown value (no secrets are included). */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
