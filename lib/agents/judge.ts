import {
  StrategyEnum,
  VerdictSchema,
  type Strategy,
  type Verdict,
} from '@/lib/schemas';
import { buildDemoFallbackVerdict } from '@/lib/demo';

// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the pure judge/debate logic stays
// unit-testable and importable in tests with an injected `ModelClient`. This
// mirrors the model adapter's `demo-inference` split.
import type { InferenceRequest, ModelClient } from '@/lib/adapters/types';

// The defense/prosecution schemas, argument types, and the shared
// {@link DebateEvidence} shape are owned by `./debate` (task 17.1) — the judge
// imports them rather than redefining them (see the reconciliation note below).
import {
  DefenseSchema,
  ProsecutorSchema,
  type DebateEvidence,
  type DefenseArgument,
  type ProsecutorArgument,
} from './debate';

/**
 * judgeAgent + deterministic debate conclusion for SignalVault.
 *
 * The judge reasons **only** over evidence collected by the deterministic
 * workflow steps (the defense argument, the prosecution argument, and the
 * collected Claims / Claim_Statuses / Diffs) and performs no external side
 * effects beyond the injected {@link ModelClient} (Requirements 15.5, 23.7).
 *
 * This module implements three rules from Requirement 15:
 *
 *  - **15.3** — {@link runJudge} asks the model for a `Verdict`, parses the JSON
 *    text, and validates it against {@link VerdictSchema} (strategy ∈
 *    {@link StrategyEnum}, integer confidence/riskScore in [0, 100], 1–10
 *    non-empty recommended actions).
 *  - **15.6** — when NO diffs were computed AND no claim was assigned a
 *    Claim_Status, {@link concludeDebate} short-circuits to an
 *    `insufficient_evidence` verdict with confidence ≤ 25 **without calling the
 *    model**. This rule is deterministic and takes precedence over everything
 *    else.
 *  - **15.7** — when the defense, prosecution, OR judge output fails its Zod
 *    schema validation (or the model errors / times out, per 19.3),
 *    {@link concludeDebate} records the failure cause and substitutes the
 *    deterministic Demo_Company fallback Verdict, letting the workflow continue.
 *
 * ## Reconciliation with `./debate` (task 17.1)
 *
 * The defenseAgent / prosecutorAgent and the shared debate plumbing live in
 * `./debate`. That module is the single source of truth for the defense /
 * prosecution Zod schemas ({@link DefenseSchema}, {@link ProsecutorSchema}),
 * their inferred argument types ({@link DefenseArgument},
 * {@link ProsecutorArgument}), and the {@link DebateEvidence} shape the whole
 * debate reasons over. The judge imports those rather than defining its own, so
 * defense/prosecutor (from `./debate`) and the judge compose with one set of
 * types. Crucially, `DebateEvidence.statuses` is the shared
 * `ClaimStatusAssignment[]` (`{ statementText, claimStatus }`) — the exact shape
 * the classifier emits and `runDebateStep` (task 18.6) threads in — not a bare
 * `ClaimStatus[]`. The insufficient-evidence rule (15.6) only inspects
 * `statuses.length`, so it is unaffected by the element shape. For backward
 * compatibility this module re-exports `DefenseArgumentSchema` /
 * `ProsecutorArgumentSchema` as aliases of the shared schemas.
 *
 * Requirements: 15.3, 15.5, 15.6, 15.7, 19.3, 23.7
 */

/* -------------------------------------------------------------------------- */
/* Defense / prosecution argument shapes (re-exported from ./debate)          */
/* -------------------------------------------------------------------------- */

/**
 * Re-export of the shared defense schema (`{ argument, keyEvidence[] }`) under
 * the judge's historical name so existing importers keep working. The schema
 * itself is owned by `./debate` (Requirement 15.1).
 */
export const DefenseArgumentSchema = DefenseSchema;

/**
 * Re-export of the shared prosecutor schema (`{ argument, counterEvidence[] }`)
 * under the judge's historical name (Requirement 15.2).
 */
export const ProsecutorArgumentSchema = ProsecutorSchema;

export type { DebateEvidence, DefenseArgument, ProsecutorArgument };

/* -------------------------------------------------------------------------- */
/* Inputs / outputs                                                           */
/* -------------------------------------------------------------------------- */

/** Validated inputs to {@link runJudge}. */
export interface JudgeInput extends DebateEvidence {
  defense: DefenseArgument;
  prosecution: ProsecutorArgument;
  model: ModelClient;
}

/**
 * Inputs to {@link concludeDebate}. `defense` and `prosecution` are the **raw**
 * agent outputs (`unknown`) so they can be validated here; on a Zod failure the
 * deterministic fallback is substituted (Requirement 15.7).
 */
