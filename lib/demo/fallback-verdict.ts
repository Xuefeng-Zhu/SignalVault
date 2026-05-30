import { VerdictSchema, type Strategy } from '@/lib/schemas';

import { cloneSeed, deepFreeze } from './freeze';
import type { FallbackVerdict, FlaggedVerdict } from './types';

/**
 * The deterministic Verdict for the Demo_Company "Acme AI".
 *
 * Demo_Mode always produces the strategy prediction "Moving upmarket" with a
 * confidence of 82 on a 0–100 scale (Requirements 18.5, 18.6). This module
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

/** Strategy prediction enum value backing the human label "Moving upmarket". */
export const DEMO_STRATEGY_PREDICTION: Strategy = 'moving_upmarket';

/** Human-readable label for the demo verdict's strategy prediction. */
export const DEMO_STRATEGY_LABEL = 'Moving upmarket' as const;

/** Confidence value for the demo verdict on a 0–100 scale (Requirement 18.5). */
export const DEMO_CONFIDENCE = 82 as const;

/**
 * The deterministic Demo_Company Verdict ("Moving upmarket", confidence 82).
 *
 * `keyEvidence` and `counterEvidence` are drawn from the seeded Acme AI story:
 * pricing moved to contact-sales, enterprise security & compliance were added,
 * admin controls landed in the docs, and enterprise GTM hiring opened — with
 * the prosecution noting some changes could be a copy refresh.
 */
const DEMO_VERDICT_DATA: FlaggedVerdict = {
  strategyPrediction: DEMO_STRATEGY_PREDICTION,
  confidence: DEMO_CONFIDENCE,
  riskScore: 64,
  recommendedActions: [
    'Brief sales and competitive teams that Acme AI is repositioning upmarket toward enterprise buyers.',
    'Reassess pricing exposure now that the free, self-serve tier has been replaced with contact-sales plans.',
    'Track the new SOC 2 Type II and HIPAA posture when evaluating Acme AI for regulated workloads.',
    'Monitor enterprise hiring (Account Executive, Solutions Engineer, Head of Security & Compliance) as a leading indicator of GTM intent.',
    'Re-run a scan in 30 days to confirm the upmarket shift is sustained rather than a one-off copy refresh.',
  ],
  keyEvidence: [
    'Pricing replaced the free self-serve tier with contact-sales and a quote-based Enterprise plan.',
    'Trust center added SOC 2 Type II, HIPAA, SAML SSO, SCIM, audit logs, and US/EU data residency.',
    'Docs added admin controls, SSO/SAML setup, and role-based access control.',
    'Careers opened Enterprise Account Executive, Solutions Engineer, and Head of Security & Compliance roles.',
  ],
  counterEvidence: [
    'Some security language (encryption in transit) was already present and may have only been re-emphasized.',
    'A pricing-page copy refresh alone cannot confirm a durable strategy shift without follow-up scans.',
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
 * The deterministic Demo_Company Verdict ("Moving upmarket", confidence 82),
 * deep-frozen for a stable reference (Requirements 18.5, 18.6).
 */
export const DEMO_VERDICT: FlaggedVerdict = deepFreeze(DEMO_VERDICT_DATA);

/**
 * The reusable deterministic fallback Verdict for the Demo_Company. It is the
 * Demo_Company verdict (same "Moving upmarket" / 82 conclusion) with
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
