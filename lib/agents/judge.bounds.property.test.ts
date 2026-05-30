// Feature: signalvault, Property 21: Judge verdict satisfies all bounds and cardinality
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ClaimStatusEnum,
  ClaimTypeEnum,
  StrategyEnum,
  VerdictSchema,
  type Claim,
  type Strategy,
  type Verdict,
} from '@/lib/schemas';
import type { Diff } from '@/lib/diff';
// `import type` keeps the `server-only` runtime guard out of this test (the
// judge module already mirrors this split); the fake ModelClient below
// satisfies the structural interface with no real adapter construction.
import type { ModelClient } from '@/lib/adapters/types';

import {
  concludeDebate,
  runJudge,
  JudgeOutputError,
  type DebateInput,
} from './judge';
import type { ClaimStatusAssignment } from './debate';

import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

/**
 * Property 21 (Validates: Requirements 15.3, 16.1):
 * For any debate inputs, the Verdict the system concludes ALWAYS satisfies
 * VerdictSchema's bounds and cardinality — `strategyPrediction` is one of the
 * defined StrategyEnum values, `confidence` and `riskScore` are integers in
 * [0, 100], `recommendedActions` holds between 1 and 10 non-empty strings, and
 * `keyEvidence` / `counterEvidence` are string arrays.
 *
 * The always-valid guarantee lives in {@link concludeDebate}: it applies the
 * deterministic insufficient-evidence short-circuit (15.6) and substitutes the
 * deterministic Demo_Company fallback verdict on any defense/prosecution/judge
 * Zod failure or model error (15.7). So we drive it adversarially — with
 * evidence that is sometimes empty, defense/prosecution inputs that are
 * sometimes structurally invalid, and a fake ModelClient whose output ranges
 * over valid verdicts, bound-violating verdicts, non-JSON, and thrown errors —
 * and assert the concluded verdict is schema-valid every time and never throws.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/** The defined strategy vocabulary, as a plain array for `constantFrom`. */
const STRATEGIES: Strategy[] = [...StrategyEnum.options];

