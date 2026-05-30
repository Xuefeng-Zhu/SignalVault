import { describe, expect, it } from 'vitest';

import { VerdictSchema } from '@/lib/schemas';

import {
  DEMO_CONFIDENCE,
  DEMO_FALLBACK_VERDICT,
  DEMO_STRATEGY_LABEL,
  DEMO_STRATEGY_PREDICTION,
  DEMO_VERDICT,
} from './index';

/**
 * The Demo_Company verdict is deterministic: strategy prediction "Moving
 * upmarket" with a confidence of 82 on a 0–100 scale.
 *
 * Validates: Requirements 18.5
 */
describe('Demo_Company seeded verdict (Requirement 18.5)', () => {
  it('predicts "moving_upmarket" with confidence 82', () => {
    expect(DEMO_VERDICT.strategyPrediction).toBe('moving_upmarket');
    expect(DEMO_VERDICT.confidence).toBe(82);
  });

  it('exposes the human-readable label "Moving upmarket"', () => {
    expect(DEMO_STRATEGY_LABEL).toBe('Moving upmarket');
  });

  it('keeps the strategy/confidence constants aligned with the verdict', () => {
    expect(DEMO_STRATEGY_PREDICTION).toBe('moving_upmarket');
    expect(DEMO_CONFIDENCE).toBe(82);
    expect(DEMO_VERDICT.strategyPrediction).toBe(DEMO_STRATEGY_PREDICTION);
    expect(DEMO_VERDICT.confidence).toBe(DEMO_CONFIDENCE);
  });

  it('mirrors the same conclusion in the deterministic fallback verdict', () => {
    expect(DEMO_FALLBACK_VERDICT.strategyPrediction).toBe('moving_upmarket');
    expect(DEMO_FALLBACK_VERDICT.confidence).toBe(82);
    expect(DEMO_FALLBACK_VERDICT.isFallback).toBe(true);
  });

  it('conforms to VerdictSchema (enum, int 0..100, 1..10 actions)', () => {
    const parsed = VerdictSchema.parse({
      strategyPrediction: DEMO_VERDICT.strategyPrediction,
      confidence: DEMO_VERDICT.confidence,
      riskScore: DEMO_VERDICT.riskScore,
      recommendedActions: DEMO_VERDICT.recommendedActions,
      keyEvidence: DEMO_VERDICT.keyEvidence,
      counterEvidence: DEMO_VERDICT.counterEvidence,
    });

    expect(parsed.strategyPrediction).toBe('moving_upmarket');
    expect(parsed.confidence).toBe(82);
    expect(Number.isInteger(parsed.riskScore)).toBe(true);
    expect(parsed.riskScore).toBeGreaterThanOrEqual(0);
    expect(parsed.riskScore).toBeLessThanOrEqual(100);
    expect(parsed.recommendedActions.length).toBeGreaterThanOrEqual(1);
    expect(parsed.recommendedActions.length).toBeLessThanOrEqual(10);
  });
});
