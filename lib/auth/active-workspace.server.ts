import "server-only";

import { cookies } from "next/headers";
import {
  createServerClient,
  getAccessTokenCookieName,
} from "@insforge/sdk/ssr";

import { getInsForgeClient } from "@/lib/adapters/factory";
import { insforgeApiKey, insforgeApiUrl, isDemoMode } from "@/lib/config/env";
import type { Session } from "@/lib/adapters/types";

import {
  resolveActiveWorkspaceCore,
  type ActiveWorkspaceResolution,
} from "./active-workspace";

/**
 * Server-only entry point for active-workspace resolution (task 8.1,
 * Requirements 1.1, 1.2, 1.3, 1.6, 1.7).
 *
 * Pages and route handlers call {@link resolveActiveWorkspace} to obtain the
 * single active workspace for the current request, together with the InsForge
 * client to derive a workspace-scoped repository from. The pure decision logic
 * lives in `./active-workspace` (no `server-only`, so property test 8.2 can
 * exercise it with a fake client); this module supplies the request plumbing:
 * reading the session/token from the InsForge auth cookies and threading the
 * token into the live client for RLS.
 *
 * ## How the session/token is read (InsForge auth SDK)
 *
 * InsForge stores the signed-in user's access token in an httpOnly cookie whose
 * name is owned by the SDK (`getAccessTokenCookieName()`, default
 * `insforge_access_token`) — we never hardcode it. We read that cookie via
 * Next's `cookies()` and, to obtain the authenticated user id, build a
 * short-lived InsForge SERVER client (`createServerClient` from
 * `@insforge/sdk/ssr`) bound to the token and call `auth.getCurrentUser()`. The
 * same token is threaded into `getInsForgeClient({ accessToken })` so every
 * subsequent query runs under the user's RLS identity (`auth.uid()`).
 *
 * ## Guarantees
 *
 * - Demo_Mode → the demo client's single default workspace, no auth required
 *   (Requirement 1.6); if it somehow cannot provide one, a `redirect` is
 *   returned so the System falls back to the auth flow (Requirement 1.7).
 * - Authenticated → exactly one active workspace, bootstrapping a workspace +
 *   owner membership when the user has none (Requirements 1.2, 1.3).
 * - Unauthenticated (no/invalid session) → `redirect`, so the caller renders no
 *   scoped content (Requirement 1.1). The middleware already redirects these
 *   before a page renders; this is the authoritative server-side backstop.
 */
export async function resolveActiveWorkspace(): Promise<ActiveWorkspaceResolution> {
  // Demo_Mode: bypass auth entirely; the demo InsForge store owns the single
  // default workspace (Requirement 1.6). `getInsForgeClient()` resolves to the
  // demo client because `resolveRunMode()` returns demo for every adapter.
  if (isDemoMode()) {
    const insforge = getInsForgeClient();
    return resolveActiveWorkspaceCore({
      insforge,
      demoMode: true,
      session: null,
    });
  }

  const accessToken = readAccessTokenCookie();
  if (!accessToken) {
    // No session cookie → unauthenticated (Requirement 1.1).
    return { status: "redirect", reason: "no InsForge access-token cookie" };
  }

  const session = await readSession(accessToken);
  if (!session) {
    // Cookie present but the token does not resolve to a user (expired/invalid).
    return { status: "redirect", reason: "session could not be resolved" };
  }

  // Authenticated: thread the user's token into the live client so RLS scopes
  // every query to the user (Requirements 1.4, 21.7), then resolve exactly one
  // active workspace (Requirements 1.2, 1.3).
  const insforge = getInsForgeClient({ accessToken });
  return resolveActiveWorkspaceCore({
    insforge,
    demoMode: false,
    session,
    accessToken,
  });
}

/**
 * Read the InsForge access-token cookie value, or undefined when absent/blank.
 * The cookie NAME comes from the SDK so it stays in lockstep with InsForge.
 */
function readAccessTokenCookie(): string | undefined {
  const store = cookies();
  const raw = store.get(getAccessTokenCookieName())?.value;
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * Resolve the authenticated user from an access token using a server-side
 * InsForge SDK client. Returns a minimal {@link Session} (just the user id,
 * which is all {@link resolveActiveWorkspaceCore} needs) or null when the token
 * does not resolve to a user.
 */
async function readSession(accessToken: string): Promise<Session | null> {
  const baseUrl = insforgeApiUrl();
  const anonKey = insforgeApiKey();
  if (!baseUrl || !anonKey) {
    // InsForge not configured — treat as unauthenticated rather than throwing.
    return null;
  }

  const client = createServerClient({ baseUrl, anonKey, accessToken });
  const { data, error } = await client.auth.getCurrentUser();
  if (error || !data.user) {
    return null;
  }
  return { userId: data.user.id };
}
