import { z } from 'zod';

import type { Diff, ModifiedSection } from './types';

/**
 * Diff report serialization for SignalVault (Requirement 12).
 *
 * A computed {@link Diff} is serialized into a {@link DiffReportArtifact} (a
 * versioned JSON document stored in Box and referenced from the database) and
 * later deserialized back into a {@link Diff} for the DiffViewer.
 *
 * The serialize -> deserialize cycle is a round-trip: the recovered Diff
 * references the same prior/current snapshots, carries the same set of detected
 * changes, and renders identically via {@link renderDiffForViewer}. Equivalence
 * is defined on those canonical fields and the rendered viewer output, NOT on
 * byte-identical JSON.
 *
 * Requirements: 12.1, 12.2
 */

/** Current diff report artifact schema version. */
export const DIFF_REPORT_VERSION = 1 as const;

/**
 * The serialized form of a {@link Diff}, stored as JSON in the Box `diffs/`
 * subfolder and referenced from the `diffs` table. `version` pins the schema so
 * future formats can be migrated; `priorSnapshotId` is null for an initial
 * baseline that has no prior snapshot.
 */
export interface DiffReportArtifact {
  version: 1;
  priorSnapshotId: string | null;
  currentSnapshotId: string;
  changeScore: number;
  changeSummary: string;
  addedText: string;
  removedText: string;
  modifiedSections: ModifiedSection[];
}

/** Zod schema for a single modified section. */
const ModifiedSectionSchema: z.ZodType<ModifiedSection> = z.object({
  heading: z.string(),
  before: z.string(),
  after: z.string(),
});

/**
 * Zod schema validating a parsed diff report artifact. The version must be
 * exactly 1, `changeScore` must be an integer in [0, 100], and every other
 * field must be present and correctly typed. `.strict()` rejects unknown keys
 * so malformed payloads do not silently round-trip extra data.
 */
const DiffReportArtifactSchema: z.ZodType<DiffReportArtifact> = z
  .object({
    version: z.literal(DIFF_REPORT_VERSION),
    priorSnapshotId: z.string().nullable(),
    currentSnapshotId: z.string(),
    changeScore: z.number().int().min(0).max(100),
    changeSummary: z.string(),
    addedText: z.string(),
    removedText: z.string(),
    modifiedSections: z.array(ModifiedSectionSchema),
  })
  .strict();

/**
 * Serialize a computed {@link Diff} into a diff report artifact JSON string.
 *
 * The result captures the compared prior snapshot reference, the current
 * snapshot reference, and all detected change content (score, summary, added
 * and removed text, and per-heading modified sections).
 *
 * Requirements: 12.1
 */
export function serializeDiff(d: Diff): string {
  const artifact: DiffReportArtifact = {
    version: DIFF_REPORT_VERSION,
    priorSnapshotId: d.priorSnapshotId,
    currentSnapshotId: d.currentSnapshotId,
    changeScore: d.changeScore,
    changeSummary: d.changeSummary,
    addedText: d.addedText,
    removedText: d.removedText,
    modifiedSections: d.modifiedSections.map((section) => ({
      heading: section.heading,
      before: section.before,
      after: section.after,
    })),
  };
  return JSON.stringify(artifact);
}

/**
 * Deserialize a diff report artifact JSON string back into a {@link Diff}.
 *
 * Throws a clear {@link Error} when the input is missing or malformed: not a
 * string, not valid JSON, or failing structural validation (wrong version,
 * missing fields, wrong types, or out-of-range `changeScore`). Requirement 12.4
 * relies on this throwing so callers can surface a "diff report could not be
 * loaded" error.
 *
 * Requirements: 12.2
 */
export function deserializeDiff(s: string): Diff {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error('Cannot deserialize diff report: input is missing or empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (cause) {
    throw new Error('Cannot deserialize diff report: input is not valid JSON.', { cause });
  }

  const result = DiffReportArtifactSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Cannot deserialize diff report: artifact is malformed. ${result.error.message}`,
      { cause: result.error },
    );
  }

  const artifact = result.data;
  return {
    priorSnapshotId: artifact.priorSnapshotId,
    currentSnapshotId: artifact.currentSnapshotId,
    changeScore: artifact.changeScore,
    changeSummary: artifact.changeSummary,
    addedText: artifact.addedText,
    removedText: artifact.removedText,
    modifiedSections: artifact.modifiedSections.map((section) => ({
      heading: section.heading,
      before: section.before,
      after: section.after,
    })),
  };
}

/**
 * Deterministically render the content the DiffViewer displays for a
 * {@link Diff}: the change summary, the added and removed text, and each
 * modified section (heading, before, after) in order.
 *
 * This pure function DEFINES viewer equivalence for the round-trip property
 * (task 12.4): two Diffs render identical strings iff the DiffViewer would
 * present the same change content. It depends only on the Diff's canonical
 * fields and never on snapshot ids, so it isolates the "renders identically"
 * clause of Requirement 12.3 from the snapshot-reference clause.
 *
 * Requirements: 12.2
 */
export function renderDiffForViewer(d: Diff): string {
  const sections = d.modifiedSections
    .map(
      (section, index) =>
        [
          `[section ${index}]`,
          `heading: ${section.heading}`,
          `before: ${section.before}`,
          `after: ${section.after}`,
        ].join('\n'),
    )
    .join('\n---\n');

  return [
    `changeSummary: ${d.changeSummary}`,
    `addedText:\n${d.addedText}`,
    `removedText:\n${d.removedText}`,
    `modifiedSections (${d.modifiedSections.length}):\n${sections}`,
  ].join('\n\n');
}
