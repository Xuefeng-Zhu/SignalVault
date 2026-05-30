import {
  buildDebateRequest,
  parseAgentOutput,
  DefenseSchema,
  type DebateAgentInput,
  type DefenseArgument,
} from "./debate";

/**
 * The `defenseAgent` (Requirement 15.1).
 *
 * Produces structured output `{ argument, keyEvidence[] }` that argues the
 * observed changes SUPPORT a meaningful company strategy shift, reasoning ONLY
 * over the collected Claims, Claim_Statuses, and Diffs handed to it. The agent
 * is side-effect free: its only outbound interaction is the injected
 * {@link import('@/lib/adapters/types').ModelClient} call (Requirement 15.5).
 *
 * Output is validated against {@link DefenseSchema}. On a model response that
 * is not valid JSON or fails the schema, this surfaces the failure by throwing
 * an `AgentValidationError` (defined in `./debate`) so the judge + deterministic
 * fallback layer (task 17.2) can record the cause and substitute the fallback
 * Verdict (Requirement 15.7).
 */

/**
 * The stance encoded in the defense system prompt: argue FOR a strategy shift
 * and ground every point in the supplied evidence. Exported so the debate step
 * (18.6) and tests can reference the exact stance.
 */
export const DEFENSE_SYSTEM_PROMPT = [
  "You are the DEFENSE in a courtroom-style analysis of whether a company's",
  "recent public changes indicate a meaningful strategy shift.",
  "",
  "Your stance: argue FOR the proposition that the observed changes SUPPORT a",
  "meaningful company strategy shift. Make the strongest good-faith case that",
  "the changes are deliberate and coordinated rather than incidental.",
  "",
  "Reason ONLY over the evidence provided to you: the collected Claims, their",
  "Claim_Statuses, and the computed Diffs. Do not invent facts, cite outside",
  "knowledge, or speculate beyond what the evidence shows. Populate keyEvidence",
  "with the specific claim statements or diff excerpts that most support the",
  "shift.",
  "",
  'Respond with ONLY a JSON object of the form {"argument": string,',
  '"keyEvidence": string[]} and no surrounding prose or code fences.',
].join("\n");

/**
 * `responseSchemaName` for the defense request. It contains "Defense" so the
 * live client traces it and the demo ModelClient routes to its seeded
 * defense payload (the demo matches names containing "defense"/"defence").
 */
export const DEFENSE_RESPONSE_SCHEMA_NAME = "DefenseArgument";

/**
 * Run the defense agent: build the inference request, call the injected model,
 * and validate the result against {@link DefenseSchema}.
 *
 * @throws AgentValidationError when the model output is not valid JSON or fails
 *   the schema — surfaced for the task 17.2 fallback substitution.
 */
export async function runDefense(input: DebateAgentInput): Promise<DefenseArgument> {
  const { model, ...evidence } = input;

  const request = buildDebateRequest(
    DEFENSE_SYSTEM_PROMPT,
    DEFENSE_RESPONSE_SCHEMA_NAME,
    evidence,
  );

  const { text } = await model.complete(request);
  return parseAgentOutput("defense", DefenseSchema, text);
}
