/**
 * Pure, dependency-free provider-precedence resolution for the Model adapter.
 *
 * This module is intentionally free of `import "server-only"` and of any
 * network / SDK dependency so it can be imported directly by unit and
 * property tests (task 13.3, Property 30: "Model routing prefers the InsForge
 * Model Gateway"). The live ModelClient (`./live.ts`, which IS server-only)
 * imports {@link resolveModelProvider} to decide where to route each request.
 *
 * Fixed precedence (Requirement 24.2): when more than one inference provider is
 * configured, the InsForge Model Gateway is preferred over any other configured
 * OpenAI-compatible endpoint. The full deterministic order is:
 *
 *   1. InsForge Model Gateway   (`'insforge'`)   — preferred
 *   2. Direct OpenAI-compatible (`'openai-compatible'`)  — MODEL_BASE_URL + MODEL_API_KEY
 *   3. none configured          (`null`)
 *
 * The function is total and deterministic: it depends only on its argument, so
 * the property test can assert routing without any network access.
 */

/** The provider the live ModelClient routes a request to. */
export type ModelProvider = "insforge" | "openai-compatible";

/**
 * Plain description of which inference providers are currently configured.
 * Booleans only — no credentials — so this can be constructed freely in tests.
 */
export interface ModelProviderConfig {
  /** True when the InsForge Model Gateway is configured (preferred provider). */
  insforge: boolean;
  /** True when a direct OpenAI-compatible endpoint (MODEL_BASE_URL + MODEL_API_KEY) is configured. */
  openAiCompatible: boolean;
}

/**
 * Resolve the single provider for an inference request from the set of
 * configured providers, applying the fixed precedence that always prefers the
 * InsForge Model Gateway (Requirement 24.2). Returns `null` when no provider is
 * configured, in which case the adapter is not operational (Requirement 24.3).
 *
 * Pure and deterministic — depends solely on `config`.
 */
export function resolveModelProvider(
  config: ModelProviderConfig,
): ModelProvider | null {
  // Precedence is fixed: InsForge Model Gateway is always preferred when present,
  // regardless of whether a direct OpenAI-compatible endpoint is also configured.
  if (config.insforge) {
    return "insforge";
  }
  if (config.openAiCompatible) {
    return "openai-compatible";
  }
  return null;
}
