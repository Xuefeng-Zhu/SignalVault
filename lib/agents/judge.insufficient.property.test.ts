// Feature: signalvault, Property 22: Absent evidence forces an insufficient-evidence verdict
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  ClaimStatusEnum,
  ClaimTypeEnum,
  StrategyEnum,
  VerdictSchema,
  type Claim,
  type Strategy,
  type Verdict,
} from "@/lib/schemas";
import type { Diff } from "@/lib/diff";
import type { InferenceRequest, ModelClient } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import {
  buildInsufficientEvidenceVerdict,
  concludeDebate,
  isEvidenceAbsent,
  INSUFFICIENT_EVIDENCE_CONFIDENCE,
} from "./judge";
import type { ClaimStatusAssignment } from "./debate";

/**
 * Property 22 (Validates: Requirements 15.6):
 *
 * For ANY debate input in which no diffs were computed AND no claim was
 * assigned a Claim_Status, `concludeDebate` produces the `insufficient_evidence`
 * strategy prediction with a confidence value not exceeding 25 — enforced
 * deterministically and WITHOUT calling the model, so the result is independent
 * of the model output and of the defense/prosecution inputs.
 *
 * The rule is keyed off `diffs` AND `statuses` both being empty (see
 * `isEvidenceAbsent`); claims may be present or absent. The deterministic
 * short-circuit takes precedence over everything else, so even a fake model
 * that returns a confident, non-`insufficient_evidence` verdict (or throws)
 * cannot override it.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/* -------------------------------------------------------------------------- */
/* Fake ModelClient                                                           */
/* -------------------------------------------------------------------------- */

/** How a fake model responds when (and if) it is consulted. */
type ModelBehavior =
  | { kind: "json"; text: string } // arbitrary / confident verdict JSON
  | { kind: "raw"; text: string } // arbitrary, possibly non-JSON, text
  | { kind: "throw" }; // model error / timeout surrogate

/**
 * Build an inline fake {@link ModelClient} plus a call counter. The counter lets
 * the short-circuit property assert the model was NEVER consulted (Requirement
 * 15.6 is enforced "without calling the model").
 */
function makeModel(behavior: ModelBehavior): {
  client: ModelClient;
  calls: () => number;
} {
  let calls = 0;
  const client: ModelClient = {
    mode: "demo",
    isConfigured: () => false,
    async complete(_req: InferenceRequest): Promise<{ text: string; simulated: boolean }> {
      calls += 1;
      if (behavior.kind === "throw") {
        throw new Error("model failure (must not be reached on the short-circuit path)");
      }
      return { text: behavior.text, simulated: true };
    },
  };
  return { client, calls: () => calls };
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

const strategyArb: fc.Arbitrary<Strategy> = fc.constantFrom(...StrategyEnum.options);

/** Any schema-valid Verdict. */
const verdictArb: fc.Arbitrary<Verdict> = fc.record({
  strategyPrediction: strategyArb,
  confidence: fc.integer({ min: 0, max: 100 }),
  riskScore: fc.integer({ min: 0, max: 100 }),
  recommendedActions: fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 }),
  keyEvidence: fc.array(fc.string()),
  counterEvidence: fc.array(fc.string()),
});

/**
 * A CONFIDENT, NON-`insufficient_evidence` verdict — the adversarial case the
 * deterministic rule must override (a model that "wants" a high-confidence
 * strategy shift cannot win).
 */
const confidentNonInsufficientVerdictArb: fc.Arbitrary<Verdict> = fc.record({
  strategyPrediction: fc.constantFrom(
    ...StrategyEnum.options.filter((s) => s !== "insufficient_evidence"),
  ),
  confidence: fc.integer({ min: 90, max: 100 }),
  riskScore: fc.integer({ min: 0, max: 100 }),
  recommendedActions: fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 }),
  keyEvidence: fc.array(fc.string()),
  counterEvidence: fc.array(fc.string()),
});

/** Model behavior: confident verdict JSON, arbitrary verdict JSON, raw text, or throw. */
const modelBehaviorArb: fc.Arbitrary<ModelBehavior> = fc.oneof(
  confidentNonInsufficientVerdictArb.map((v) => ({ kind: "json" as const, text: JSON.stringify(v) })),
  verdictArb.map((v) => ({ kind: "json" as const, text: JSON.stringify(v) })),
  fc.string().map((text) => ({ kind: "raw" as const, text })),
  fc.constant({ kind: "throw" as const }),
);

const validDefenseArb = fc.record({
  argument: fc.string({ minLength: 1 }),
  keyEvidence: fc.array(fc.string()),
});

const validProsecutionArb = fc.record({
  argument: fc.string({ minLength: 1 }),
  counterEvidence: fc.array(fc.string()),
});

/** Defense input that may be a valid argument OR arbitrary invalid junk. */
const defenseInputArb: fc.Arbitrary<unknown> = fc.oneof(
  validDefenseArb,
  fc.anything(),
);

/** Prosecution input that may be a valid argument OR arbitrary invalid junk. */
const prosecutionInputArb: fc.Arbitrary<unknown> = fc.oneof(
  validProsecutionArb,
  fc.anything(),
);

const claimArb: fc.Arbitrary<Claim> = fc.record({
  claimType: fc.constantFrom(...ClaimTypeEnum.options),
  statementText: fc.string({ minLength: 1 }),
  evidenceText: fc.string({ minLength: 1 }),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
});

