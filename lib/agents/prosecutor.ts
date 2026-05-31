import {
  buildDebateRequest,
  parseAgentOutput,
  ProsecutorSchema,
  type DebateAgentInput,
  type ProsecutorArgument,
} from "./debate";

/**
 * The `prosecutorAgent` (Requirement 15.2).
 *
 * Produces structured output `{ argument, counterEvidence[] }` that argues the
 * observed changes MAY NOT prove a strategy shift — calling out ambiguity, weak
 * signals, missing evidence, and copy-refresh risk — reasoning ONLY over the
 * collected Claims, Claim_Statuses, and Diffs handed to it. The agent is
 * side-effect free: its only outbound interaction is the injected
 * {@link import('@/lib/adapters/types').ModelClient} call (Requirement 15.5).
 *
 * Output is validated against {@link ProsecutorSchema}. On a model response
 * that is not valid JSON or fails the schema, this surfaces the failure by
 * throwing an `AgentValidationError` (defined in `./debate`) so the judge +
 * deterministic fallback layer (task 17.2) can record the cause and substitute
 * the fallback Verdict (Requirement 15.7).
 */

/**
 * The stance encoded in the prosecutor system prompt: argue AGAINST treating
 * the changes as proof of a strategy shift, and ground every point in the
 * supplied evidence. Exported so the debate step (18.6) and tests can reference
 * the exact stance.
 */
export const PROSECUTOR_SYSTEM_PROMPT = [
  "You are the PROSECUTION in a courtroom-style analysis of whether a company's",
  "recent public changes indicate a meaningful strategy shift.",
  "",
  "Your stance: argue that the observed changes MAY NOT prove a meaningful",
  "strategy shift. Make the strongest good-faith skeptical case by calling out:",
  "- ambiguity in what the changes actually mean,",
  "- weak or low-confidence signals,",
  "- missing evidence needed to support a shift, and",
  "- copy-refresh risk (changes that may be routine wording/marketing updates",
  "  rather than a deliberate strategy change).",
  "",
  "Reason ONLY over the evidence provided to you: the collected Claims, their",
  "Claim_Statuses, and the computed Diffs. Do not invent facts, cite outside",
  "knowledge, or speculate beyond what the evidence shows. Populate",
  "counterEvidence with the specific claim statements or diff excerpts that",
  "undercut the case for a shift.",
  "",
  'Respond with ONLY a JSON object of the form {"argument": string,',
  '"counterEvidence": string[]} and no surrounding prose or code fences.',
].join("\n");

/**
 * `responseSchemaName` for the prosecutor request. It contains "Prosecutor" so
 * the live client traces it under a descriptive name.
 */
export const PROSECUTOR_RESPONSE_SCHEMA_NAME = "ProsecutorArgument";

/**
 * Run the prosecutor agent: build the inference request, call the injected
 * model, and validate the result against {@link ProsecutorSchema}.
 *
 * @throws AgentValidationError when the model output is not valid JSON or fails
 *   the schema — surfaced for the task 17.2 fallback substitution.
 */
export async function runProsecutor(
  input: DebateAgentInput,
): Promise<ProsecutorArgument> {
  const { model, ...evidence } = input;

  const request = buildDebateRequest(
    PROSECUTOR_SYSTEM_PROMPT,
    PROSECUTOR_RESPONSE_SCHEMA_NAME,
    evidence,
  );

  const { text } = await model.complete(request);
  return parseAgentOutput("prosecutor", ProsecutorSchema, text);
}