/** A schema-conformant Claim (claims flow through to the judge prompt). */
const claimArb: fc.Arbitrary<Claim> = fc.record({
  claimType: fc.constantFrom(...ClaimTypeEnum.options),
  statementText: fc.string({ minLength: 1 }),
  evidenceText: fc.string({ minLength: 1 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** A single Claim_Status assignment (drives the 15.6 short-circuit). */
const claimStatusArb: fc.Arbitrary<ClaimStatusAssignment> = fc.record({
  statementText: fc.string({ minLength: 1 }),
  claimStatus: fc.constantFrom(...ClaimStatusEnum.options),
});

/** A computed Diff (drives the 15.6 short-circuit and feeds the judge prompt). */
const diffArb: fc.Arbitrary<Diff> = fc.record({
  changeScore: fc.integer({ min: 0, max: 100 }),
  changeSummary: fc.string(),
  addedText: fc.string(),
  removedText: fc.string(),
  modifiedSections: fc.array(
    fc.record({ heading: fc.string(), before: fc.string(), after: fc.string() }),
    { maxLength: 3 },
  ),
  priorSnapshotId: fc.option(fc.string(), { nil: null }),
  currentSnapshotId: fc.string(),
});

/**
 * The collected evidence. Arrays may be empty (exercising the
 * insufficient-evidence rule 15.6) or non-empty (exercising the judge / fallback
 * path), so the short-circuit does not trivially dominate the runs.
 */
const evidenceArb = fc.record({
  claims: fc.array(claimArb, { maxLength: 4 }),
  statuses: fc.array(claimStatusArb, { maxLength: 4 }),
  diffs: fc.array(diffArb, { maxLength: 3 }),
});

/** A schema-valid defense agent output. */
const validDefenseArb = fc.record({
  argument: fc.string({ minLength: 1 }),
  keyEvidence: fc.array(fc.string()),
});

/** A schema-valid prosecution agent output. */
const validProsecutionArb = fc.record({
  argument: fc.string({ minLength: 1 }),
  counterEvidence: fc.array(fc.string()),
});

/**
 * Structurally invalid agent output (drives the 15.7 fallback substitution):
 * wrong primitive types, a missing `argument`, an empty `argument` (violates
 * `min(1)`), or a wrong-typed `argument`.
 */
const junkArgumentArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.record({ keyEvidence: fc.array(fc.string()) }),
  fc.record({ argument: fc.constant(''), keyEvidence: fc.array(fc.string()) }),
  fc.record({ argument: fc.integer() }),
);

/** Defense input to `concludeDebate` (`unknown`): valid or junk. */
const defenseInputArb: fc.Arbitrary<unknown> = fc.oneof(
  validDefenseArb,
  junkArgumentArb,
);

/** Prosecution input to `concludeDebate` (`unknown`): valid or junk. */
const prosecutionInputArb: fc.Arbitrary<unknown> = fc.oneof(
  validProsecutionArb,
  junkArgumentArb,
);

/** A schema-valid Verdict (the "good" model output). */
const validVerdictArb: fc.Arbitrary<Verdict> = fc.record({
  strategyPrediction: fc.constantFrom(...STRATEGIES),
  confidence: fc.integer({ min: 0, max: 100 }),
  riskScore: fc.integer({ min: 0, max: 100 }),
  recommendedActions: fc.array(fc.string({ minLength: 1 }), {
    minLength: 1,
    maxLength: 10,
  }),
  keyEvidence: fc.array(fc.string()),
  counterEvidence: fc.array(fc.string()),
});

/**
 * A Verdict-shaped object that violates exactly one VerdictSchema bound or
 * cardinality rule: confidence above 100, riskScore below 0, a non-integer
 * confidence, zero actions, eleven actions, an empty action string, or a
 * strategy outside the enum. Each makes `runJudge` throw `JudgeOutputError`,
 * which `concludeDebate` converts into the deterministic fallback.
 */
const invalidVerdictArb: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  validVerdictArb.map((v): Record<string, unknown> => ({ ...v, confidence: 200 })),
  validVerdictArb.map((v): Record<string, unknown> => ({ ...v, riskScore: -5 })),
  validVerdictArb.map((v): Record<string, unknown> => ({ ...v, confidence: 50.5 })),
  validVerdictArb.map((v): Record<string, unknown> => ({ ...v, recommendedActions: [] })),
  validVerdictArb.map(
    (v): Record<string, unknown> => ({ ...v, recommendedActions: Array(11).fill('a') }),
  ),
  validVerdictArb.map((v): Record<string, unknown> => ({ ...v, recommendedActions: [''] })),
  validVerdictArb.map(
    (v): Record<string, unknown> => ({ ...v, strategyPrediction: 'not_a_strategy' }),
  ),
);

/** Model text that always fails to parse into a schema-valid Verdict. */
const invalidModelTextArb: fc.Arbitrary<string> = fc.oneof(
  invalidVerdictArb.map((v) => JSON.stringify(v)),
  fc.constant('not json at all'),
  fc.string().map((s) => `<<${s}`),
);

/** How the fake ModelClient behaves on `complete`. */
interface ModelBehavior {
  throws: boolean;
  text: string;
  message: string;
}

/**
 * The adversarial model-output space: valid verdict JSON, bound-violating
 * verdict JSON, non-JSON text, and a thrown error (network/timeout/uncredentialed
 * per 19.3).
 */
const modelBehaviorArb: fc.Arbitrary<ModelBehavior> = fc.oneof(
  validVerdictArb.map((v) => ({ throws: false, text: JSON.stringify(v), message: '' })),
  invalidVerdictArb.map((v) => ({ throws: false, text: JSON.stringify(v), message: '' })),
  fc.string().map((s) => ({ throws: false, text: `<<not-json>>${s}`, message: '' })),
  fc.string({ minLength: 1 }).map((m) => ({ throws: true, text: '', message: m })),
);

/** Build an inline fake ModelClient from a generated behavior. */
function makeModelClient(behavior: ModelBehavior): ModelClient {
  return {
    mode: 'demo',
    isConfigured: () => false,
    complete: async () => {
      if (behavior.throws) {
        throw new Error(behavior.message);
      }
      return { text: behavior.text, simulated: true };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Assert a Verdict satisfies every VerdictSchema bound and cardinality rule
 * (Requirements 15.3, 16.1), both via `safeParse` and explicitly per field.
 */
function assertVerdictBounds(verdict: Verdict): void {
  expect(VerdictSchema.safeParse(verdict).success).toBe(true);

  // strategyPrediction ∈ StrategyEnum
  expect(STRATEGIES).toContain(verdict.strategyPrediction);

  // confidence: integer in [0, 100]
  expect(Number.isInteger(verdict.confidence)).toBe(true);
  expect(verdict.confidence).toBeGreaterThanOrEqual(0);
  expect(verdict.confidence).toBeLessThanOrEqual(100);

  // riskScore: integer in [0, 100]
  expect(Number.isInteger(verdict.riskScore)).toBe(true);
  expect(verdict.riskScore).toBeGreaterThanOrEqual(0);
  expect(verdict.riskScore).toBeLessThanOrEqual(100);

  // recommendedActions: 1..10 non-empty strings
  expect(Array.isArray(verdict.recommendedActions)).toBe(true);
  expect(verdict.recommendedActions.length).toBeGreaterThanOrEqual(1);
  expect(verdict.recommendedActions.length).toBeLessThanOrEqual(10);
  for (const action of verdict.recommendedActions) {
    expect(typeof action).toBe('string');
    expect(action.length).toBeGreaterThan(0);
  }

  // keyEvidence / counterEvidence: string arrays
  expect(Array.isArray(verdict.keyEvidence)).toBe(true);
  for (const e of verdict.keyEvidence) expect(typeof e).toBe('string');
  expect(Array.isArray(verdict.counterEvidence)).toBe(true);
  for (const e of verdict.counterEvidence) expect(typeof e).toBe('string');
}

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

describe('Property 21: Judge verdict satisfies all bounds and cardinality (Requirements 15.3, 16.1)', () => {
  it('concludeDebate always yields a schema-valid verdict and never throws, for any debate inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        evidenceArb,
        defenseInputArb,
        prosecutionInputArb,
        modelBehaviorArb,
        async (evidence, defense, prosecution, behavior) => {
          const input: DebateInput = {
            ...evidence,
            defense,
            prosecution,
            model: makeModelClient(behavior),
          };

          // Must resolve (never throw) regardless of how adversarial the inputs
          // and model output are.
          const result = await concludeDebate(input);

          // The concluded verdict always satisfies every bound and cardinality
          // rule (Requirements 15.3, 16.1).
          assertVerdictBounds(result.verdict);

          // The conclusion metadata stays well-formed.
          expect(typeof result.isFallback).toBe('boolean');
          expect(
            result.failureCause === null || typeof result.failureCause === 'string',
          ).toBe(true);
        },
      ),
      pbtParams(),
    );
  });

  it('with non-empty evidence, valid arguments, and a valid model verdict, the verdict passes through unchanged (normal path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          claims: fc.array(claimArb, { maxLength: 4 }),
          statuses: fc.array(claimStatusArb, { maxLength: 4 }),
          // At least one diff guarantees evidence is present, so the
          // insufficient-evidence short-circuit does not fire.
          diffs: fc.array(diffArb, { minLength: 1, maxLength: 3 }),
        }),
        validDefenseArb,
        validProsecutionArb,
        validVerdictArb,
        async (evidence, defense, prosecution, verdict) => {
          const result = await concludeDebate({
            ...evidence,
            defense,
            prosecution,
            model: makeModelClient({ throws: false, text: JSON.stringify(verdict), message: '' }),
          });

          assertVerdictBounds(result.verdict);
          expect(result.isFallback).toBe(false);
          expect(result.failureCause).toBeNull();
          // The valid model verdict flows through the judge unchanged.
          expect(result.verdict).toEqual(verdict);
        },
      ),
      pbtParams(),
    );
  });

  it('runJudge resolves to a bounds-valid verdict for any valid model verdict (positive case)', async () => {
    await fc.assert(
      fc.asyncProperty(
        evidenceArb,
        validDefenseArb,
        validProsecutionArb,
        validVerdictArb,
        async (evidence, defense, prosecution, verdict) => {
          const result = await runJudge({
            ...evidence,
            defense,
            prosecution,
            model: makeModelClient({ throws: false, text: JSON.stringify(verdict), message: '' }),
          });

          assertVerdictBounds(result);
          expect(result).toEqual(verdict);
        },
      ),
      pbtParams(),
    );
  });

  it('runJudge throws JudgeOutputError for any bound-violating or non-JSON model output (negative case)', async () => {
    await fc.assert(
      fc.asyncProperty(
        evidenceArb,
        validDefenseArb,
        validProsecutionArb,
        invalidModelTextArb,
        async (evidence, defense, prosecution, text) => {
          await expect(
            runJudge({
              ...evidence,
              defense,
              prosecution,
              model: makeModelClient({ throws: false, text, message: '' }),
            }),
          ).rejects.toBeInstanceOf(JudgeOutputError);
        },
      ),
      pbtParams(),
    );
  });

  it('runs each property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