/** Claims may be present or absent — the rule keys off diffs + statuses only. */
const claimsArb: fc.Arbitrary<Claim[]> = fc.array(claimArb, { maxLength: 5 });

const nonEmptyStatusesArb: fc.Arbitrary<ClaimStatusAssignment[]> = fc.array(
  fc.record({
    statementText: fc.string({ minLength: 1 }),
    claimStatus: fc.constantFrom(...ClaimStatusEnum.options),
  }),
  { minLength: 1, maxLength: 5 },
);

const diffArb: fc.Arbitrary<Diff> = fc.record({
  priorSnapshotId: fc.option(fc.string(), { nil: null }),
  currentSnapshotId: fc.string(),
  changeScore: fc.integer({ min: 0, max: 100 }),
  changeSummary: fc.string(),
  addedText: fc.string(),
  removedText: fc.string(),
  modifiedSections: fc.array(
    fc.record({ heading: fc.string(), before: fc.string(), after: fc.string() }),
  ),
});

const nonEmptyDiffsArb: fc.Arbitrary<Diff[]> = fc.array(diffArb, {
  minLength: 1,
  maxLength: 3,
});

/** Evidence in which at least one of statuses / diffs is NON-empty. */
const presentEvidenceArb: fc.Arbitrary<{
  statuses: ClaimStatusAssignment[];
  diffs: Diff[];
}> = fc.oneof(
  fc.record({ statuses: nonEmptyStatusesArb, diffs: fc.constant<Diff[]>([]) }),
  fc.record({ statuses: fc.constant<ClaimStatusAssignment[]>([]), diffs: nonEmptyDiffsArb }),
  fc.record({ statuses: nonEmptyStatusesArb, diffs: nonEmptyDiffsArb }),
);

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

describe("Property 22: Absent evidence forces an insufficient-evidence verdict (Requirements 15.6)", () => {
  it("when diffs AND statuses are empty, concludeDebate returns insufficient_evidence (confidence <= 25), regardless of model output or defense/prosecution inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        defenseInputArb,
        prosecutionInputArb,
        claimsArb,
        modelBehaviorArb,
        async (defense, prosecution, claims, behavior) => {
          const { client, calls } = makeModel(behavior);

          const result = await concludeDebate({
            defense,
            prosecution,
            claims,
            statuses: [],
            diffs: [],
            model: client,
          });

          // The deterministic insufficient-evidence verdict wins (15.6).
          expect(result.verdict.strategyPrediction).toBe("insufficient_evidence");
          expect(result.verdict.confidence).toBeLessThanOrEqual(
            INSUFFICIENT_EVIDENCE_CONFIDENCE,
          );
          expect(result.verdict.confidence).toBeLessThanOrEqual(25);

          // It is a normal (non-fallback) deterministic verdict.
          expect(result.isFallback).toBe(false);
          expect(result.failureCause).toBeNull();

          // The verdict is itself schema-valid.
          expect(() => VerdictSchema.parse(result.verdict)).not.toThrow();

          // Enforced WITHOUT consulting the model.
          expect(calls()).toBe(0);
        },
      ),
      pbtParams(),
    );
  });

  it("contrast: when statuses OR diffs is non-empty, the short-circuit does NOT fire — the validated judge verdict is returned (still VerdictSchema-valid)", async () => {
    await fc.assert(
      fc.asyncProperty(
        validDefenseArb,
        validProsecutionArb,
        verdictArb,
        presentEvidenceArb,
        claimsArb,
        async (defense, prosecution, modelVerdict, evidence, claims) => {
          const { client } = makeModel({ kind: "json", text: JSON.stringify(modelVerdict) });

          const result = await concludeDebate({
            defense,
            prosecution,
            claims,
            statuses: evidence.statuses,
            diffs: evidence.diffs,
            model: client,
          });

          // The result is a schema-valid verdict; we do NOT over-constrain its
          // strategy. With valid agents + a valid model verdict and present
          // evidence, the normal path returns the model's verdict verbatim,
          // proving the insufficient-evidence rule did not force the outcome.
          expect(() => VerdictSchema.parse(result.verdict)).not.toThrow();
          expect(result.verdict).toEqual(modelVerdict);
          expect(result.isFallback).toBe(false);
          expect(result.failureCause).toBeNull();
        },
      ),
      pbtParams(),
    );
  });

  it("isEvidenceAbsent is true exactly when both statuses and diffs are empty", () => {
    // The empty/empty case is deterministically true.
    expect(isEvidenceAbsent({ statuses: [], diffs: [] })).toBe(true);

    fc.assert(
      fc.property(nonEmptyStatusesArb, nonEmptyDiffsArb, (statuses, diffs) => {
        expect(isEvidenceAbsent({ statuses: [], diffs: [] })).toBe(true);
        expect(isEvidenceAbsent({ statuses, diffs: [] })).toBe(false);
        expect(isEvidenceAbsent({ statuses: [], diffs })).toBe(false);
        expect(isEvidenceAbsent({ statuses, diffs })).toBe(false);
      }),
      pbtParams(),
    );
  });

  it("buildInsufficientEvidenceVerdict yields a schema-valid insufficient_evidence verdict with confidence <= 25", () => {
    const verdict = buildInsufficientEvidenceVerdict();
    expect(() => VerdictSchema.parse(verdict)).not.toThrow();
    expect(verdict.strategyPrediction).toBe("insufficient_evidence");
    expect(verdict.confidence).toBeLessThanOrEqual(25);
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