export interface DebateInput extends DebateEvidence {
  defense: unknown;
  prosecution: unknown;
  model: ModelClient;
}

/**
 * The conclusion of the debate. `verdict` always satisfies {@link VerdictSchema}.
 * `isFallback` records whether the deterministic Demo_Company fallback was
 * substituted (consumed by the persistence step 18.7, which writes the
 * `verdicts.is_fallback` column), and `failureCause` records why (Requirement
 * 15.7). For the normal and insufficient-evidence paths `isFallback` is false
 * and `failureCause` is null.
 */
export interface DebateConclusion {
  verdict: Verdict;
  isFallback: boolean;
  failureCause: string | null;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Raised by {@link runJudge} when the model output cannot be turned into a
 * schema-valid {@link Verdict} (the response is not JSON, or it fails
 * {@link VerdictSchema}). {@link concludeDebate} catches this and substitutes
 * the fallback (Requirement 15.7).
 */
export class JudgeOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'JudgeOutputError';
  }
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** `responseSchemaName` for the judge request; the demo model client keys its
 * deterministic Verdict payload off a name containing "verdict"/"judge". */
export const JUDGE_RESPONSE_SCHEMA_NAME = 'Verdict' as const;

/** Per-request model timeout ceiling for the judge (Requirement 19.3 / 60s). */
export const JUDGE_TIMEOUT_MS = 60_000 as const;

/** Confidence used for the deterministic insufficient-evidence verdict (≤ 25). */
export const INSUFFICIENT_EVIDENCE_CONFIDENCE = 25 as const;

const INSUFFICIENT_EVIDENCE_STRATEGY: Strategy = 'insufficient_evidence';

const JUDGE_SYSTEM_PROMPT = [
  'You are the judge in a courtroom-style analysis of a company\u2019s public',
  'website changes. You have heard a defense argument (the changes support a',
  'deliberate strategy shift) and a prosecution argument (the changes may not',
  'prove a durable shift). Weigh both sides using only the evidence provided and',
  'return a single strategy Verdict as JSON. The verdict must contain:',
  'strategyPrediction (one of: ' + StrategyEnum.options.join(', ') + '),',
  'confidence (integer 0-100), riskScore (integer 0-100), recommendedActions',
  '(1-10 short non-empty strings), keyEvidence (string[]), and counterEvidence',
  '(string[]). Reason only over the supplied evidence; do not invent facts.',
].join(' ');

/* -------------------------------------------------------------------------- */
/* Deterministic helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The insufficient-evidence rule (Requirement 15.6): true when NO diffs were
 * computed AND no claim was assigned a Claim_Status for the scan. Pure and
 * deterministic — it never consults the model.
 */
export function isEvidenceAbsent(evidence: Pick<DebateEvidence, 'statuses' | 'diffs'>): boolean {
  return evidence.diffs.length === 0 && evidence.statuses.length === 0;
}

/**
 * Build the deterministic `insufficient_evidence` Verdict (confidence
 * {@link INSUFFICIENT_EVIDENCE_CONFIDENCE} = 25, which satisfies "≤ 25").
 * Returned as a fresh object so callers may mutate it freely.
 */
export function buildInsufficientEvidenceVerdict(): Verdict {
  return {
    strategyPrediction: INSUFFICIENT_EVIDENCE_STRATEGY,
    confidence: INSUFFICIENT_EVIDENCE_CONFIDENCE,
    riskScore: 0,
    recommendedActions: [
      'Insufficient evidence to predict a strategy shift; re-run a scan once watched-source content has changed so diffs and claim statuses can be collected.',
    ],
    keyEvidence: [],
    counterEvidence: [],
  };
}

/**
 * Strip the persistence-only `isFallback` flag from the deterministic
 * Demo_Company fallback so the `verdict` field of {@link DebateConclusion} is a
 * plain, schema-valid {@link Verdict}; `isFallback` is surfaced separately on
 * the conclusion for the persistence step (18.7).
 */
function fallbackVerdictValue(): Verdict {
  const { isFallback: _isFallback, ...verdict } = buildDemoFallbackVerdict();
  return verdict;
}

/* -------------------------------------------------------------------------- */
/* Prompt building                                                            */
/* -------------------------------------------------------------------------- */

/** Compact, deterministic serialization of the evidence for the judge prompt. */
function serializeEvidence(input: JudgeInput): string {
  const claims = input.claims.map((c) => ({
    claimType: c.claimType,
    statementText: c.statementText,
    evidenceText: c.evidenceText,
    confidence: c.confidence,
  }));
  const diffs = input.diffs.map((d) => ({
    changeScore: d.changeScore,
    changeSummary: d.changeSummary,
    addedText: d.addedText,
    removedText: d.removedText,
    modifiedSections: d.modifiedSections,
  }));
  return JSON.stringify(
    {
      defense: { argument: input.defense.argument, keyEvidence: input.defense.keyEvidence },
      prosecution: {
        argument: input.prosecution.argument,
        counterEvidence: input.prosecution.counterEvidence,
      },
      claims,
      claimStatuses: input.statuses,
      diffs,
    },
    null,
    2,
  );
}

