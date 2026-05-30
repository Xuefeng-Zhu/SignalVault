// Feature: signalvault, Property 20: Classification assigns exactly one valid status with defined defaults
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  ClaimSchema,
  ClaimStatusEnum,
  ClaimTypeEnum,
  type Claim,
  type ClaimStatus,
} from "@/lib/schemas";
import type { ModelClient } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import {
  classifyClaims,
  NO_PRIOR_STATUS,
  UNDETERMINED_STATUS,
} from "./claim-classifier";

/**
 * Property 20 (Validates: Requirements 14.1, 14.2, 14.3):
 *
 * For any set of current and prior claims, `classifyClaims` assigns each claim
 * exactly one `Claim_Status` from `ClaimStatusEnum`, preserving input order
 * (14.1); a claim with no prior snapshot to compare against is `new` and the
 * model is never consulted (14.2); and a claim whose status the model cannot
 * resolve — because it was omitted, given an out-of-enum value, or because the
 * model returned non-JSON / threw — defaults to `needs_review` (14.3).
 *
 * The model is faked. Its output is driven adversarially (valid statuses,
 * invalid enum values, omitted claims, non-array/non-JSON garbage, thrown
 * errors) so the defaulting behaviour is exercised across the full space.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

const VALID_STATUSES = new Set<ClaimStatus>(ClaimStatusEnum.options);
const claimTypeArb = fc.constantFrom(...ClaimTypeEnum.options);
const validStatusArb = fc.constantFrom(...ClaimStatusEnum.options);
const confidenceArb = fc.float({ min: 0, max: 1, noNaN: true });

/** Strings guaranteed NOT to be members of `ClaimStatusEnum`. */
const invalidStatusArb = fc
  .oneof(
    fc.constantFrom("totally_invalid", "NEW", "Removed", "", "unknown", "123"),
    fc.string(),
  )
  .filter((s) => !VALID_STATUSES.has(s as ClaimStatus));

/** How the faked model treats one current claim when it returns a JSON array. */
type Treatment =
  | { kind: "valid"; status: ClaimStatus }
  | { kind: "invalid"; status: string }
  | { kind: "omit" };

const treatmentArb: fc.Arbitrary<Treatment> = fc.oneof(
  fc.record({ kind: fc.constant("valid" as const), status: validStatusArb }),
  fc.record({ kind: fc.constant("invalid" as const), status: invalidStatusArb }),
  fc.record({ kind: fc.constant("omit" as const) }),
);

interface ClaimSpec {
  baseText: string;
  claimType: Claim["claimType"];
  confidence: number;
  treatment: Treatment;
}

const claimSpecArb: fc.Arbitrary<ClaimSpec> = fc.record({
  baseText: fc.string(),
  claimType: claimTypeArb,
  confidence: confidenceArb,
  treatment: treatmentArb,
});

/** At least one current claim; each is given a UNIQUE statementText below. */
const claimSpecsArb = fc.array(claimSpecArb, { minLength: 1, maxLength: 8 });

/** Non-array / non-JSON model text — every entry yields an empty status map. */
const garbageArb = fc.oneof(
  fc.constantFrom(
    "not json at all",
    "",
    "{}",
    '{"statementText":"x","claimStatus":"new"}',
    "null",
    "true",
    "42",
    '"a bare string"',
    "[oops",
  ),
  // A JSON object (never an array) carrying otherwise-valid-looking entries.
  fc
    .array(validStatusArb)
    .map((arr) => JSON.stringify({ entries: arr })),
);

type ModelMode =
  | { mode: "array" }
  | { mode: "throw" }
  | { mode: "garbage"; text: string };

const modelModeArb: fc.Arbitrary<ModelMode> = fc.oneof(
  fc.constant<ModelMode>({ mode: "array" }),
  fc.constant<ModelMode>({ mode: "throw" }),
  fc.record({ mode: fc.constant("garbage" as const), text: garbageArb }),
);

/** Prior claims (sometimes empty), used only to decide if a basis exists. */
const priorClaimsArb = fc
  .array(
    fc.record({
      claimType: claimTypeArb,
      baseText: fc.string(),
      confidence: confidenceArb,
    }),
    { maxLength: 3 },
  )
  .map((rows): Claim[] =>
    rows.map((r, i) => ({
      claimType: r.claimType,
      statementText: `prior-[${i}] ${r.baseText}`,
      evidenceText: `prior-evidence-${i}`,
      confidence: r.confidence,
    })),
  );

/** Build current claims with UNIQUE statementText (index-prefixed) per spec. */
function buildCurrentClaims(specs: ClaimSpec[]): Claim[] {
  return specs.map((s, i) => ({
    claimType: s.claimType,
    statementText: `[${i}] ${s.baseText}`,
    evidenceText: `evidence-${i}`,
    confidence: s.confidence,
  }));
}

/** The JSON array the model "returns" in `array` mode, derived from treatments. */
function buildArrayText(specs: ClaimSpec[], claims: Claim[]): string {
  const entries: Array<{ statementText: string; claimStatus: string }> = [];
  specs.forEach((spec, i) => {
    if (spec.treatment.kind === "omit") return;
    entries.push({
      statementText: claims[i]!.statementText,
      claimStatus: spec.treatment.status,
    });
  });
  return JSON.stringify(entries);
}

