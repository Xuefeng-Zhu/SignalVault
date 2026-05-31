import "server-only";

/**
 * Server-only environment and credential configuration for SignalVault.
 *
 * This module is the single place that reads external-provider credentials from
 * the environment. It MUST never be imported into client components: the
 * `import "server-only"` above causes a build-time error if it is bundled for
 * the browser, satisfying Requirement 22.1 (credentials are read only in
 * server-side code paths that are not delivered to the browser).
 *
 * Requirement 22.6 fixes the exact set of environment variables that hold
 * credentials. Runtime code always resolves adapters in live mode; tests may
 * still opt into demo adapters explicitly through factory overrides.
 *
 * Note: a local `RunMode` type is defined here to avoid a build-time dependency
 * on `lib/adapters/types.ts` (which is authored by a parallel task). The
 * adapters layer can re-export / reconcile this type later.
 */

/** Resolved operating mode for a single adapter. */
export type RunMode = "demo" | "live";

/** The four external adapters whose credentials this module governs. */
export type AdapterName = "apify" | "box" | "insforge" | "model";

/** Per-adapter resolved run modes for one scan. */
export type AdapterRunModes = Record<AdapterName, RunMode>;

/** Per-adapter "are live credentials present?" report. */
export type AdapterConfiguration = Record<AdapterName, boolean>;

/**
 * The names of every environment variable this module reads (Requirement 22.6).
 * Exported for documentation / tooling; reading still happens lazily via
 * {@link readEnv} so tests can mutate `process.env` between calls.
 */
export const CREDENTIAL_ENV_VARS = [
  "APIFY_TOKEN",
  "BOX_CLIENT_ID",
  "BOX_CLIENT_SECRET",
  "BOX_DEVELOPER_TOKEN",
  "INSFORGE_API_URL",
  "INSFORGE_API_KEY",
  "MODEL_API_KEY",
  "MODEL_BASE_URL",
] as const;

export type CredentialEnvVar = (typeof CREDENTIAL_ENV_VARS)[number];

/**
 * Environment variables that may hold the server-side secret used to encrypt
 * stored Integration credentials at rest (Requirement 22.3). This is NOT a
 * provider credential (so it is intentionally separate from
 * {@link CREDENTIAL_ENV_VARS}, which is fixed by Requirement 22.6); it is the
 * key material the credential vault derives its AES-256-GCM key from. Either
 * name may be set; `CREDENTIAL_SECRET` takes precedence over `ENCRYPTION_KEY`.
 * Only the server-only credential-vault code (`lib/security/crypto.ts`,
 * `lib/integrations/*`) ever reads it, and it is never sent to the browser.
 */
export const CREDENTIAL_ENCRYPTION_ENV_VARS = [
  "CREDENTIAL_SECRET",
  "ENCRYPTION_KEY",
] as const;

export type CredentialEncryptionEnvVar =
  (typeof CREDENTIAL_ENCRYPTION_ENV_VARS)[number];

/**
 * Read an environment variable by raw name, treating missing/blank values as
 * absent. Reading is lazy (at call time) rather than captured at module load so
 * the helpers reflect the current environment and remain testable.
 */
function readRawEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Read one of the fixed provider-credential environment variables (Requirement
 * 22.6), treating missing/blank values as absent.
 */
function readEnv(name: CredentialEnvVar): string | undefined {
  return readRawEnv(name);
}

/** True when a credential value is present and non-empty. */
function isPresent(name: CredentialEnvVar): boolean {
  return readEnv(name) !== undefined;
}

/**
 * Apify is configured for live operation when an API token is present.
 */
export function isApifyConfigured(): boolean {
  return isPresent("APIFY_TOKEN");
}

/**
 * The Apify API token, or undefined when unset/blank. Centralized here so the
 * live {@link ApifyClient} never reads `process.env` directly (Requirement 22.1:
 * credentials are read only through this server-only module).
 */
export function apifyToken(): string | undefined {
  return readEnv("APIFY_TOKEN");
}

/**
 * Box is configured for live operation when either an OAuth client pair
 * (BOX_CLIENT_ID + BOX_CLIENT_SECRET) or a developer token is present.
 */
export function isBoxConfigured(): boolean {
  const hasClientPair =
    isPresent("BOX_CLIENT_ID") && isPresent("BOX_CLIENT_SECRET");
  const hasDeveloperToken = isPresent("BOX_DEVELOPER_TOKEN");
  return hasClientPair || hasDeveloperToken;
}

/**
 * The Box developer token, or undefined when unset/blank. A Box developer token
 * is consumed directly as an OAuth 2.0 bearer access token. Centralized here so
 * the live {@link import('@/lib/adapters/types').BoxClient} never reads
 * `process.env` directly (Requirement 22.1: credentials are read only through
 * this server-only module).
 */
export function boxDeveloperToken(): string | undefined {
  return readEnv("BOX_DEVELOPER_TOKEN");
}

/**
 * The Box OAuth 2.0 client id, or undefined when unset/blank. Used (with
 * {@link boxClientSecret}) for the client-credentials grant when no developer
 * token is supplied.
 */
export function boxClientId(): string | undefined {
  return readEnv("BOX_CLIENT_ID");
}

/** The Box OAuth 2.0 client secret, or undefined when unset/blank. */
export function boxClientSecret(): string | undefined {
  return readEnv("BOX_CLIENT_SECRET");
}

