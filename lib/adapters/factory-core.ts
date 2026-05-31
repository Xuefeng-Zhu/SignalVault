// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/config/env` and `@/lib/adapters/types` pull in, so the pure demo/live
// selection logic stays unit-testable while the concrete wiring (`./factory`)
// remains server-only. This mirrors the apify (`demo-capture`/`demo`) and model
// (`demo-inference`/`demo`) adapter splits.
import type { AdapterRunModes } from "@/lib/config/env";

import type {
  Adapter,
  ApifyClient,
  BoxClient,
  InsForgeClient,
  ModelClient,
  RunMode,
} from "./types";

/**
 * Pure demo/live selection core for the SignalVault adapter factory (task 6.2).
 *
 * This module holds ONLY the selection logic — it has no dependency on any
 * concrete live/demo implementation and never reads the environment, so it
 * stays trivially unit-testable and is unaffected by the order in which the
 * per-adapter implementation tasks land. The thin wiring that imports the
 * concrete classes and reads `resolveRunMode()` lives in `./factory`.
 *
 * Adapters are the sole door to external services (Requirement 23.1); the
 * factory is the single point at which a live or demo implementation is chosen.
 * The choice is made per adapter from the supplied {@link AdapterRunModes}.
 * Runtime code currently passes all-live modes via `resolveRunMode()`, while
 * tests can still exercise explicit demo or mixed-mode selections by supplying
 * their own modes.
 */

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A pair of lazy constructors for one adapter: the live implementation and the
 * demo implementation. Only the selected one is invoked, so constructing (for
 * example) the demo Box client never instantiates the live Box client or reads
 * its credentials.
 */
export interface AdapterImplPair<T extends Adapter> {
  live: () => T;
  demo: () => T;
}

/**
 * Choose the live or demo implementation for a single adapter from its resolved
 * {@link RunMode}. `"live"` constructs the live implementation; every other
 * value (i.e. `"demo"`) constructs the demo implementation, so a missing or
 * unexpected mode degrades safely to demo (Requirement 18.1).
 */
export function selectImpl<T extends Adapter>(
  mode: RunMode,
  impls: AdapterImplPair<T>,
): T {
  return mode === "live" ? impls.live() : impls.demo();
}

/* -------------------------------------------------------------------------- */
/* Adapter set                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The complete set of adapters for one scan. Every external dependency the
 * workflow needs is reached exclusively through one of these four interfaces
 * (Requirement 23.1).
 */
export interface AdapterSet {
  apify: ApifyClient;
  box: BoxClient;
  insforge: InsForgeClient;
  model: ModelClient;
}

/**
 * The four lazy implementation pairs the factory selects from — one per
 * adapter. `./factory` supplies these wired to the concrete live/demo classes;
 * tests can supply fakes to exercise the selection logic without touching the
 * network.
 */
export interface AdapterImplPairs {
  apify: AdapterImplPair<ApifyClient>;
  box: AdapterImplPair<BoxClient>;
  insforge: AdapterImplPair<InsForgeClient>;
  model: AdapterImplPair<ModelClient>;
}

/**
 * Build the full {@link AdapterSet} by selecting each adapter's implementation
 * from the supplied per-adapter run modes. Pure: `modes` is always provided by
 * the caller (the server-only `./factory` passes `resolveRunMode()`), so this
 * function never reads the environment.
 *
 * The independent per-adapter selection is what makes mixed-mode runs possible:
 * e.g. `{ apify: "demo", box: "demo", insforge: "live", model: "live" }` yields
 * a set with live InsForge/Model and demo Apify/Box within one scan
 * (Requirement 18.2).
 */
export function selectAdapters(
  impls: AdapterImplPairs,
  modes: AdapterRunModes,
): AdapterSet {
  return {
    apify: selectImpl(modes.apify, impls.apify),
    box: selectImpl(modes.box, impls.box),
    insforge: selectImpl(modes.insforge, impls.insforge),
    model: selectImpl(modes.model, impls.model),
  };
}
