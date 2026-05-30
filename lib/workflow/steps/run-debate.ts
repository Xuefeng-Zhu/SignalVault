import { z } from "zod";

import {
  AgentValidationError,
  concludeDebate,
  runDefense,
  runProsecutor,
  type ClaimStatusAssignment,
  type DebateConclusion,
  type DebateEvidence,
} from "@/lib/agents";
import { StrategyEnum, type Claim } from "@/lib/schemas";
import type { Diff } from "@/lib/diff";

import {
  addWarning,
  errorMessage,
  setScanStatus,
  type ScanWorkflowContext,
} from "../context";
import { parseAtBoundary } from "./artifacts";
import type { ClassifyClaimsData } from "./classify-claims";
import type { ComputeDiffData } from "./compute-diff";

/**
 * Step 10 — `runDebateStep` (status `analyzing`).
 *
 * Runs the courtroom-style strategy debate over the collected evidence and
 * produces the final {@link DebateConclusion}:
 *
 *  1. Builds the {@link DebateEvidence} from the persisted claims, their
 *     classified Claim_Statuses, and the computed Diffs — the SOLE evidence the
 *     agents reason over (Requirements 15.1, 15.2, 15.5).
 *  2. Runs the `defenseAgent` ({@link runDefense}) and `prosecutorAgent`
 *     ({@link runProsecutor}). Each is Zod-validated inside the agent; an
 *     {@link AgentValidationError} (bad model JSON / schema failure) is CAUGHT
 *     here and its raw output is carried into {@link concludeDebate}, so the
 *     deterministic fallback substitution (Requirement 15.7) applies rather than
 *     crashing the scan.
 *  3. Calls {@link concludeDebate}, which applies the judge + the deterministic
 *     rules in priority order:
 *       - insufficient-evidence short-circuit when no diffs AND no statuses
 *         exist (Requirement 15.6), then
 *       - the deterministic Demo_Company fallback when any agent output (defense,
 *         prosecutor, or judge) fails validation or the model errors
 *         (Requirements 15.7, 19.3), else
 *       - the validated judge Verdict (Requirement 15.3).
 *
 * The resulting `{ verdict, isFallback, failureCause }` is carried forward to
 * the brief + persistence steps. When the fallback was substituted, a warning
 * carrying the recorded cause is accumulated on the context.
 *
 * The step core takes the context explicitly and uses only the injected model
 * adapter (no DB, no Box), so it carries no `server-only` import and is
 * unit-testable with fakes.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.6, 15.7, 7.2, 23.4
 */

/** Output of {@link runDebateStep}: the concluded debate verdict + flags. */
export type DebateData = DebateConclusion;

/** Boundary schema for the concluded verdict (mirrors `VerdictSchema` + flags). */
const DebateDataSchema = z.object({
  verdict: z.object({
    strategyPrediction: StrategyEnum,
    confidence: z.number().int().min(0).max(100),
    riskScore: z.number().int().min(0).max(100),
    recommendedActions: z.array(z.string().min(1)).min(1).max(10),
    keyEvidence: z.array(z.string()),
    counterEvidence: z.array(z.string()),
  }),
  isFallback: z.boolean(),
  failureCause: z.string().min(1).nullable(),
});

/** The outcome of running one debate agent: its validated value or raw output. */
type AgentOutcome =
  | { ok: true; value: unknown }
  | { ok: false; raw: unknown; cause: string };

/**
 * Run {@link runDebateStep} against the shared workflow context, consuming the
 * classified claims (step 9) and the computed diffs (step 7).
 *
 * Persists the `analyzing` status before emitting progress (Requirement 7.2 —
 * idempotent with the extract/classify steps that share it) and validates its
 * output at the boundary (Requirement 23.6).
 */
export async function runDebateStep(
  ctx: ScanWorkflowContext,
  classified: ClassifyClaimsData,
  diffData: ComputeDiffData,
): Promise<DebateData> {
  await setScanStatus(ctx, "analyzing");

  const evidence = buildEvidence(classified, diffData);
  const model = ctx.adapters.model;

  // Run both adversarial agents, capturing their validated output OR the raw
  // output that failed validation so the fallback can be applied (Req 15.7).
  const defense = await runAgent(() => runDefense({ ...evidence, model }));
  const prosecution = await runAgent(() => runProsecutor({ ...evidence, model }));

  if (!defense.ok) {
    addWarning(ctx, `Defense agent output was invalid: ${defense.cause}`);
  }
  if (!prosecution.ok) {
    addWarning(ctx, `Prosecutor agent output was invalid: ${prosecution.cause}`);
  }

  // Hand the validated values (or raw failed outputs) to concludeDebate, which
  // owns the judge call, the insufficient-evidence rule (15.6), and the
  // deterministic fallback substitution (15.7).
  const conclusion = await concludeDebate({
    claims: evidence.claims,
    statuses: evidence.statuses,
    diffs: evidence.diffs,
    defense: defense.ok ? defense.value : defense.raw,
    prosecution: prosecution.ok ? prosecution.value : prosecution.raw,
    model,
  });

  if (conclusion.isFallback && conclusion.failureCause !== null) {
    addWarning(
      ctx,
      `Substituted the deterministic fallback verdict: ${conclusion.failureCause}`,
    );
  }

  return parseAtBoundary(
    DebateDataSchema,
    conclusion,
    "runDebateStep output",
  ) as DebateData;
}

/**
 * Build the {@link DebateEvidence} the agents reason over from the classified
 * claims and computed diffs. `statuses` uses the shared
 * {@link ClaimStatusAssignment} shape (`{ statementText, claimStatus }`), and
 * `diffs` are the canonical {@link Diff} content from each computed diff row.
 */
function buildEvidence(
  classified: ClassifyClaimsData,
  diffData: ComputeDiffData,
): DebateEvidence {
  const claims: Claim[] = classified.classified.map(({ claim }) => ({
    claimType: claim.claimType,
    statementText: claim.statementText,
    evidenceText: claim.evidenceText,
    confidence: claim.confidence,
  }));

  const statuses: ClaimStatusAssignment[] = classified.classified.map(
    ({ claim, status }) => ({
      statementText: claim.statementText,
      claimStatus: status,
    }),
  );

  // A DiffRow extends the canonical Diff, so each computed diff row is a valid
  // Diff for the agents (extra persistence fields are ignored downstream).
  const diffs: Diff[] = diffData.diffs.map((computed) => computed.diff);

  return { claims, statuses, diffs };
}

/**
 * Run a debate agent, returning its validated output on success or, on an
 * {@link AgentValidationError} (or any thrown model error), the raw output to
 * forward into {@link concludeDebate} so the fallback substitution applies.
 */
async function runAgent(run: () => Promise<unknown>): Promise<AgentOutcome> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof AgentValidationError) {
      // Forward the model's raw text — it fails the schema in concludeDebate,
      // triggering the deterministic fallback (Requirement 15.7).
      return { ok: false, raw: error.rawText, cause: errorMessage(error) };
    }
    // A non-validation error (e.g. the model threw / timed out). Forward an
    // invalid sentinel so concludeDebate substitutes the fallback (Req 19.3).
    return { ok: false, raw: null, cause: errorMessage(error) };
  }
}
