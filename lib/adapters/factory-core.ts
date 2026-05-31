import type {
  ApifyClient,
  BoxClient,
  InsForgeClient,
  ModelClient,
} from "./types";

/**
 * Core adapter set type for SignalVault.
 *
 * Adapters are the sole door to external services (Requirement 23.1); the
 * factory is the single point at which implementations are constructed.
 */

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
