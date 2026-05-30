/**
 * Barrel for the deterministic Demo_Company ("Dropbox") seed.
 *
 * Demo_Mode uses these seeded snapshots, claims, and verdict instead of calling
 * external services, and the same data is reproducible across repeated scans
 * (Requirement 18.7). Everything exported here is pure and deterministic.
 *
 * Requirements: 18.3, 18.5, 18.6, 18.7, 15.7, 19.3
 */

export type {
  DemoSourceRole,
  SnapshotState,
  DemoCompany,
  DemoWatchedSource,
  DemoSourceContent,
  DemoSnapshot,
  DemoClaim,
  FlaggedVerdict,
  FallbackVerdict,
} from './types';

export {
  ACME_DEMO_COMPANY,
  ACME_WATCHED_SOURCES,
  acmeSnapshots,
  acmeClaims,
  buildAcmeCompany,
  buildAcmeWatchedSources,
  buildAcmeSnapshots,
  buildAcmeClaims,
  buildAcmeClaimRecords,
  toClaim,
} from './acme';

export {
  DEMO_STRATEGY_PREDICTION,
  DEMO_STRATEGY_LABEL,
  DEMO_CONFIDENCE,
  DEMO_VERDICT,
  DEMO_FALLBACK_VERDICT,
  buildDemoVerdict,
  buildDemoFallbackVerdict,
} from './fallback-verdict';
