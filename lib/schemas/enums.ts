import { z } from 'zod';

/**
 * Shared enums — the single source of truth for SignalVault's domain
 * vocabularies. These mirror the CHECK constraints in the InsForge Postgres
 * schema and are reused across the workflow, agents, and API layers.
 *
 * Requirements: 23.2, 23.3, 13.1, 15.3, 16.1
 */

/** Type of public page a Watched_Source points at. */
export const SourceTypeEnum = z.enum([
  'homepage',
  'pricing',
  'docs',
  'changelog',
  'trust',
  'careers',
  'terms',
  'privacy',
  'status',
  'blog',
]);

/** Category a public claim falls into. */
export const ClaimTypeEnum = z.enum([
  'pricing',
  'packaging',
  'security',
  'compliance',
  'feature',
  'integration',
  'social_proof',
  'hiring',
  'terms',
  'positioning',
]);

/** How a claim changed relative to the prior snapshot. */
export const ClaimStatusEnum = z.enum([
  'new',
  'removed',
  'weakened',
  'contradicted',
  'strengthened',
  'needs_review',
]);

/** Strategy prediction produced by the judge agent. */
export const StrategyEnum = z.enum([
  'moving_upmarket',
  'enterprise_readiness',
  'pricing_tightening',
  'security_posture_change',
  'messaging_pivot',
  'self_serve_push',
  'insufficient_evidence',
]);

export type SourceType = z.infer<typeof SourceTypeEnum>;
export type ClaimType = z.infer<typeof ClaimTypeEnum>;
export type ClaimStatus = z.infer<typeof ClaimStatusEnum>;
export type Strategy = z.infer<typeof StrategyEnum>;
