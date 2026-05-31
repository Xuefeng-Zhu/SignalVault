import { z } from "zod";

import { ClaimStatusEnum, type Claim, type ClaimStatus } from "@/lib/schemas";
import type { InferenceRequest, ModelClient } from "@/lib/adapters/types";

/**
 * claimClassifierAgent — assigns each Claim exactly one {@link ClaimStatus}.
 *
 * Reasons ONLY over persisted evidence handed to it (the current Claims plus
 * the prior-Snapshot Claims) and performs no external side effects beyond the
 * injected {@link ModelClient} (Requirements 13.3, 15.5, 23.7). The module is
 * intentionally NOT `server-only`: the core stays importable from unit and
 * property tests, which inject a stub {@link ModelClient}. The client
 * selection happens in the workflow step (task 18.6), not here.
 *
 * Contract (Requirement 14):
 *  - Every input Claim is paired with exactly one valid `Claim_Status` drawn
 *    from `ClaimStatusEnum` (new, removed, weakened, contradicted, strengthened,
 *    needs_review) — output length equals input length, in input order (14.1).
 *  - When no prior Snapshot is available for comparison, every Claim is `new`
 *    WITHOUT consulting the model — this is deterministic (14.2).
 *  - When the classifier cannot determine a valid status for a Claim (the model
 *    output is unparseable, omits that Claim, or yields a status outside the
 *    enum), that Claim is `needs_review` (14.3).
 */

/** Hard ceiling for any inference request, in milliseconds (Requirement 24.4). */
const CLASSIFY_TIMEOUT_MS = 60_000;

/**
 * `responseSchemaName` passed to the {@link ModelClient}. It deliberately
 * contains both "status" and "classification" so the inference router maps
 * it to the deterministic claim-status payload, and so the live client
 * traces it under a descriptive name.
 */
export const CLAIM_STATUS_SCHEMA_NAME = "ClaimStatusClassification";

/** The status assigned when the model gives no usable answer for a Claim. */
export const UNDETERMINED_STATUS: ClaimStatus = "needs_review";

/** The status assigned to every Claim when there is no prior Snapshot. */
export const NO_PRIOR_STATUS: ClaimStatus = "new";

/**
 * One model-classified status, keyed back to the Claim it describes by
 * `statementText`. A single malformed entry never invalidates the others: each
 * element is validated independently and unusable entries are dropped, leaving
 * their Claims to fall through to `needs_review` (14.3).
 */
const ClassifiedStatusSchema = z.object({
  statementText: z.string().min(1),
  claimStatus: ClaimStatusEnum,
});

/** A Claim paired with the single status the classifier assigned to it. */
export interface ClassifiedClaim {
  claim: Claim;
  status: ClaimStatus;
}

export interface ClassifyClaimsInput {
  /** Claims extracted from the current Snapshot's normalized content. */
  currentClaims: Claim[];
  /** Claims from the prior Snapshot, or null when none was found. */
  priorClaims: Claim[] | null;
  /**
   * Whether a prior Snapshot was available for comparison. When false, every
   * Claim is `new` deterministically (14.2); see {@link hasComparisonBasis}.
   */
  hasPriorSnapshot: boolean;
  /** Injected model adapter. */
  model: ModelClient;
}

/**
 * Whether there is a real basis for comparison. A prior Snapshot only enables
 * classification if it actually carried Claims to compare against; a flagged
 * but empty prior set is treated as "no prior" so every current Claim is `new`
 * (14.2).
 */
function hasComparisonBasis(input: ClassifyClaimsInput): boolean {
  return (
    input.hasPriorSnapshot &&
    Array.isArray(input.priorClaims) &&
    input.priorClaims.length > 0
  );
}

/**
 * Build a `statementText -> ClaimStatus` lookup from raw model text. Returns an
 * empty map when the text is not a JSON array; individual malformed entries are
 * skipped so one bad row cannot strip valid statuses from sibling Claims.
 */
function parseStatusMap(text: string): Map<string, ClaimStatus> {
  const statuses = new Map<string, ClaimStatus>();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return statuses; // Unparseable output → every Claim falls back (14.3).
  }

  if (!Array.isArray(parsed)) {
    return statuses;
  }

  for (const entry of parsed) {
    const result = ClassifiedStatusSchema.safeParse(entry);
    if (result.success) {
      statuses.set(result.data.statementText, result.data.claimStatus);
    }
  }

  return statuses;
}

/** Compose the inference request for the classification step. */
function buildRequest(input: ClassifyClaimsInput): InferenceRequest {
  const payload = {
    currentClaims: input.currentClaims,
    priorClaims: input.priorClaims ?? [],
  };

  return {
    system:
      "You are SignalVault's claim change classifier. Compare each current " +
      "public claim against the prior snapshot's claims and assign exactly one " +
      "status from: new, removed, weakened, contradicted, strengthened, " +
      "needs_review. Reason only over the evidence provided. Respond with a " +
      "JSON array where each element is { statementText, claimStatus } and " +
      "statementText matches a current claim exactly.",
    messages: [{ role: "user", content: JSON.stringify(payload) }],
    responseSchemaName: CLAIM_STATUS_SCHEMA_NAME,
    timeoutMs: CLASSIFY_TIMEOUT_MS,
  };
}

/**
 * Assign each current Claim exactly one {@link ClaimStatus} (Requirement 14).
 *
 * The returned array has the same length and order as `currentClaims`, so every
 * Claim is paired with precisely one valid status (14.1). When there is no prior
 * Snapshot to compare against, the model is not consulted and every Claim is
 * `new` (14.2). Otherwise the model is asked to classify, and any Claim the
 * model leaves unresolved or classifies with an out-of-enum value defaults to
 * `needs_review` (14.3).
 */
export async function classifyClaims(
  input: ClassifyClaimsInput,
): Promise<ClassifiedClaim[]> {
  // Empty input → empty output; the "exactly one status per Claim" invariant
  // holds vacuously and there is nothing for the model to classify.
  if (input.currentClaims.length === 0) {
    return [];
  }

  // 14.2 — no prior Snapshot (or none with comparable Claims): deterministically
  // assign `new` to every Claim without touching the model.
  if (!hasComparisonBasis(input)) {
    return input.currentClaims.map((claim) => ({
      claim,
      status: NO_PRIOR_STATUS,
    }));
  }

  // 14.1/14.3 — ask the model, then map each Claim to a validated status,
  // defaulting to `needs_review` when the model gives nothing usable.
  let statusMap: Map<string, ClaimStatus>;
  try {
    const { text } = await input.model.complete(buildRequest(input));
    statusMap = parseStatusMap(text);
  } catch {
    // A model failure must not crash the step: every Claim falls back (14.3).
    statusMap = new Map<string, ClaimStatus>();
  }

  return input.currentClaims.map((claim) => ({
    claim,
    status: statusMap.get(claim.statementText) ?? UNDETERMINED_STATUS,
  }));
}
