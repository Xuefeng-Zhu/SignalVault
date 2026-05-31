import "server-only";

import type {
  ApifyClient,
  BoxClient,
  InsForgeClient,
  ModelClient,
} from "./types";

import type { AdapterSet } from "./factory-core";

// Concrete live adapter implementations.
import { createLiveApifyClient } from "./apify/live";
import { createLiveStorageClient } from "./storage/live";
import { createLiveInsForgeClient } from "./insforge/live";
import { createLiveModelClient } from "./model/live";

/**
 * Server-only adapter factory for SignalVault.
 *
 * This is the SINGLE point at which SignalVault constructs the four external
 * adapters. Because adapters are the sole door to external services
 * (Requirement 23.1), wiring them here keeps every other layer dependent on the
 * interfaces in `./types` rather than on concrete implementations.
 *
 * ## InsForge auth/session threading
 *
 * The live InsForge client needs the signed-in user's access token so Postgres
 * RLS evaluates `auth.uid()` as that user (see `./insforge/live`). The factory
 * accepts an optional {@link AdapterContext} and threads `context.accessToken`
 * into the live InsForge client's constructor.
 */

/**
 * Optional per-request construction context. Currently carries only the
 * InsForge auth token (threaded into the live InsForge client for RLS), but is
 * an object so additional per-request wiring can be added without changing call
 * sites.
 */
export interface AdapterContext {
  /**
   * The signed-in user's InsForge access token (JWT). Threaded into the live
   * InsForge client so RLS scopes every query to the caller's workspaces
   * (Requirements 1.4, 21.7).
   */
  accessToken?: string;
  /** Optional name for a workspace created during first-login bootstrap. */
  defaultWorkspaceName?: string;
}

/**
 * Construct the full {@link AdapterSet} for one scan/request.
 *
 * @param context Optional per-request context. Supply `accessToken` so the live
 *   InsForge client runs under the signed-in user's RLS identity.
 */
export function createAdapters(context: AdapterContext = {}): AdapterSet {
  return {
    apify: createLiveApifyClient(),
    box: createLiveStorageClient(),
    insforge: createLiveInsForgeClient({
      accessToken: context.accessToken,
      defaultWorkspaceName: context.defaultWorkspaceName,
    }),
    model: createLiveModelClient(),
  };
}

/**
 * Construct only the Apify adapter.
 */
export function getApifyClient(): ApifyClient {
  return createLiveApifyClient();
}

/** Construct only the Box adapter. */
export function getBoxClient(): BoxClient {
  return createLiveStorageClient();
}

/**
 * Construct only the InsForge adapter. The `context.accessToken` is threaded
 * into the live client for per-user RLS.
 */
export function getInsForgeClient(context: AdapterContext = {}): InsForgeClient {
  return createLiveInsForgeClient({
    accessToken: context.accessToken,
    defaultWorkspaceName: context.defaultWorkspaceName,
  });
}

/** Construct only the Model adapter. */
export function getModelClient(): ModelClient {
  return createLiveModelClient();
}

export type { AdapterSet } from "./factory-core";
