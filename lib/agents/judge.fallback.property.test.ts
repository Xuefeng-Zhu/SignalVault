// Feature: signalvault, Property 23: Model failure or invalid agent output yields the deterministic fallback verdict
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ClaimStatusEnum,
  ClaimTypeEnum,
  StrategyEnum,
  VerdictSchema,
} from '@/lib/schemas';
import { buildDemoFallbackVerdict } from '@/lib/demo';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

// `import type` keeps the `server-only` runtime guard pulled in by
// `@/lib/adapters/types` out of this test module (vitest also aliases
// `server-only` to a no-op stub), so the injected fake `ModelClient` typechecks
// without importing the throwing guard.
import type { ModelClient } from '@/lib/adapters/types';

import { concludeDebate } from './judge';
import type { ClaimStatusAssignment } from './debate';

/**
 * Property 23 (Validates: Requirements 15.7, 19.3, 24.3):
 *
 * *For any* agent output that fails its Zod schema validation, or *for any*
 * model invocation that errors / throws / times out, `concludeDebate` records
 * the failure cause and substitutes the deterministic Demo_Company fallback
 * Verdict ("moving_upmarket", confidence 82) so the workflow can continue —
 * and it NEVER throws.
 *
 * The insufficient-evidence rule (Requirement 15.6) takes PRECEDENCE and is a
 * separate, deterministic path (NOT a fallback). To exercise the fallback path
 * here every generated scenario carries NON-empty evidence (at least one diff
 * OR one claim status) so that short-circuit never fires and mask the fallback.
 *
 * Four failure scenarios are generated, each with non-empty evidence:
 *   A. invalid defense  + valid prosecution + a model that would otherwise
 *      return a valid verdict (proving the fallback is due to the agent output);
 *   B. valid defense    + invalid prosecution + valid-verdict model;
 *   C. valid defense & prosecution, but the judge's model output is invalid
 *      (non-JSON, or a bounds-violating verdict) so the judge fails (15.7);
 *   D. valid defense & prosecution, but the model `complete()` THROWS
 *      (model failure / timeout — Requirements 19.3 / 24.3).
 *
 * For every scenario the conclusion must report `isFallback === true`, a
 * non-empty `failureCause` string, and a `verdict` that deep-equals the
 * deterministic fallback and is VerdictSchema-valid.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** The deterministic fallback verdict value, with the persistence-only
 * `isFallback` flag stripped — exactly what `concludeDebate` returns in its
 * `verdict` field. */
const { isFallback: _isFallback, ...EXPECTED_FALLBACK_VERDICT } =
  buildDemoFallbackVerdict();

/* -------------------------------------------------------------------------- */
/* Valid agent / verdict arbitraries                                          */
/* -------------------------------------------------------------------------- */

/** A schema-valid defense argument (`{ argument: nonempty, keyEvidence: [] }`). */
const validDefenseArb = fc.record({
  argument: fc.string({ minLength: 1 }),
  keyEvidence: fc.array(fc.string(), { maxLength: 5 }),
});

/** A schema-valid prosecution argument (`{ argument: nonempty, counterEvidence }`). */
const validProsecutionArb = fc.record({
  argument: fc.string({ minLength: 1 }),
  counterEvidence: fc.array(fc.string(), { maxLength: 5 }),
});

/** A VerdictSchema-valid verdict, serialized by a model that "would otherwise
 * return a valid verdict". */
const validVerdictArb = fc.record({
  strategyPrediction: fc.constantFrom(...StrategyEnum.options),
  confidence: fc.integer({ min: 0, max: 100 }),
  riskScore: fc.integer({ min: 0, max: 100 }),
  recommendedActions: fc.array(fc.string({ minLength: 1 }), {
    minLength: 1,
    maxLength: 10,
  }),
  keyEvidence: fc.array(fc.string(), { maxLength: 5 }),
  counterEvidence: fc.array(fc.string(), { maxLength: 5 }),
});

/* -------------------------------------------------------------------------- */
/* Guaranteed-invalid arbitraries                                             */
/* -------------------------------------------------------------------------- */

/** Values that always FAIL `DefenseArgumentSchema`
 * (`{ argument: string().min(1), keyEvidence: string[] }`). */
const invalidDefenseArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant({}),
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.array(fc.string()),
  // object missing `argument`
  fc.record({ keyEvidence: fc.array(fc.string()) }),
  // empty `argument` violates min(1)
  fc.record({ argument: fc.constant(''), keyEvidence: fc.array(fc.string()) }),
  // wrong-typed `argument`
  fc.record({ argument: fc.integer(), keyEvidence: fc.array(fc.string()) }),
  // wrong-typed `keyEvidence`
  fc.record({ argument: fc.string({ minLength: 1 }), keyEvidence: fc.string() }),
  // `keyEvidence` array of non-strings
  fc.record({
    argument: fc.string({ minLength: 1 }),
    keyEvidence: fc.array(fc.integer(), { minLength: 1 }),
  }),
);

/** Values that always FAIL `ProsecutorArgumentSchema`
 * (`{ argument: string().min(1), counterEvidence: string[] }`). */
const invalidProsecutionArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant({}),
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.array(fc.string()),
  // object missing `argument`
  fc.record({ counterEvidence: fc.array(fc.string()) }),
  // empty `argument` violates min(1)
  fc.record({ argument: fc.constant(''), counterEvidence: fc.array(fc.string()) }),
  // wrong-typed `argument`
  fc.record({ argument: fc.integer(), counterEvidence: fc.array(fc.string()) }),
  // wrong-typed `counterEvidence`
  fc.record({ argument: fc.string({ minLength: 1 }), counterEvidence: fc.string() }),
  // `counterEvidence` array of non-strings
  fc.record({
    argument: fc.string({ minLength: 1 }),
    counterEvidence: fc.array(fc.integer(), { minLength: 1 }),
  }),
);

/** Raw judge-model text that always makes `runJudge` throw: either non-JSON, or
 * valid JSON that violates VerdictSchema bounds/cardinality/enum. */
const nonJsonArb = fc.constantFrom(
  'not json at all',
  '{ unterminated',
  '',
  '<<<>>>',
  'function(){}',
);

const boundsViolatingVerdictArb = fc.oneof(
  validVerdictArb.map((v) => JSON.stringify({ ...v, confidence: 200 })), // > 100
  validVerdictArb.map((v) => JSON.stringify({ ...v, confidence: -5 })), // < 0
  validVerdictArb.map((v) => JSON.stringify({ ...v, confidence: 50.5 })), // non-integer
  validVerdictArb.map((v) => JSON.stringify({ ...v, riskScore: 1000 })), // > 100
  validVerdictArb.map((v) => JSON.stringify({ ...v, recommendedActions: [] })), // < 1
  validVerdictArb.map((v) =>
    JSON.stringify({ ...v, recommendedActions: Array(11).fill('a') }),
  ), // > 10
  validVerdictArb.map((v) =>
    JSON.stringify({ ...v, strategyPrediction: 'not_a_real_strategy' }),
  ), // bad enum
);

const invalidJudgeTextArb = fc.oneof(nonJsonArb, boundsViolatingVerdictArb);

/** Values a failing/timed-out model might throw — Errors and non-Error throws. */
const thrownArb = fc.oneof(
  fc.string({ minLength: 1 }).map((m) => new Error(m)),
  fc.constant(new Error('model request timed out after 60000ms')),
  fc.string(), // non-Error throw (string, possibly empty)
  fc.record({ code: fc.string() }), // non-Error throw (object)
);

/* -------------------------------------------------------------------------- */
/* Non-empty evidence (so the 15.6 short-circuit never fires)                 */
/* -------------------------------------------------------------------------- */

