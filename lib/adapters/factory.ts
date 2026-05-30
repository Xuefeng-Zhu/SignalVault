import "server-only";

import { resolveRunMode, type AdapterRunModes } from "@/lib/config/env";

import type {
  ApifyClient,
  BoxClient,
  InsForgeClient,
  ModelClient,
} from "./types";

import {
  selectAdapters,
  selectImpl,
  type AdapterImplPair,
  type AdapterImplPairs,
  type AdapterSet,
} from "./factory-core";

// Concrete adapter implementations, imported through each adapter's server-only
// entry. Each entry binds the real credentials (read only via `lib/config/env`)
// and re-exports the live/demo client; this factory is the SINGLE construction
// point that picks between them (Requirement 23.1).
import { createLiveApifyClient } from "./apify/live";
import { DemoApifyClient } from "./apify/demo";
import { createLiveBoxClient } from "./box/live";
import { createDemoBoxClient } from "./box/demo";
import { createLiveInsForgeClient } from "./insforge/live";
import { createDemoInsForgeClient } from "./insforge/demo";
import { createLiveModelClient } from "./model/live";
import { createDemoModelClient } from "./model/demo";

/**
 * Server-only demo/live adapter selection factory (task 6.2).
 *
 * This is the SINGLE point at which SignalVault constructs the four external
 * adapters. Because adapters are the sole door to external services
 * (Requirement 23.1), wiring them here keeps every other layer dependent on the
 * interfaces in `./types` rather than on concrete Apify/Box/InsForge/Model
 * implementations.
 *
 * ## How selection works
 *
 * `resolveRunMode()` (in `lib/config/env.ts`) has already collapsed `DEMO_MODE`
 * + per-adapter `isConfigured()` into a per-adapter {@link AdapterRunModes}:
 *
 *   - `DEMO_MODE=true` → every adapter resolves to `"demo"` and no live
 *     credentials are consulted (Requirement 18.1).
 *   - otherwise each adapter resolves to `"live"` only when ITS OWN credentials
 *     are present, and to `"demo"` when they are missing (Requirement 18.2).
 *
 * For each adapter the factory then constructs the live implementation when its
 * resolved mode is `"live"`, and the demo implementation otherwise. The pure
 * selection logic lives in {@link selectAdapters} / {@link selectImpl} in
 * `./factory-core` (no `server-only`, unit-tested directly); this module only
 * supplies the lazy live/demo constructor pairs and the resolved modes.
 *
 * ## Mixed modes within one run (Requirement 18.2)
 *
 * Selection is per adapter and fully independent, so a single run can mix live
 * and demo — e.g. live InsForge + live Model while Apify and Box fall back to
 * demo because their tokens are absent. Construction is lazy: only the selected
 * implementation of each adapter is instantiated, so the demo path never builds
 * a live client (and never touches its credentials), and vice versa.
 *
 * ## InsForge auth/session threading
 *
 * The live InsForge client needs the signed-in user's access token so Postgres
 * RLS evaluates `auth.uid()` as that user (see `./insforge/live`). The factory
 * accepts an optional {@link AdapterContext} and threads `context.accessToken`
 * into the live InsForge client's constructor. The demo InsForge store ignores
 * it (it holds no credentials and resolves a single default demo workspace).
 * When no context is supplied the live client falls back to the anon key, which
 * RLS treats as unauthenticated — suitable only for bootstrapping.
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
   * (Requirements 1.4, 21.7). Ignored by the demo InsForge store and by the
   * other three adapters.
   */
  accessToken?: string;
  /** Optional name for a workspace created during first-login bootstrap. */
  defaultWorkspaceName?: string;
}

/**
 * Build the four lazy live/demo constructor pairs the selection core chooses
 * from. The InsForge pair closes over the {@link AdapterContext} so the live
 * client receives the caller's access token; all pairs are lazy, so only the
 * selected side of each is ever invoked.
 */
function implPairs(context: AdapterContext): AdapterImplPairs {
  const apify: AdapterImplPair<ApifyClient> = {
    live: () => createLiveApifyClient(),
    demo: () => new DemoApifyClient(),
  };

  const box: AdapterImplPair<BoxClient> = {
    live: () => createLiveBoxClient(),
    demo: () => createDemoBoxClient(),
  };

  const insforge: AdapterImplPair<InsForgeClient> = {
    // Thread the caller's auth token + optional bootstrap workspace name so RLS
    // runs as the signed-in user (Requirements 1.4, 21.7).
    live: () =>
      createLiveInsForgeClient({
        accessToken: context.accessToken,
        defaultWorkspaceName: context.defaultWorkspaceName,
      }),
    demo: () => createDemoInsForgeClient(),
  };

  const model: AdapterImplPair<ModelClient> = {
    live: () => createLiveModelClient(),
    demo: () => createDemoModelClient(),
  };

  return { apify, box, insforge, model };
}

/**
 * Construct the full {@link AdapterSet} for one scan/request, choosing live vs
 * demo per adapter from `resolveRunMode()`.
 *
 * @param context Optional per-request context. Supply `accessToken` so the live
 *   InsForge client runs under the signed-in user's RLS identity.
 * @param modes   Optional explicit per-adapter modes; defaults to
 *   `resolveRunMode()`. Primarily an override for tests/tooling that need a
 *   specific live/demo combination without manipulating the environment.
 */
export function createAdapters(
  context: AdapterContext = {},
  modes: AdapterRunModes = resolveRunMode(),
): AdapterSet {
  return selectAdapters(implPairs(context), modes);
}

/**
 * Construct only the Apify adapter, selected from its resolved run mode.
 * Useful for steps/routes that need a single adapter without building the rest.
 */
export function getApifyClient(
  modes: AdapterRunModes = resolveRunMode(),
): ApifyClient {
  return selectImpl(modes.apify, implPairs({}).apify);
}

/** Construct only the Box adapter, selected from its resolved run mode. */
export function getBoxClient(
  modes: AdapterRunModes = resolveRunMode(),
): BoxClient {
  return selectImpl(modes.box, implPairs({}).box);
}

/**
 * Construct only the InsForge adapter, selected from its resolved run mode. The
 * `context.accessToken` is threaded into the live client for per-user RLS.
 */
export function getInsForgeClient(
  context: AdapterContext = {},
  modes: AdapterRunModes = resolveRunMode(),
): InsForgeClient {
  return selectImpl(modes.insforge, implPairs(context).insforge);
}

/** Construct only the Model adapter, selected from its resolved run mode. */
export function getModelClient(
  modes: AdapterRunModes = resolveRunMode(),
): ModelClient {
  return selectImpl(modes.model, implPairs({}).model);
}

export type { AdapterSet } from "./factory-core";
