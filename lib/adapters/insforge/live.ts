import "server-only";

import { createClient, type Database, type InsForgeClient as SdkClient } from "@insforge/sdk";

import {
  insforgeApiKey,
  insforgeApiUrl,
  isInsforgeConfigured,
} from "@/lib/config/env";
import type { InsForgeClient } from "@/lib/adapters/types";

import {
  LiveInsForgeClient,
  type InsforgeDatabaseLike,
} from "./live-repository";

/**
 * Server-only entry for the live {@link InsForgeClient} (InsForge_Adapter).
 *
 * `import "server-only"` keeps the InsForge API key and this client out of the
 * browser bundle (Requirement 22.1). This module's only job is to:
 *   1. bind the real InsForge credentials — read exclusively through
 *      `lib/config/env.ts`, never from `process.env` here, and
 *   2. attach the CALLER'S auth token to a fresh `@insforge/sdk` client so that
 *      Postgres RLS evaluates `auth.uid()` as the signed-in user and scopes
 *      every row to that user's member workspaces (migration 0002).
 *
 * The workspace-scoping / mapping logic lives in the testable
 * {@link LiveInsForgeClient} core in `./live-repository`, which carries the
 * application-code workspace filter that layers on top of RLS (defense in
 * depth, Requirements 1.4, 21.7) and issues all inserts in array form
 * (Requirement 20.1).
 *
 * ## Auth/session wiring (RLS)
 *
 * The InsForge SDK client authenticates requests with a bearer token. To make
 * RLS apply per-user, the live client must run with the SIGNED-IN USER'S access
 * token, not just the project anon key. That token lives in the request context
 * (an httpOnly cookie set during auth). Request-context plumbing is wired by the
 * middleware/route layer in task 8.1; until then this factory accepts the token
 * explicitly via {@link CreateLiveInsForgeClientOptions.accessToken}. Callers
 * (route handlers, workflow steps) pass the per-request token they read from the
 * session. When no token is supplied the client falls back to the anon key,
 * which RLS treats as unauthenticated — suitable only for bootstrapping.
 *
 * Live InsForge is not exercised in this environment; the focus here is correct
 * structure, credential binding through `env.ts`, and per-caller auth threading.
 */
export interface CreateLiveInsForgeClientOptions {
  /**
   * The signed-in user's InsForge access token (JWT). When provided it is
   * applied to the SDK client so RLS sees `auth.uid()` as that user. Supplied
   * per-request by the caller; the wiring point is task 8.1's middleware.
   */
  accessToken?: string;
  /** Override the InsForge backend URL (defaults to `INSFORGE_API_URL`). */
  baseUrl?: string;
  /** Override the InsForge anon/API key (defaults to `INSFORGE_API_KEY`). */
  anonKey?: string;
  /** Name applied to a workspace created during first-login bootstrap. */
  defaultWorkspaceName?: string;
  /**
   * Inject a pre-built SDK client (tests / advanced wiring). When omitted a new
   * client is created from the resolved credentials.
   */
  client?: SdkClient;
}

/**
 * Adapt the `@insforge/sdk` database surface to the narrow
 * {@link InsforgeDatabaseLike} the repository core depends on. The PostgREST
 * query builder the SDK returns is structurally a superset of what the core
 * uses (chainable `select`/`insert`/`update`/`upsert`/filters, `maybeSingle`,
 * and a thenable `{ data, error }` result), so this is a single, contained cast
 * at the boundary rather than a per-method re-wrap.
 */
function adaptDatabase(database: Database): InsforgeDatabaseLike {
  return database as unknown as InsforgeDatabaseLike;
}

/**
 * Create the live {@link InsForgeClient}, bound to the resolved InsForge
 * credentials and (when provided) the caller's access token for RLS.
 */
export function createLiveInsForgeClient(
  options: CreateLiveInsForgeClientOptions = {},
): InsForgeClient {
  const baseUrl = options.baseUrl ?? insforgeApiUrl();
  const anonKey = options.anonKey ?? insforgeApiKey();

  const client =
    options.client ??
    createClient({
      baseUrl,
      anonKey,
    });

  // Thread the signed-in user's token so every DB call runs as that user and
  // RLS scopes rows to their workspaces. Without a token the client uses the
  // anon key (treated as unauthenticated by RLS).
  if (options.accessToken) {
    client.setAccessToken(options.accessToken);
  }

  return new LiveInsForgeClient({
    database: adaptDatabase(client.database),
    configured: isInsforgeConfigured(),
    defaultWorkspaceName: options.defaultWorkspaceName,
  });
}