/**
 * InsForge is configured for live operation when both the API URL and API key
 * are present.
 */
export function isInsforgeConfigured(): boolean {
  return isPresent("INSFORGE_API_URL") && isPresent("INSFORGE_API_KEY");
}

/**
 * The InsForge backend API base URL, or undefined when unset/blank. Centralized
 * here so the live {@link InsForgeClient} never reads `process.env` directly
 * (Requirement 22.1: credentials are read only through this server-only module).
 */
export function insforgeApiUrl(): string | undefined {
  return readEnv("INSFORGE_API_URL");
}

/**
 * The InsForge API key (anon/public key used as the default bearer for
 * unauthenticated requests; per-caller RLS is applied by layering the user's
 * access token on top). Undefined when unset/blank. Read only here so the live
 * client never touches `process.env` directly (Requirement 22.1).
 */
export function insforgeApiKey(): string | undefined {
  return readEnv("INSFORGE_API_KEY");
}

/**
 * True when a dedicated direct OpenAI-compatible provider is fully specified
 * (both MODEL_API_KEY and MODEL_BASE_URL present). This is distinct from
 * {@link isModelConfigured}: it answers specifically whether the *direct*
 * provider — as opposed to the InsForge Model Gateway — can be used. The live
 * ModelClient uses this (alongside {@link isInsforgeConfigured}) to resolve the
 * fixed provider precedence (Requirements 24.1, 24.2).
 */
export function isDirectModelProviderConfigured(): boolean {
  return isPresent("MODEL_API_KEY") && isPresent("MODEL_BASE_URL");
}

/**
 * The model adapter is configured for live operation when a dedicated
 * OpenAI-compatible endpoint is fully specified (MODEL_API_KEY + MODEL_BASE_URL)
 * OR when InsForge is configured, since the model adapter prefers the InsForge
 * Model Gateway (Requirement 24.2) and can route through it.
 */
export function isModelConfigured(): boolean {
  return isDirectModelProviderConfigured() || isInsforgeConfigured();
}

/** Credentials for a single OpenAI-compatible inference provider. */
export interface ModelProviderEndpoint {
  baseUrl: string;
  apiKey: string;
}

/**
 * Resolved credentials for each inference provider the live ModelClient may
 * route to. A provider is `null` when its credentials are absent. Reading
 * happens lazily (at call time) so the values reflect the current environment.
 *
 * - `insforge`: the InsForge Model Gateway, addressed by INSFORGE_API_URL /
 *   INSFORGE_API_KEY (preferred provider — Requirement 24.2).
 * - `direct`: a direct OpenAI-compatible endpoint, addressed by MODEL_BASE_URL /
 *   MODEL_API_KEY (Requirement 24.1).
 */
export interface ModelProviderCredentials {
  insforge: ModelProviderEndpoint | null;
  direct: ModelProviderEndpoint | null;
}

/**
 * Read the credentials for every inference provider from the environment. Only
 * the server-only ModelClient should call this; it never returns values to the
 * browser (Requirement 22.1).
 */
export function readModelProviderCredentials(): ModelProviderCredentials {
  const insforgeBaseUrl = readEnv("INSFORGE_API_URL");
  const insforgeApiKey = readEnv("INSFORGE_API_KEY");
  const directBaseUrl = readEnv("MODEL_BASE_URL");
  const directApiKey = readEnv("MODEL_API_KEY");

  return {
    insforge:
      insforgeBaseUrl !== undefined && insforgeApiKey !== undefined
        ? { baseUrl: insforgeBaseUrl, apiKey: insforgeApiKey }
        : null,
    direct:
      directBaseUrl !== undefined && directApiKey !== undefined
        ? { baseUrl: directBaseUrl, apiKey: directApiKey }
        : null,
  };
}

/**
 * The server-side secret used to derive the AES-256-GCM key that encrypts
 * stored Integration credentials at rest (Requirement 22.3), or undefined when
 * neither `CREDENTIAL_SECRET` nor `ENCRYPTION_KEY` is set. `CREDENTIAL_SECRET`
 * wins when both are present.
 *
 * This value is read ONLY by the server-only credential vault
 * (`lib/security/crypto.ts` via `lib/integrations/*`) and is never returned to
 * the browser (Requirement 22.1).
 */
export function credentialEncryptionSecret(): string | undefined {
  return readRawEnv("CREDENTIAL_SECRET") ?? readRawEnv("ENCRYPTION_KEY");
}

/**
 * True when a server-side credential-encryption secret is configured. Live
 * credential storage requires this so the persisted value is genuinely
 * encrypted (Requirement 22.3).
 */
export function isCredentialEncryptionConfigured(): boolean {
  return credentialEncryptionSecret() !== undefined;
}

/**
 * Aggregate per-adapter live-credential report.
 */
export function adapterConfiguration(): AdapterConfiguration {
  return {
    apify: isApifyConfigured(),
    box: isBoxConfigured(),
    insforge: isInsforgeConfigured(),
    model: isModelConfigured(),
  };
}

/**
 * Resolve the per-adapter run mode for runtime use.
 *
 * Runtime code now always uses live adapters. Demo adapters remain available
 * only for tests that explicitly override modes in the factory.
 */
export function resolveRunMode(): AdapterRunModes {
  return { apify: "live", box: "live", insforge: "live", model: "live" };
}
