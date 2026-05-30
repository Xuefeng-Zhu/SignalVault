import { VerdictSchema, type Strategy } from '@/lib/schemas';

import { cloneSeed, deepFreeze } from './freeze';
import type { FallbackVerdict, FlaggedVerdict } from './types';

/**
 * The deterministic Verdict for the Demo_Company "Dropbox".
 *
 * Demo_Mode always produces the strategy prediction "AI platform pivot" with a
 * confidence of 85 on a 0–100 scale (Requirements 18.5, 18.6). This module
 * exposes that verdict plus a reusable **deterministic fallback Verdict** that
 * is substituted whenever an agent's Zod validation fails or the model fails
 * (Requirements 15.7, 19.3); per the design the fallback *is* the Demo_Company
 * verdict.
 *
 * Both constants are pure, deep-frozen, and free of randomness/timestamps so
 * Demo_Mode is reproducible across repeated scans (Requirement 18.7).
 *
 * Requirements: 18.5, 18.6, 18.7, 15.7, 19.3
 */

/** Strategy prediction enum value backing the human label "AI platform pivot". */
export const DEMO_STRATEGY_PREDICTION: Strategy = 'moving_upmarket';

/** Human-readable label for the demo verdict's strategy prediction. */
export const DEMO_STRATEGY_LABEL = 'AI platform pivot' as const;

/** Confidence value for the demo verdict on a 0–100 scale (Requirement 18.5). */
export const DEMO_CONFIDENCE = 85 as const;

/**
 * The deterministic Demo_Company Verdict ("AI platform pivot", confidence 85).
 *
 * `keyEvidence` and `counterEvidence` are drawn from the seeded Dropbox story:
 * pricing added Enterprise + AI tiers, security added full compliance stack and
 * DLP, docs launched Dash AI and content intelligence APIs, and careers shifted
 * from file-sync engineering to AI/ML research hiring.
 */
const DEMO_VERDICT_DATA: FlaggedVerdict = {
  strategyPrediction: DEMO_STRATEGY_PREDICTION,
  confidence: DEMO_CONFIDENCE,
  riskScore: 72,
  recommendedActions: [
    'Brief product and competitive teams that Dropbox is pivoting from file-sync to an AI-powered workspace platform.',
    'Evaluate how Dropbox Dash AI universal search competes with Box AI for enterprise content discovery.',
    'Track Dropbox AI/ML hiring (Head of AI Research, ML Engineers) as a leading indicator of platform investment.',
    'Assess competitive exposure in enterprise compliance — Dropbox now matches Box on SOC 2, ISO 27001, and HIPAA.',
    'Re-run a scan in 30 days to confirm the AI pivot is sustained and not a temporary marketing push.',
  ],
  keyEvidence: [
    'Pricing added an Enterprise tier with Dropbox Dash AI, advanced DLP, and contact-sales pricing.',
    'Security page added SOC 2 Type II, ISO 27001, HIPAA, SAML SSO, DLP, and legal holds — full enterprise compliance.',
    'Docs launched Dropbox Dash API for AI-powered universal search and a content intelligence API for ML-powered tagging.',
    'Careers shifted from sync-engine and mobile roles to Senior ML Engineer, Staff AI/ML Platform, and Head of AI Research.',
  ],
  counterEvidence: [
    'Dropbox has announced AI features before (Smart Sync, content suggestions) without fully committing to a platform pivot.',
    'The free/consumer tiers still exist in the pricing structure — the pivot may be additive rather than a full repositioning.',
  ],
  isFallback: false,
};

/**
 * Validate the seed at module load so a malformed edit fails fast rather than
 * silently shipping a non-conformant verdict. `VerdictSchema` ignores the extra
 * `isFallback` field; we assert the four base fields against it.
 */
function assertVerdictShape(verdict: FlaggedVerdict): void {
  VerdictSchema.parse({
    strategyPrediction: verdict.strategyPrediction,
    confidence: verdict.confidence,
    riskScore: verdict.riskScore,
    recommendedActions: verdict.recommendedActions,
    keyEvidence: verdict.keyEvidence,
    counterEvidence: verdict.counterEvidence,
  });
}

assertVerdictShape(DEMO_VERDICT_DATA);

/**
 * The deterministic Demo_Company Verdict ("AI platform pivot", confidence 85),
 * deep-frozen for a stable reference (Requirements 18.5, 18.6).
 */
export const DEMO_VERDICT: FlaggedVerdict = deepFreeze(DEMO_VERDICT_DATA);

/**
 * The reusable deterministic fallback Verdict for the Demo_Company. It is the
 * Demo_Company verdict (same "AI platform pivot" / 85 conclusion) with
 * `isFallback` set true, substituted when an agent's Zod validation fails or
 * the model fails (Requirements 15.7, 19.3). Deep-frozen, stable reference.
 */
export const DEMO_FALLBACK_VERDICT: FallbackVerdict = deepFreeze({
  ...DEMO_VERDICT_DATA,
  isFallback: true,
});

/** Build a fresh, mutable copy of the deterministic Demo_Company verdict. */
export function buildDemoVerdict(): FlaggedVerdict {
  return cloneSeed(DEMO_VERDICT_DATA);
}

/** Build a fresh, mutable copy of the deterministic fallback verdict. */
export function buildDemoFallbackVerdict(): FallbackVerdict {
  return { ...cloneSeed(DEMO_VERDICT_DATA), isFallback: true };
}
