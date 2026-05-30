import { z } from "zod";

import type { Claim, ClaimStatus } from "@/lib/schemas";
import type { Diff } from "@/lib/diff";
// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the courtroom-debate agents stay
// unit-testable with an injected {@link ModelClient}. The agents perform no
// external side effects of their own (Requirement 15.5); their only outbound
// call is the injected model. This mirrors the apify/model adapters'
// `import type` split for their pure cores.
import type { InferenceMessage, InferenceRequest, ModelClient } from "@/lib/adapters/types";

/**
 * Shared schemas, types, and helpers for the courtroom-style strategy debate
 * (Requirement 15).
 *
 * The debate has three participants. This module hosts the schemas and plumbing
 * common to all of them so that:
 *  - the defense agent (`./defense`) and prosecutor agent (`./prosecutor`)
 *    validate their structured output here (Requirements 15.1, 15.2), and
 *  - the judge + deterministic fallback (task 17.2) and the `runDebateStep`
 *    workflow wiring (task 18.6) can reuse the same schemas, evidence shape,
 *    and typed validation error rather than redefining them.
 *
 * Every agent reasons ONLY over the evidence handed to it — the collected
 * Claims, Claim_Statuses, and Diffs — and never reaches outside that evidence
 * or performs side effects (Requirement 15.5).
 */

/* -------------------------------------------------------------------------- */
/* Output schemas                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Structured output of the `defenseAgent`: a prose `argument` that the observed
 * changes SUPPORT a meaningful company strategy shift, plus the `keyEvidence`
 * excerpts it leans on (Requirement 15.1). `argument` must be non-empty;
 * `keyEvidence` may be empty.
 */
export const DefenseSchema = z.object({
  argument: z.string().min(1),
  keyEvidence: z.array(z.string()),
});

/**
 * Structured output of the `prosecutorAgent`: a prose `argument` that the
 * observed changes MAY NOT prove a strategy shift, plus the `counterEvidence`
 * that undercuts the shift — ambiguity, weak signals, missing evidence, and
 * copy-refresh risk (Requirement 15.2). `argument` must be non-empty;
 * `counterEvidence` may be empty.
 */
export const ProsecutorSchema = z.object({
  argument: z.string().min(1),
  counterEvidence: z.array(z.string()),
});

/** The defense argument, inferred from {@link DefenseSchema}. */
export type DefenseArgument = z.infer<typeof DefenseSchema>;

/** The prosecution argument, inferred from {@link ProsecutorSchema}. */
export type ProsecutorArgument = z.infer<typeof ProsecutorSchema>;

/* -------------------------------------------------------------------------- */
/* Evidence input                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One classifier assignment: a Claim's `statementText` paired with the
 * Claim_Status the classifier gave it. This mirrors the status payload the
 * demo ModelClient emits and is the shape the debate step (18.6) passes in.
 */
export interface ClaimStatusAssignment {
  statementText: string;
  claimStatus: ClaimStatus;
}

/**
 * The complete evidence set a debate agent reasons over: the collected Claims,
 * their Claim_Statuses, and the computed Diffs (Requirements 15.1, 15.2). No
 * agent may reason over anything outside this object.
 */
export interface DebateEvidence {
  claims: Claim[];
  statuses: ClaimStatusAssignment[];
  diffs: Diff[];
}

/**
 * Input to a debate agent runner: the {@link DebateEvidence} plus the
 * {@link ModelClient} to call. The model is injected so the agents stay pure
 * and testable (no adapter construction, no `server-only` import).
 */
export interface DebateAgentInput extends DebateEvidence {
  model: ModelClient;
}

/* -------------------------------------------------------------------------- */
/* Validation failure surface (for task 17.2 fallback substitution)           */
/* -------------------------------------------------------------------------- */

/** Which courtroom role produced the output under validation. */
export type DebateRole = "defense" | "prosecutor";

/**
 * Thrown when an agent's model output cannot be parsed as JSON or fails its Zod
 * schema. This is how a debate agent SURFACES a validation failure: rather than
 * swallowing it or substituting a value here, it throws a typed error that the
 * judge + fallback layer (task 17.2) catches to record the failure cause and
 * substitute the deterministic Demo_Company fallback Verdict, then continue the
 * workflow (Requirement 15.7).
 *
 * The error carries everything 17.2 needs to "record the failure cause": the
 * `agent` role, the underlying `failureCause` (a `ZodError` or `SyntaxError`),
 * and the offending `rawText`. (It deliberately does not use the built-in
 * `Error.cause` field so the original error object is always reachable under a
 * stable, explicitly-typed property.)
 */
export class AgentValidationError extends Error {
  readonly agent: DebateRole;
  readonly failureCause: unknown;
  readonly rawText: string;

  constructor(agent: DebateRole, failureCause: unknown, rawText: string) {
    super(`The ${agent} agent produced output that failed Zod schema validation`);
    this.name = "AgentValidationError";
    this.agent = agent;
    this.failureCause = failureCause;
    this.rawText = rawText;
  }
}

/* -------------------------------------------------------------------------- */
/* Shared plumbing                                                            */
/* -------------------------------------------------------------------------- */

/** Hard timeout applied to every debate inference request (Requirement 24.4). */
export const DEBATE_TIMEOUT_MS = 60_000;

/**
 * Serialize the evidence into the single user message a debate agent reasons
 * over. The payload is stable two-space JSON so demo runs stay byte-identical
 * (Requirement 18.7) and the model has an explicit, closed evidence set —
 * reinforcing the "reason only over this evidence" instruction in each agent's
 * system prompt (Requirement 15.5).
 */
export function buildEvidenceMessages(evidence: DebateEvidence): InferenceMessage[] {
  const payload = JSON.stringify(
    {
      claims: evidence.claims,
      claimStatuses: evidence.statuses,
      diffs: evidence.diffs,
    },
    null,
    2,
  );

  return [
    {
      role: "user",
      content:
        "Reason ONLY over the evidence in this JSON object. Do not introduce " +
        "any facts that are not present here.\n\n" +
        payload,
    },
  ];
}

/**
 * Build the {@link InferenceRequest} for a debate agent from its stance
 * (`system`), the `responseSchemaName` used for tracing and demo payload
 * routing, and the evidence. Bounded by {@link DEBATE_TIMEOUT_MS}.
 */
export function buildDebateRequest(
  system: string,
  responseSchemaName: string,
  evidence: DebateEvidence,
): InferenceRequest {
  return {
    system,
    messages: buildEvidenceMessages(evidence),
    responseSchemaName,
    timeoutMs: DEBATE_TIMEOUT_MS,
  };
}

/**
 * Parse `rawText` as JSON and validate it against `schema`. On either a JSON
 * syntax error or a Zod validation failure, throw an {@link AgentValidationError}
 * tagged with `role` so task 17.2 can substitute the deterministic fallback
 * (Requirement 15.7).
 */
export function parseAgentOutput<T>(
  role: DebateRole,
  schema: z.ZodType<T>,
  rawText: string,
): T {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (error) {
    throw new AgentValidationError(role, error, rawText);
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AgentValidationError(role, result.error, rawText);
  }
  return result.data;
}
