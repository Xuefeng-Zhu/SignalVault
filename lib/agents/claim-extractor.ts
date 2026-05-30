import { z } from "zod";

import { ClaimSchema, type Claim, type SourceType } from "@/lib/schemas";
// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the pure extractor logic stays directly
// unit-/property-testable with a FAKE ModelClient, mirroring the adapter layer's
// `demo-inference` / `demo-capture` split. The injected ModelClient is the ONLY
// outward dependency; there is no DB, no Box, and no network here (Req 13.3).
import type { InferenceRequest, ModelClient } from "@/lib/adapters/types";

/**
 * claimExtractorAgent — extracts discrete public {@link Claim}s from one
 * Snapshot's normalized content (design "Mastra Agents" → `claimExtractorAgent`).
 *
 * The agent reasons ONLY over the normalized content it is handed and performs
 * NO external side effects: it issues a single call through the injected
 * {@link ModelClient} and touches nothing else — no DB writes, no Box uploads,
 * no network beyond that adapter (Requirement 13.3). Persisting claims and the
 * claim-ledger artifact (Requirements 13.2, 13.4) is the workflow step's job
 * (`extractClaimsStep`, task 18.6), not this agent's.
 *
 * Output handling:
 *  - The model's `text` is parsed as JSON and validated against
 *    `z.array(ClaimSchema)`, so every emitted claim has a `claimType` in
 *    `ClaimTypeEnum`, a non-empty `statementText`/`evidenceText`, and a
 *    `confidence` in [0, 1] (Requirement 13.1).
 *  - GROUNDING (Requirement 13.5): only claims whose `evidenceText` actually
 *    appears in the normalized content survive; anything not directly supported
 *    by that content is filtered out.
 *  - EMPTY allowed (Requirement 13.6): when nothing is grounded — or when the
 *    model returns unparseable/invalid output — the agent returns `[]` and never
 *    throws. The deterministic workflow step owns retry/fallback; here, a
 *    response we cannot trust collapses to "no claims" rather than failing the
 *    whole scan.
 */

/** The `responseSchemaName` carried on the inference request (for tracing). */
const RESPONSE_SCHEMA_NAME = "Claim[]";

/** Claim extraction must complete within the adapter timeout ceiling (≤ 60s). */
const TIMEOUT_MS = 60_000;

/** Zod schema the raw model output is validated against before grounding. */
const ClaimArraySchema = z.array(ClaimSchema);

/** Input to {@link extractClaims}. */
export interface ExtractClaimsInput {
  /**
   * The Snapshot's normalized content — the SOLE evidence the agent reasons
   * over (Requirement 13.3). Grounding is checked against this exact string.
   */
  normalizedContent: string;
  /** The injected model adapter; the only outward dependency of the agent. */
  model: ModelClient;
  /**
   * Optional page role of the source (pricing, docs, …). Used only to enrich
   * the prompt; it never affects grounding or validation.
   */
  sourceType?: SourceType;
}

/**
 * Build the {@link InferenceRequest} for claim extraction.
 *
 * `responseSchemaName` contains "Claim" so the demo {@link ModelClient} maps it
 * to its seeded `Claim[]` payload (see `lib/adapters/model/demo-inference.ts`),
 * while the live client passes it through for tracing. The normalized content
 * is supplied verbatim as the user message so the model can only ground claims
 * in evidence we already persisted.
 */
function buildExtractionRequest(
  normalizedContent: string,
  sourceType?: SourceType,
): InferenceRequest {
  const sourceLine = sourceType
    ? `The content is from the company's "${sourceType}" page.\n`
    : "";

  const system = [
    "You are SignalVault's public claim extractor.",
    "Extract discrete, verifiable public claims a company is making, strictly from the normalized page content provided.",
    "Each claim must be one of these claim_type values: pricing, packaging, security, compliance, feature, integration, social_proof, hiring, terms, positioning.",
    "For every claim, set evidence_text to an EXACT, VERBATIM substring of the provided content that supports the claim — never paraphrase or invent evidence.",
    "Set confidence to a number between 0.0 and 1.0 inclusive.",
    "Do not infer claims that are not directly supported by the content. If the content contains no supportable public claim, return an empty array.",
    "Respond with ONLY a JSON array of objects with keys: claimType, statementText, evidenceText, confidence.",
  ].join(" ");

  return {
    system,
    messages: [
      {
        role: "user",
        content: `${sourceLine}Normalized content:\n\n${normalizedContent}`,
      },
    ],
    responseSchemaName: RESPONSE_SCHEMA_NAME,
    timeoutMs: TIMEOUT_MS,
  };
}

/**
 * Parse and validate raw model text into a `Claim[]`.
 *
 * Returns `[]` for any output we cannot trust — non-JSON text, or JSON that
 * does not satisfy `z.array(ClaimSchema)`. This is the graceful-degradation
 * choice documented above: an unparseable/invalid response → empty claims,
 * never a thrown error (Requirement 13.6).
 */
function parseClaims(rawText: string): Claim[] {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return [];
  }

  const result = ClaimArraySchema.safeParse(json);
  return result.success ? result.data : [];
}

/**
 * Keep only claims whose `evidenceText` is a literal substring of the
 * normalized content (Requirement 13.5).
 *
 * The check is an EXACT substring match (`String.prototype.includes`): no
 * trimming, case-folding, or whitespace normalization is applied to either
 * side. The prompt instructs the model to copy `evidence_text` verbatim from
 * the content, so an exact match is the correct, conservative grounding test —
 * any evidence the model paraphrased or fabricated will (rightly) be dropped.
 */
function groundClaims(claims: Claim[], normalizedContent: string): Claim[] {
  return claims.filter((claim) => normalizedContent.includes(claim.evidenceText));
}

/**
 * Extract grounded public claims from a Snapshot's normalized content.
 *
 * Pure aside from the single injected {@link ModelClient} call: same input +
 * same model behavior ⇒ same output. Always resolves (never rejects); an empty
 * result is a valid outcome (Requirement 13.6).
 *
 * @returns Claims that both conform to {@link ClaimSchema} (Requirement 13.1)
 *   and are grounded in `normalizedContent` (Requirement 13.5).
 */
export async function extractClaims(input: ExtractClaimsInput): Promise<Claim[]> {
  const { normalizedContent, model, sourceType } = input;

  const request = buildExtractionRequest(normalizedContent, sourceType);
  const { text } = await model.complete(request);

  const validated = parseClaims(text);
  return groundClaims(validated, normalizedContent);
}
