import type {
  Claim,
  ClaimStatus,
  ClaimType,
  SourceType,
  Strategy,
  Verdict,
} from '@/lib/schemas';

/**
 * Types for the deterministic Demo_Company ("Dropbox") seed.
 *
 * Everything here is plain, serializable data with no behavior. The seed must
 * be reproducible across repeated Demo_Mode scans (Requirement 18.7), so these
 * shapes deliberately avoid timestamps, ids, or any non-deterministic field.
 *
 * Requirements: 18.3, 18.5, 18.6
 */

/**
 * The subset of {@link SourceType} the Demo_Company seeds content for: the
 * pricing, trust/security, docs, and careers Watched_Sources (Requirement 18.3).
 */
export type DemoSourceRole = Extract<
  SourceType,
  'pricing' | 'trust' | 'docs' | 'careers'
>;

/** Which of the two seeded snapshot states a piece of content belongs to. */
export type SnapshotState = 'previous' | 'current';

/** The seeded Demo_Company identity (no workspace/id binding — that is wiring). */
export interface DemoCompany {
  name: string;
  domain: string;
  slug: string;
  isDemo: true;
}

/** A single Watched_Source seeded for the Demo_Company. */
export interface DemoWatchedSource {
  pageRole: DemoSourceRole;
  url: string;
}

/** Normalized content for one Watched_Source within one snapshot state. */
export interface DemoSourceContent {
  pageRole: DemoSourceRole;
  url: string;
  /**
   * Normalized markdown/text content for this source at this snapshot state.
   * Claim `evidenceText` values are exact substrings of this content so the
   * downstream grounding rule (Requirement 13.5) holds for the seed.
   */
  normalizedContent: string;
}

/**
 * One of the Demo_Company's two seeded Snapshots (Requirement 18.3): a
 * previous-state snapshot and a current-state snapshot, each covering all four
 * Watched_Sources.
 */
export interface DemoSnapshot {
  state: SnapshotState;
  sources: DemoSourceContent[];
}

/**
 * A seeded Claim plus the metadata needed to place it in the demo story: its
 * classified {@link ClaimStatus}, the source it came from, and the snapshot
 * state whose normalized content grounds its `evidenceText`.
 *
 * The four base-Claim fields conform to `ClaimSchema` (Requirement 13.1).
 */
export interface DemoClaim {
  claimType: ClaimType;
  statementText: string;
  evidenceText: string;
  confidence: number;
  claimStatus: ClaimStatus;
  pageRole: DemoSourceRole;
  snapshotState: SnapshotState;
}

/**
 * A {@link Verdict} extended with the persistence flag from the `verdicts`
 * table (`is_fallback`). Used to mark the reusable deterministic fallback.
 */
export interface FlaggedVerdict extends Verdict {
  isFallback: boolean;
}

/** A {@link Verdict} explicitly marked as the deterministic fallback. */
export interface FallbackVerdict extends Verdict {
  isFallback: true;
}

/** Re-exported for convenience so demo consumers need a single import. */
export type { Claim, ClaimStatus, ClaimType, SourceType, Strategy, Verdict };
