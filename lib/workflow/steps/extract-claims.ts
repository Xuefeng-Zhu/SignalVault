import { z } from "zod";

import { extractClaims } from "@/lib/agents/claim-extractor";
import { ClaimSchema, ClaimStatusEnum, type Claim } from "@/lib/schemas";
// `import type` for the adapter surface keeps this module free of the
// `server-only` runtime guard, so the step core stays directly unit-testable
// with injected fakes. The step reaches external state ONLY through the
// adapters carried on the shared context (Requirement 23.1).
import type { ClaimRow, NewClaim } from "@/lib/adapters/types";

import {
  addWarning,
  errorMessage,
  scopedRepo,
  setScanStatus,
  type CurrentSnapshot,
  type ScanWorkflowContext,
} from "../context";
import { parseAtBoundary } from "./artifacts";

/**
 * Step 8 — `extractClaimsStep` (status `analyzing`).
 *
 * For every current-scan snapshot (`ctx.currentSnapshots`, set by the normalize
 * step), runs the `claimExtractorAgent` over its normalized content via the
 * injected {@link import('@/lib/adapters/types').ModelClient}, then:
 *
 *  - PERSISTS each extracted {@link Claim} associated with its Snapshot and the
 *    current Scan through the workspace-scoped `claims.create` repository
 *    (Requirement 13.2); and
 *  - serializes the full set of extracted claims into a CLAIM LEDGER artifact
 *    and uploads it to the Box `claims/` subfolder (Requirement 13.4).
 *
 * The persisted {@link ClaimRow}s are carried forward (in extraction order) so
 * `classifyClaimsStep` can assign and persist a Claim_Status onto each record.
 *
 * ## Reasoning + side effects
 *
 * The agent itself reasons only over the normalized content handed to it and
 * performs no side effects beyond the model call (Requirement 13.3); the
 * persistence and Box upload are this deterministic step's responsibility, not
 * the agent's. The optional `sourceType` prompt enrichment is NOT supplied here
 * because `ctx.currentSnapshots` carries only the normalized content and ids
 * (resolving the page role would require an extra read); grounding and
 * validation never depend on it (see `claim-extractor.ts`).
 *
 * ## Degrade, never crash
 *
 * - A per-snapshot extraction or persistence failure records the cause as a
 *   warning and continues with the remaining snapshots; those claims are simply
 *   not carried forward.
 * - An empty extraction for a snapshot is valid and never an error
 *   (Requirement 13.6).
 * - A claim-ledger serialization/upload failure records the cause and leaves
 *   `ledgerFileId` null; the workflow continues.
 *
 * The step core takes the context explicitly and uses only injected adapters,
 * so it carries no `server-only` import and is unit-testable with fakes.
 *
 * Requirements: 13.2, 13.4, 13.3, 7.2, 23.4
 */

/** Output of {@link extractClaimsStep}. */
export interface ExtractClaimsData {
  /** Persisted claim records for the scan, in extraction order (Req 13.2). */
  claims: ClaimRow[];
  /** Box file id of the uploaded claim ledger, or null when it was omitted. */
  ledgerFileId: string | null;
}

/**
 * Boundary schema for a persisted {@link ClaimRow}. Reuses {@link ClaimSchema}
 * for the four base claim fields (Requirement 13.1) and adds the persistence
 * columns; ids are validated as non-empty strings so the test store's
 * human-readable ids pass. Unknown columns pass through untouched.
 */
const ClaimRowSchema = ClaimSchema.extend({
  id: z.string().min(1),
  scanId: z.string().min(1),
  snapshotId: z.string().min(1),
  claimStatus: ClaimStatusEnum.nullable().optional(),
  riskLevel: z.string().nullable().optional(),
  createdAt: z.string().min(1),
}).passthrough();

const ExtractClaimsDataSchema = z.object({
  claims: z.array(ClaimRowSchema),
  ledgerFileId: z.string().min(1).nullable(),
});

/**
 * Run {@link extractClaimsStep} against the shared workflow context.
 *
 * Persists the `analyzing` status before emitting progress (Requirement 7.2),
 * extracts + persists claims per snapshot, uploads the claim ledger to Box
 * `claims/`, and validates its output at the boundary (Requirement 23.6).
 */