/** Build the {@link InferenceRequest} the judge sends to the model. */
export function buildJudgeRequest(input: JudgeInput): InferenceRequest {
  return {
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          'Decide the strategy verdict from the following debate and evidence. ' +
          'Respond with only the Verdict JSON object.\n\n' +
          serializeEvidence(input),
      },
    ],
    responseSchemaName: JUDGE_RESPONSE_SCHEMA_NAME,
    timeoutMs: JUDGE_TIMEOUT_MS,
  };
}

/* -------------------------------------------------------------------------- */
/* judgeAgent                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Run the judgeAgent: ask the injected {@link ModelClient} for a Verdict, parse
 * the returned JSON text, and validate it against {@link VerdictSchema}
 * (Requirement 15.3). Side-effect free apart from the model call.
 *
 * Throws {@link JudgeOutputError} when the response is not valid JSON or fails
 * the schema; model-level errors (network, timeout, uncredentialed) propagate
 * unchanged. {@link concludeDebate} converts both into the deterministic
 * fallback (Requirements 15.7, 19.3).
 */
export async function runJudge(input: JudgeInput): Promise<Verdict> {
  const { text } = await input.model.complete(buildJudgeRequest(input));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new JudgeOutputError('judgeAgent response was not valid JSON', { cause });
  }

  const result = VerdictSchema.safeParse(parsed);
  if (!result.success) {
    throw new JudgeOutputError(
      `judgeAgent output failed VerdictSchema validation: ${result.error.message}`,
      { cause: result.error },
    );
  }
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* concludeDebate                                                             */
/* -------------------------------------------------------------------------- */

/** Build a fallback {@link DebateConclusion} carrying the recorded cause. */
function fallbackConclusion(failureCause: string): DebateConclusion {
  return { verdict: fallbackVerdictValue(), isFallback: true, failureCause };
}

/**
 * Conclude the courtroom debate into a single {@link DebateConclusion}, applying
 * the deterministic rules in priority order:
 *
 *  1. **Insufficient evidence (15.6, precedence)** — if no diffs were computed
 *     AND no claim was assigned a Claim_Status, return the deterministic
 *     `insufficient_evidence` verdict (confidence ≤ 25) **without calling the
 *     model**. This is enforced here, not by the model, so it always holds.
 *  2. **Fallback on invalid agent output (15.7)** — validate the raw defense and
 *     prosecution outputs against their Zod schemas, then run the judge. If any
 *     of the three fails Zod validation (or the model errors / times out, per
 *     19.3), record the failure cause and substitute the deterministic
 *     Demo_Company fallback verdict so the workflow can continue.
 *  3. **Normal** — otherwise return the validated judge Verdict.
 */
export async function concludeDebate(input: DebateInput): Promise<DebateConclusion> {
  // Rule 1: insufficient-evidence short-circuit takes precedence and never
  // consults the model (Requirement 15.6).
  if (isEvidenceAbsent(input)) {
    return {
      verdict: buildInsufficientEvidenceVerdict(),
      isFallback: false,
      failureCause: null,
    };
  }

  // Rule 2a: validate the raw defense / prosecution agent outputs.
  const defense = DefenseArgumentSchema.safeParse(input.defense);
  if (!defense.success) {
    return fallbackConclusion(
      `defenseAgent output failed Zod validation: ${defense.error.message}`,
    );
  }
  const prosecution = ProsecutorArgumentSchema.safeParse(input.prosecution);
  if (!prosecution.success) {
    return fallbackConclusion(
      `prosecutorAgent output failed Zod validation: ${prosecution.error.message}`,
    );
  }

  // Rule 2b + 3: run the judge; any judge Zod failure or model error becomes the
  // deterministic fallback (Requirements 15.7, 19.3).
  try {
    const verdict = await runJudge({
      defense: defense.data,
      prosecution: prosecution.data,
      claims: input.claims,
      statuses: input.statuses,
      diffs: input.diffs,
      model: input.model,
    });
    return { verdict, isFallback: false, failureCause: null };
  } catch (error) {
    const cause =
      error instanceof JudgeOutputError
        ? error.message
        : `judgeAgent model invocation failed: ${
            error instanceof Error ? error.message : String(error)
          }`;
    return fallbackConclusion(cause);
  }
}
