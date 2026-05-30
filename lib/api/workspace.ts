import "server-only";

import type { NextResponse } from "next/server";

import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import type { InsForgeClient, Workspace } from "@/lib/adapters/types";

import { jsonError, type ApiError } from "./errors";

/**
 * Server-only bridge between {@link resolveActiveWorkspace} (which returns a
 * `redirect` outcome suited to page rendering) and route handlers (which need
 * an HTTP error response instead of a redirect).
 *
 * Pages redirect unauthenticated users to the auth flow (Requirement 1.1);
 * route handlers should instead answer with a `401 UNAUTHORIZED` envelope so
 * `fetch` callers get a machine-readable error rather than an opaque redirect.
 * This helper resolves the active workspace and translates the `redirect`
 * outcome into that 401.
 */
export type RouteWorkspace =
  | {
      ok: true;
      workspace: Workspace;
      insforge: InsForgeClient;
      /** The signed-in user's access token, when present. Thread into
       *  `createAdapters({ accessToken })` so the workflow's live InsForge client
       *  runs under the correct RLS identity (Requirements 1.4, 21.7). */
      accessToken?: string;
    }
  | {
      ok: false;
      response: NextResponse<ApiError>;
    };

/**
 * Resolve the active workspace for a route handler. On success returns the
 * single active workspace plus the InsForge client to derive a scoped
 * repository from; otherwise returns a ready-to-send `401 UNAUTHORIZED`
 * response (no scoped data is leaked).
 */
export async function requireActiveWorkspace(): Promise<RouteWorkspace> {
  const resolution = await resolveActiveWorkspace();
  if (resolution.status === "redirect") {
    return {
      ok: false,
      response: jsonError("UNAUTHORIZED", "Authentication is required"),
    };
  }
  return {
    ok: true,
    workspace: resolution.workspace,
    insforge: resolution.insforge,
    accessToken: resolution.accessToken,
  };
}