export async function extractClaimsStep(
  ctx: ScanWorkflowContext,
): Promise<ExtractClaimsData> {
  // Steps 8–11 map to the `analyzing` status (design step table). Persist
  // before emitting any progress (Requirement 7.2).
  await setScanStatus(ctx, "analyzing");

  const claimsRepo = scopedRepo(ctx).claims;
  const persisted: ClaimRow[] = [];

  for (const snapshot of ctx.currentSnapshots) {
    await extractAndPersistForSnapshot(ctx, snapshot, claimsRepo, persisted);
  }

  // Upload the claim ledger artifact to the Box `claims/` subfolder (Req 13.4).
  const ledgerFileId = await uploadClaimLedger(ctx, persisted);

  return parseAtBoundary(
    ExtractClaimsDataSchema,
    { claims: persisted, ledgerFileId },
    "extractClaimsStep output",
  ) as ExtractClaimsData;
}

/**
 * Extract claims for one snapshot and persist them, appending the persisted
 * rows to `persisted`. All failures are caught so one bad snapshot cannot abort
 * the step (degrade-never-crash).
 */
async function extractAndPersistForSnapshot(
  ctx: ScanWorkflowContext,
  snapshot: CurrentSnapshot,
  claimsRepo: ReturnType<typeof scopedRepo>["claims"],
  persisted: ClaimRow[],
): Promise<void> {
  let claims: Claim[];
  try {
    claims = await extractClaims({
      normalizedContent: snapshot.normalizedContent,
      model: ctx.adapters.model,
    });
  } catch (error) {
    // The agent is contracted not to throw on unparseable output, but guard the
    // model call so an unexpected adapter error degrades to "no claims here".
    addWarning(
      ctx,
      `Failed to extract claims for snapshot ${snapshot.snapshotId}: ${errorMessage(error)}`,
    );
    return;
  }

  // Empty extraction is a valid outcome (Requirement 13.6): nothing to persist.
  if (claims.length === 0) {
    return;
  }

  const newClaims: NewClaim[] = claims.map((claim) => ({
    scanId: ctx.scanId,
    snapshotId: snapshot.snapshotId,
    claimType: claim.claimType,
    statementText: claim.statementText,
    evidenceText: claim.evidenceText,
    confidence: claim.confidence,
    claimStatus: null,
    riskLevel: null,
  }));

  try {
    const rows = await claimsRepo.create(newClaims);
    persisted.push(...rows);
  } catch (error) {
    addWarning(
      ctx,
      `Failed to persist ${claims.length} claim(s) for snapshot ${snapshot.snapshotId}: ${errorMessage(error)}. Continuing scan.`,
    );
  }
}

/**
 * Serialize the extracted claims into a claim-ledger JSON artifact and upload it
 * to the Box `claims/` subfolder (Requirement 13.4). Returns the Box file id, or
 * null when no `claims/` folder is available or the upload fails (recorded as a
 * warning; the workflow continues).
 */
async function uploadClaimLedger(
  ctx: ScanWorkflowContext,
  claims: ClaimRow[],
): Promise<string | null> {
  const claimsFolderId = ctx.boxFolders?.subfolders.claim;
  if (claimsFolderId === undefined) {
    addWarning(
      ctx,
      "No Box claims/ folder available; the claim ledger artifact was omitted.",
    );
    return null;
  }

  const ledger = serializeClaimLedger(ctx, claims);

  try {
    const result = await ctx.adapters.box.upload(
      claimsFolderId,
      "claim",
      `claim-ledger-${ctx.scanId}.json`,
      ledger,
    );
    if (result.simulated) {
      addWarning(ctx, "Claim ledger stored with simulated Box storage.");
    }
    return result.fileId;
  } catch (error) {
    addWarning(
      ctx,
      `Failed to upload the claim ledger; the artifact was omitted: ${errorMessage(error)}`,
    );
    return null;
  }
}

/** Stable two-space JSON encoding of the claim ledger for the Box artifact. */
function serializeClaimLedger(ctx: ScanWorkflowContext, claims: ClaimRow[]): string {
  return JSON.stringify(
    {
      version: 1,
      scanId: ctx.scanId,
      company: ctx.companyName,
      claimCount: claims.length,
      claims: claims.map((claim) => ({
        id: claim.id,
        snapshotId: claim.snapshotId,
        claimType: claim.claimType,
        statementText: claim.statementText,
        evidenceText: claim.evidenceText,
        confidence: claim.confidence,
      })),
    },
    null,
    2,
  );
}