/** A fake ModelClient that records how many times `complete` was invoked. */
function makeModel(mode: ModelMode, arrayText: string) {
  let calls = 0;
  const model: ModelClient = {
    mode: "demo",
    isConfigured: () => false,
    async complete() {
      calls += 1;
      if (mode.mode === "throw") {
        throw new Error("model boom");
      }
      const text = mode.mode === "garbage" ? mode.text : arrayText;
      return { text, simulated: true };
    },
  };
  return { model, getCalls: () => calls };
}

/** The status each current claim should receive given the basis + model mode. */
function expectedStatus(
  spec: ClaimSpec,
  hasBasis: boolean,
  mode: ModelMode,
): ClaimStatus {
  if (!hasBasis) return NO_PRIOR_STATUS; // 14.2
  if (mode.mode !== "array") return UNDETERMINED_STATUS; // throw / garbage → 14.3
  if (spec.treatment.kind === "valid") return spec.treatment.status; // 14.1
  return UNDETERMINED_STATUS; // omitted or out-of-enum → 14.3
}

describe("Property 20: classification assigns exactly one valid status with defined defaults (14.1, 14.2, 14.3)", () => {
  it("assigns exactly one valid status per claim, one-to-one in input order (14.1)", async () => {
    await fc.assert(
      fc.asyncProperty(
        claimSpecsArb,
        fc.boolean(),
        priorClaimsArb,
        modelModeArb,
        async (specs, hasPriorSnapshot, priorClaims, mode) => {
          const currentClaims = buildCurrentClaims(specs);
          // The generated current claims are themselves schema-valid.
          for (const c of currentClaims) {
            expect(ClaimSchema.safeParse(c).success).toBe(true);
          }

          const { model } = makeModel(mode, buildArrayText(specs, currentClaims));

          const result = await classifyClaims({
            currentClaims,
            priorClaims,
            hasPriorSnapshot,
            model,
          });

          // Exactly one result per input claim, paired one-to-one in order.
          expect(result).toHaveLength(currentClaims.length);
          result.forEach((entry, i) => {
            expect(entry.claim).toBe(currentClaims[i]);
            expect(VALID_STATUSES.has(entry.status)).toBe(true);
          });
        },
      ),
      pbtParams(),
    );
  });

  it("assigns `new` to every claim and never consults the model when there is no comparison basis (14.2)", async () => {
    // No basis = no prior snapshot OR an empty prior claim set.
    const noBasisArb = fc.oneof(
      fc.record({
        hasPriorSnapshot: fc.constant(false),
        priorClaims: fc.oneof(fc.constant<Claim[] | null>(null), priorClaimsArb),
      }),
      fc.record({
        hasPriorSnapshot: fc.constant(true),
        priorClaims: fc.constant<Claim[]>([]),
      }),
    );

    await fc.assert(
      fc.asyncProperty(
        claimSpecsArb,
        noBasisArb,
        modelModeArb,
        async (specs, basis, mode) => {
          const currentClaims = buildCurrentClaims(specs);
          const { model, getCalls } = makeModel(
            mode,
            buildArrayText(specs, currentClaims),
          );

          const result = await classifyClaims({
            currentClaims,
            priorClaims: basis.priorClaims,
            hasPriorSnapshot: basis.hasPriorSnapshot,
            model,
          });

          // Every claim is `new`...
          expect(result).toHaveLength(currentClaims.length);
          for (const entry of result) {
            expect(entry.status).toBe(NO_PRIOR_STATUS);
          }
          // ...and the model was never invoked.
          expect(getCalls()).toBe(0);
        },
      ),
      pbtParams(),
    );
  });

  it("defaults undetermined claims to `needs_review` when a basis exists but the model gives nothing usable (14.3)", async () => {
    // Basis present: a prior snapshot WITH at least one prior claim.
    const nonEmptyPriorArb = priorClaimsArb.filter((c) => c.length > 0);

    await fc.assert(
      fc.asyncProperty(
        claimSpecsArb,
        nonEmptyPriorArb,
        modelModeArb,
        async (specs, priorClaims, mode) => {
          const currentClaims = buildCurrentClaims(specs);
          const { model, getCalls } = makeModel(
            mode,
            buildArrayText(specs, currentClaims),
          );

          const result = await classifyClaims({
            currentClaims,
            priorClaims,
            hasPriorSnapshot: true,
            model,
          });

          expect(result).toHaveLength(currentClaims.length);
          // The model is consulted exactly once when a basis exists.
          expect(getCalls()).toBe(1);

          result.forEach((entry, i) => {
            const spec = specs[i]!;
            const expected = expectedStatus(spec, true, mode);
            expect(entry.status).toBe(expected);

            // Directly assert the 14.3 contract for every undetermined claim:
            // omitted, out-of-enum, non-JSON, or thrown → needs_review.
            const undetermined =
              mode.mode !== "array" || spec.treatment.kind !== "valid";
            if (undetermined) {
              expect(entry.status).toBe(UNDETERMINED_STATUS);
            }
          });
        },
      ),
      pbtParams(),
    );
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