const claimArb = fc.record({
  claimType: fc.constantFrom(...ClaimTypeEnum.options),
  statementText: fc.string({ minLength: 1 }),
  evidenceText: fc.string({ minLength: 1 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

const modifiedSectionArb = fc.record({
  heading: fc.string(),
  before: fc.string(),
  after: fc.string(),
});

const diffArb = fc.record({
  priorSnapshotId: fc.option(fc.string(), { nil: null }),
  currentSnapshotId: fc.string(),
  changeScore: fc.integer({ min: 0, max: 100 }),
  changeSummary: fc.string(),
  addedText: fc.string(),
  removedText: fc.string(),
  modifiedSections: fc.array(modifiedSectionArb, { maxLength: 3 }),
});

const statusArb: fc.Arbitrary<ClaimStatusAssignment> = fc.record({
  statementText: fc.string({ minLength: 1 }),
  claimStatus: fc.constantFrom(...ClaimStatusEnum.options),
});

/** Evidence with NON-empty diffs and/or statuses so `isEvidenceAbsent` is false
 * and the insufficient-evidence rule (15.6) cannot mask the fallback path. */
const nonEmptyEvidenceArb = fc.oneof(
  // at least one status (diffs may be empty)
  fc.record({
    claims: fc.array(claimArb, { maxLength: 4 }),
    diffs: fc.array(diffArb, { maxLength: 3 }),
    statuses: fc.array(statusArb, { minLength: 1, maxLength: 5 }),
  }),
  // at least one diff (statuses may be empty)
  fc.record({
    claims: fc.array(claimArb, { maxLength: 4 }),
    diffs: fc.array(diffArb, { minLength: 1, maxLength: 3 }),
    statuses: fc.array(statusArb, { maxLength: 5 }),
  }),
);

/* -------------------------------------------------------------------------- */
/* Failure scenarios                                                          */
/* -------------------------------------------------------------------------- */

interface FailureScenario {
  label: 'invalid-defense' | 'invalid-prosecution' | 'judge-invalid-output' | 'model-throws';
  defense: unknown;
  prosecution: unknown;
  model: ModelClient;
}

/** Build a fake demo `ModelClient` whose `complete()` runs `behavior`. */
function makeModel(
  behavior: () => Promise<{ text: string; simulated: boolean }>,
): ModelClient {
  return {
    isConfigured: () => false,
    mode: 'demo',
    complete: behavior,
  };
}

const scenarioArb: fc.Arbitrary<FailureScenario> = fc.oneof(
  // A: invalid defense; prosecution valid; model would otherwise return a valid verdict.
  fc
    .record({
      defense: invalidDefenseArb,
      prosecution: validProsecutionArb,
      verdict: validVerdictArb,
    })
    .map(({ defense, prosecution, verdict }): FailureScenario => ({
      label: 'invalid-defense',
      defense,
      prosecution,
      model: makeModel(async () => ({ text: JSON.stringify(verdict), simulated: true })),
    })),

  // B: defense valid; prosecution invalid; model would otherwise return a valid verdict.
  fc
    .record({
      defense: validDefenseArb,
      prosecution: invalidProsecutionArb,
      verdict: validVerdictArb,
    })
    .map(({ defense, prosecution, verdict }): FailureScenario => ({
      label: 'invalid-prosecution',
      defense,
      prosecution,
      model: makeModel(async () => ({ text: JSON.stringify(verdict), simulated: true })),
    })),

  // C: defense & prosecution valid; judge model output is invalid (non-JSON or bounds-violating).
  fc
    .record({
      defense: validDefenseArb,
      prosecution: validProsecutionArb,
      badText: invalidJudgeTextArb,
    })
    .map(({ defense, prosecution, badText }): FailureScenario => ({
      label: 'judge-invalid-output',
      defense,
      prosecution,
      model: makeModel(async () => ({ text: badText, simulated: true })),
    })),

  // D: defense & prosecution valid; model complete() throws (failure / timeout).
  fc
    .record({
      defense: validDefenseArb,
      prosecution: validProsecutionArb,
      thrown: thrownArb,
    })
    .map(({ defense, prosecution, thrown }): FailureScenario => ({
      label: 'model-throws',
      defense,
      prosecution,
      model: makeModel(async () => {
        throw thrown;
      }),
    })),
);

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe('Property 23: model failure / invalid agent output yields the deterministic fallback verdict', () => {
  it('substitutes the deterministic fallback verdict and never throws', async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyEvidenceArb, scenarioArb, async (evidence, scenario) => {
        // Must RESOLVE — concludeDebate degrades, never crashes (Requirement 19/15.7).
        const result = await concludeDebate({
          claims: evidence.claims,
          statuses: evidence.statuses,
          diffs: evidence.diffs,
          defense: scenario.defense,
          prosecution: scenario.prosecution,
          model: scenario.model,
        });

        // The deterministic Demo_Company fallback was substituted...
        expect(result.isFallback).toBe(true);

        // ...with a recorded, human-readable failure cause...
        expect(typeof result.failureCause).toBe('string');
        expect((result.failureCause as string).length).toBeGreaterThan(0);

        // ...and the verdict equals the deterministic fallback value.
        expect(result.verdict).toEqual(EXPECTED_FALLBACK_VERDICT);
        expect(result.verdict.strategyPrediction).toBe('moving_upmarket');
        expect(result.verdict.confidence).toBe(82);

        // The substituted verdict is itself schema-valid.
        expect(VerdictSchema.safeParse(result.verdict).success).toBe(true);
      }),
      pbtParams(),
    );
  });

  it('runs the property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
