import { describe, expect, it } from 'vitest';

import {
  ClaimSchema,
  ClaimStatusEnum,
  ClaimTypeEnum,
  SourceTypeEnum,
  StrategyEnum,
  VerdictSchema,
  type Claim,
  type Verdict,
} from '.';

/**
 * Unit tests for the shared Zod schemas (single source of truth).
 *
 * Validates: Requirements 23.2, 23.3, 16.1
 *
 * Strategy: build a minimal valid object, assert it parses, then mutate a
 * single field per negative case and assert `safeParse` fails. This isolates
 * each bound so a failure points at exactly one rule.
 */

describe('enum membership', () => {
  // Each tuple: [enum, every valid member]. Membership is asserted positively
  // (each member parses) and negatively (a bogus value is rejected).
  it('SourceTypeEnum accepts all members and rejects unknown values', () => {
    const members = [
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
    ] as const;
    for (const member of members) {
      expect(SourceTypeEnum.parse(member)).toBe(member);
    }
    expect(SourceTypeEnum.safeParse('bogus').success).toBe(false);
    expect(SourceTypeEnum.safeParse('').success).toBe(false);
    expect(SourceTypeEnum.safeParse('Pricing').success).toBe(false); // case-sensitive
  });

  it('ClaimTypeEnum accepts all members and rejects unknown values', () => {
    const members = [
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
    ] as const;
    for (const member of members) {
      expect(ClaimTypeEnum.parse(member)).toBe(member);
    }
    expect(ClaimTypeEnum.safeParse('bogus').success).toBe(false);
    expect(ClaimTypeEnum.safeParse('socialproof').success).toBe(false);
  });

  it('ClaimStatusEnum accepts all members and rejects unknown values', () => {
    const members = [
      'new',
      'removed',
      'weakened',
      'contradicted',
      'strengthened',
      'needs_review',
    ] as const;
    for (const member of members) {
      expect(ClaimStatusEnum.parse(member)).toBe(member);
    }
    expect(ClaimStatusEnum.safeParse('bogus').success).toBe(false);
    expect(ClaimStatusEnum.safeParse('needsReview').success).toBe(false);
  });

  it('StrategyEnum accepts all members and rejects unknown values', () => {
    const members = [
      'moving_upmarket',
      'enterprise_readiness',
      'pricing_tightening',
      'security_posture_change',
      'messaging_pivot',
      'self_serve_push',
      'insufficient_evidence',
    ] as const;
    for (const member of members) {
      expect(StrategyEnum.parse(member)).toBe(member);
    }
    expect(StrategyEnum.safeParse('bogus').success).toBe(false);
    expect(StrategyEnum.safeParse('Moving upmarket').success).toBe(false);
  });
});

describe('ClaimSchema bounds (Requirement 13.1)', () => {
  const validClaim: Claim = {
    claimType: 'pricing',
    statementText: 'Pricing moved from self-serve to contact sales.',
    evidenceText: 'Contact our sales team for a custom quote.',
    confidence: 0.5,
  };

  it('accepts a minimal valid claim', () => {
    expect(ClaimSchema.safeParse(validClaim).success).toBe(true);
  });

  it('accepts confidence at the boundaries and midpoint [0, 1]', () => {
    for (const confidence of [0, 0.5, 1]) {
      expect(ClaimSchema.safeParse({ ...validClaim, confidence }).success).toBe(true);
    }
  });

  it('rejects confidence below 0 and above 1', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, confidence: -0.1 }).success).toBe(false);
    expect(ClaimSchema.safeParse({ ...validClaim, confidence: 1.1 }).success).toBe(false);
  });

  it('rejects empty statementText (min 1)', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, statementText: '' }).success).toBe(false);
  });

  it('rejects empty evidenceText (min 1)', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, evidenceText: '' }).success).toBe(false);
  });
});

describe('VerdictSchema bounds (Requirements 15.3, 16.1)', () => {
  const validVerdict: Verdict = {
    strategyPrediction: 'moving_upmarket',
    confidence: 82,
    riskScore: 50,
    recommendedActions: ['Review enterprise pricing exposure'],
    keyEvidence: [],
    counterEvidence: [],
  };

  it('accepts a minimal valid verdict', () => {
    expect(VerdictSchema.safeParse(validVerdict).success).toBe(true);
  });

  it('accepts confidence integers at boundaries and midpoint [0, 100]', () => {
    for (const confidence of [0, 50, 100]) {
      expect(VerdictSchema.safeParse({ ...validVerdict, confidence }).success).toBe(true);
    }
  });

  it('rejects confidence below 0, above 100, and non-integer', () => {
    expect(VerdictSchema.safeParse({ ...validVerdict, confidence: -1 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...validVerdict, confidence: 101 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...validVerdict, confidence: 50.5 }).success).toBe(false);
  });

  it('accepts riskScore integers at boundaries and midpoint [0, 100]', () => {
    for (const riskScore of [0, 50, 100]) {
      expect(VerdictSchema.safeParse({ ...validVerdict, riskScore }).success).toBe(true);
    }
  });

  it('rejects riskScore below 0, above 100, and non-integer', () => {
    expect(VerdictSchema.safeParse({ ...validVerdict, riskScore: -1 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...validVerdict, riskScore: 101 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...validVerdict, riskScore: 50.5 }).success).toBe(false);
  });

  describe('recommendedActions cardinality 1-10', () => {
    const actions = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `action ${i + 1}`);

    it('accepts an array of length 1', () => {
      expect(
        VerdictSchema.safeParse({ ...validVerdict, recommendedActions: actions(1) }).success,
      ).toBe(true);
    });

    it('accepts an array of length 10', () => {
      expect(
        VerdictSchema.safeParse({ ...validVerdict, recommendedActions: actions(10) }).success,
      ).toBe(true);
    });

    it('rejects an empty array (length 0)', () => {
      expect(
        VerdictSchema.safeParse({ ...validVerdict, recommendedActions: actions(0) }).success,
      ).toBe(false);
    });

    it('rejects an array of length 11', () => {
      expect(
        VerdictSchema.safeParse({ ...validVerdict, recommendedActions: actions(11) }).success,
      ).toBe(false);
    });

    it('rejects an array containing an empty-string action', () => {
      expect(
        VerdictSchema.safeParse({
          ...validVerdict,
          recommendedActions: ['valid action', ''],
        }).success,
      ).toBe(false);
    });
  });
});
