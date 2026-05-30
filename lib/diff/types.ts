/**
 * Diff domain types for SignalVault snapshot comparison.
 *
 * These mirror the canonical interfaces in the design's "Diff Report
 * Serialization Model" section and the `diffs` table schema (change_score is
 * an integer in [0, 100], where 0 means the prior and current normalized
 * content are identical).
 *
 * Requirements: 11.2
 */

/**
 * A single section whose body changed between the prior and current snapshot,
 * keyed by its markdown heading.
 */
export interface ModifiedSection {
  heading: string;
  before: string;
  after: string;
}

/**
 * The computed content of a diff, independent of which snapshots it compares.
 * This is the pure output of {@link computeDiff}.
 */
export interface DiffContent {
  /** Integer in [0, 100]; 0 iff prior and current content are identical. */
  changeScore: number;
  /** Short human-readable summary of the change. */
  changeSummary: string;
  /** Text present in the current content but not the prior content. */
  addedText: string;
  /** Text present in the prior content but not the current content. */
  removedText: string;
  /** Per-heading sections whose body changed between snapshots. */
  modifiedSections: ModifiedSection[];
}

/**
 * The canonical in-memory Diff used by the DiffViewer. It is a {@link DiffContent}
 * augmented with the references to the snapshots being compared.
 */
export interface Diff extends DiffContent {
  priorSnapshotId: string | null;
  currentSnapshotId: string;
}
