import { z } from "zod";

import { SourceTypeEnum } from "@/lib/schemas";

/**
 * Boundary schemas + inferred types for the evidence artifacts that flow
 * through the capture → normalize → upload steps of `signalVaultScanWorkflow`
 * (steps 3–5, tasks 18.2).
 *
 * Every step validates its input and output against these Zod schemas before
 * consuming or returning data (Requirements 23.5, 23.6). The schemas are the
 * single source of truth for the inter-step payloads; the TypeScript types are
 * inferred from them so the two never drift.
 *
 * This module is pure (no `server-only`, no I/O), so it — and the step cores
 * that depend on it — can be unit/property-tested directly. The artifact-id
 * persistence round-trip property (task 18.3) relies on that.
 */

/** Hard cap on a single capture's timeout: 60 seconds (Requirement 8.1). */
export const CAPTURE_TIMEOUT_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Capture plan (produced by planWatchTargetsStep, task 18.1)                 */
/* -------------------------------------------------------------------------- */

/**
 * A validated capture request. Mirrors the adapter `CaptureRequest` but is
 * defined here as a Zod schema so the workflow boundary can validate it. The
 * timeout is capped at {@link CAPTURE_TIMEOUT_MS} (Requirement 8.1).
 */
export const CaptureRequestSchema = z.object({
  url: z.string().url(),
  pageRole: SourceTypeEnum,
  timeoutMs: z.number().int().positive().max(CAPTURE_TIMEOUT_MS),
});

/**
 * One unit of work in the capture plan: a validated capture request plus the id
 * of the Watched_Source it targets, so the created Snapshot can be associated
 * with the correct source (Requirement 8.5).
 */
export const PlannedCaptureSchema = z.object({
  watchedSourceId: z.string().min(1),
  request: CaptureRequestSchema,
});

export const CapturePlanSchema = z.array(PlannedCaptureSchema);

/* -------------------------------------------------------------------------- */
/* Captured snapshot (output of runApifyCaptureStep)                          */
/* -------------------------------------------------------------------------- */

/**
 * A successfully captured snapshot: the created Snapshot record id, the source
 * it belongs to, and the raw evidence carried forward to normalization/upload.
 */
export const CapturedSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  watchedSourceId: z.string().min(1),
  url: z.string().url(),
  pageRole: SourceTypeEnum,
  rawHtml: z.string(),
  screenshotRef: z.string().optional(),
  simulated: z.boolean(),
});

export const CapturedSnapshotsSchema = z.array(CapturedSnapshotSchema);

/* -------------------------------------------------------------------------- */
/* Normalized snapshot (output of normalizeArtifactsStep)                     */
/* -------------------------------------------------------------------------- */

/**
 * A captured snapshot after normalization: carries the normalized content and
 * the two deterministic hashes (Requirement 9.1, 9.4). `fallbackUsed` records
 * whether the raw text was substituted because normalization failed/was empty
 * (Requirement 9.5).
 */
export const NormalizedSnapshotSchema = CapturedSnapshotSchema.extend({
  normalizedContent: z.string(),
  contentHash: z.string().min(1),
  normalizedTextHash: z.string().min(1),
  fallbackUsed: z.boolean(),
});

export const NormalizedSnapshotsSchema = z.array(NormalizedSnapshotSchema);

/* -------------------------------------------------------------------------- */
/* Uploaded snapshot (output of uploadSnapshotToBoxStep)                       */
/* -------------------------------------------------------------------------- */

/**
 * The Box identifiers persisted for a single uploaded artifact. Both `url` and
 * `key` are retained per the InsForge storage convention, alongside the Box
 * `fileId` and parent `folderId` (Requirement 10.3).
 */
export const ArtifactIdentifiersSchema = z.object({
  fileId: z.string(),
  folderId: z.string(),
  url: z.string(),
  key: z.string(),
});

/**
 * A snapshot after its raw/normalized/screenshot artifacts have been uploaded
 * to Box and their identifiers persisted. Any artifact whose upload or
 * persistence could not complete is left undefined (the workflow continues —
 * Requirements 10.4, and "never throw on a per-source failure").
 */
export const UploadedSnapshotSchema = NormalizedSnapshotSchema.extend({
  raw: ArtifactIdentifiersSchema.optional(),
  normalized: ArtifactIdentifiersSchema.optional(),
  screenshot: ArtifactIdentifiersSchema.optional(),
});

export const UploadedSnapshotsSchema = z.array(UploadedSnapshotSchema);

/**
 * The Box folder tree for the scan. Mirrors the adapter `BoxFolderSet` so the
 * upload step's output can be validated and the folder ids reused by the diff
 * step (task 18.4) for the `diffs/` upload.
 */
export const BoxFolderSetSchema = z.object({
  scanFolderId: z.string(),
  subfolders: z.object({
    raw: z.string(),
    normalized: z.string(),
    screenshots: z.string(),
    diff: z.string(),
    claim: z.string(),
    report: z.string(),
  }),
  simulated: z.boolean(),
});

/** Full output of `uploadSnapshotToBoxStep`: the folder set + uploaded snapshots. */
export const UploadSnapshotsResultSchema = z.object({
  folderSet: BoxFolderSetSchema,
  snapshots: UploadedSnapshotsSchema,
});

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type PlannedCapture = z.infer<typeof PlannedCaptureSchema>;
export type CapturePlan = z.infer<typeof CapturePlanSchema>;
export type CapturedSnapshot = z.infer<typeof CapturedSnapshotSchema>;
export type NormalizedSnapshot = z.infer<typeof NormalizedSnapshotSchema>;
export type ArtifactIdentifiers = z.infer<typeof ArtifactIdentifiersSchema>;
export type UploadedSnapshot = z.infer<typeof UploadedSnapshotSchema>;
export type UploadSnapshotsResult = z.infer<typeof UploadSnapshotsResultSchema>;

/* -------------------------------------------------------------------------- */
/* Boundary validation helper                                                 */
/* -------------------------------------------------------------------------- */

/** Thrown when a step's input or output fails Zod validation at the boundary. */
export class StepBoundaryError extends Error {
  constructor(
    /** Which boundary failed, e.g. `"runApifyCaptureStep input"`. */
    readonly boundary: string,
    /** The dotted path of the first failing field, e.g. `"0.request.url"`. */
    readonly fieldPath: string,
    message: string,
  ) {
    super(message);
    this.name = "StepBoundaryError";
  }
}

/**
 * Validate a value at a step boundary, returning the parsed value on success.
 * On failure it throws a {@link StepBoundaryError} that surfaces which field
 * failed (Requirements 23.5, 23.6) — halting the step before it consumes or
 * emits invalid data. This is intentionally distinct from per-source runtime
 * failures, which are accumulated as warnings/skips rather than thrown.
 */
export function parseAtBoundary<T>(
  schema: z.ZodType<T>,
  value: unknown,
  boundary: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  const fieldPath = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
  const reason = issue ? issue.message : "invalid value";
  throw new StepBoundaryError(
    boundary,
    fieldPath,
    `${boundary} validation failed at "${fieldPath}": ${reason}`,
  );
}
