import { z } from "zod";

import { classifyClaims } from "@/lib/agents/claim-classifier";
import { ClaimStatusEnum, type Claim, type ClaimStatus } from "@/lib/schemas";
import type { ClaimRow } from "@/lib/adapters/types";

import {
  addWarning,
  errorMessage,
  scopedRepo,
  type ScanWorkflowContext,
} from "../context";
import { parseAtBoundary } from "./artifacts";
import type { ExtractClaimsData } from "./extract-claims";
import type { FindPreviousSnapshotData } from "./find-previous-snapshot";

/**
 * Step 9 — `classifyClaimsStep` (status `analyzing`).
 *
 * Runs the `claimClassifierAgent` over the persisted current claims (carried
 * forward by {@link extractClaimsStep}) and PERSISTS each assigned Claim_Status
 * back onto its claim record via `claims.updateStatus` (Requirement 14.6).
 *
 * ## Prior-snapshot determination (Requirements 14.1, 14.2, 14.3)
 *
 * The classifier needs to know whether a prior snapshot was available and, if
 * so, the prior snapshot's claims to compare against. Both are derived from
 * what the deterministic steps already produced:
 *
 *  - `hasPriorSnapshot` is taken from {@link findPreviousSnapshotStep}'s
 *    `priorScanId`: a non-null prior scan means a prior snapshot exists for at
 *    least one source. When it is null (the company's first scan, so every
 *    source is an initial baseline), the agent deterministically assigns `new`
 *    to every claim WITHOUT consulting the model (Requirement 14.2).
 *  - `priorClaims` are loaded from that prior scan through the workspace-scoped
 *    `claims.listForScan(priorScanId)`. If the prior scan recorded no claims
 *    (or they cannot be loaded), the classifier treats it as "no comparison
 *    basis" and again assigns `new` (Requirement 14.2) — this is the agent's
 *    documented behavior, so a missing prior ledger degrades gracefully rather
 *    than failing.
 *
 * The agent itself defaults any claim it cannot resolve to `needs_review`
 * (Requirement 14.3) and reasons only over the evidence handed to it; this step
 * owns the persistence (Requirement 14.6).
 *
 * ## Degrade, never crash
 *
 * - A failure loading the prior claims is recorded as a warning and treated as
 *   "no prior claims" so classification still proceeds.
 * - A per-claim status-persistence failure records the cause and continues; the
 *   assignment is still carried forward in memory for the debate step.
 *
 * The classified `{ claim, status }` list is carried forward for the debate
 * step, which only needs the `statementText`/`claimStatus` of each.
 *
 * Requirements: 14.6, 14.1, 14.2, 14.3, 7.2, 23.4
 */

/** A persisted claim paired with the status the classifier assigned to it. */
export interface ClassifiedClaimRow {
  claim: ClaimRow;
  status: ClaimStatus;
}

/** Output of {@link classifyClaimsStep}: one classification per current claim. */
export interface ClassifyClaimsData {
  classified: ClassifiedClaimRow[];
}

/** Boundary schema: a status drawn from the enum keyed back to its claim id. */
const ClassifiedClaimRefSchema = z.object({
  claimId: z.string().min(1),
  status: ClaimStatusEnum,
});

const ClassifyClaimsRefSchema = z.object({
  classified: z.array(ClassifiedClaimRefSchema),
});

/**
 * Run {@link classifyClaimsStep} against the shared workflow context.
 *
 * Assumes the `analyzing` status was already persisted by
 * {@link extractClaimsStep} (steps 8–11 share it); re-persisting it is harmless
 * but avoided here. Validates its output shape at the boundary
 * (Requirement 23.6) without discarding the precise {@link ClaimRow} typing.
 */
export async function classifyClaimsStep(
  ctx: ScanWorkflowContext,
  extracted: ExtractClaimsData,
  previous: FindPreviousSnapshotData,
): Promise<ClassifyClaimsData> {
  const repo = scopedRepo(ctx);
  const currentClaims = extracted.claims;

  const hasPriorSnapshot = previous.priorScanId !== null;
  const priorClaims = await loadPriorClaims(ctx, previous.priorScanId);

  const classified = await classifyClaims({
    currentClaims,
    priorClaims,
    hasPriorSnapshot,
    model: ctx.adapters.model,
  });

  // classifyClaims returns one entry per current claim in input order, and we
  // passed the persisted ClaimRows in as `currentClaims`, so each `claim` here
  // is the full ClaimRow carrying its `id`.
  const result: ClassifiedClaimRow[] = [];
  for (const { claim, status } of classified) {
    const row = claim as ClaimRow;
    // Requirement 14.6 — persist the assigned status onto the claim record.
    try {
      const updated = await repo.claims.updateStatus(row.id, status);
      result.push({ claim: updated, status });
    } catch (error) {
      addWarning(
        ctx,
        `Failed to persist status "${status}" for claim ${row.id}: ${errorMessage(error)}. Continuing scan.`,
      );
      // Carry the assignment forward in memory so the debate still sees it.
      result.push({ claim: { ...row, claimStatus: status }, status });
    }
  }

  // Validate a minimal projection at the boundary (Requirement 23.6) while
  // returning the richly-typed rows.
  parseAtBoundary(
    ClassifyClaimsRefSchema,
    { classified: result.map((c) => ({ claimId: c.claim.id, status: c.status })) },
    "classifyClaimsStep output",
  );

  return { classified: result };
}

/**
 * Load the prior scan's claims to compare against, or null when there is no
 * prior scan. A load failure degrades to null (recorded as a warning) so the
 * classifier still runs (treating it as "no prior basis").
 */
async function loadPriorClaims(
  ctx: ScanWorkflowContext,
  priorScanId: string | null,
): Promise<Claim[] | null> {
  if (priorScanId === null) {
    return null;
  }
  try {
    const rows = await scopedRepo(ctx).claims.listForScan(priorScanId);
    return rows.map(toClaim);
  } catch (error) {
    addWarning(
      ctx,
      `Failed to load prior claims from scan ${priorScanId}: ${errorMessage(error)}. Treating as no prior claims.`,
    );
    return null;
  }
}

/** Project a persisted {@link ClaimRow} down to the shared {@link Claim} shape. */
function toClaim(row: ClaimRow): Claim {
  return {
    claimType: row.claimType,
    statementText: row.statementText,
    evidenceText: row.evidenceText,
    confidence: row.confidence,
  };
}
