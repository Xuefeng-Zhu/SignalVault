// Feature: signalvault, Property 18: Extracted claims conform to the typed claim schema
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ClaimSchema, ClaimTypeEnum } from "@/lib/schemas";
import type { ModelClient } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { extractClaims } from "./claim-extractor";

/**
 * Property 18 (Validates: Requirements 13.1):
 * For ANY normalized snapshot content and ANY text the model returns, every
 * claim returned by `extractClaims` conforms to the typed `ClaimSchema`:
 *   - `claimType` is drawn from `ClaimTypeEnum`,
 *   - `statementText` and `evidenceText` are non-empty, and
 *   - `confidence` is a number in [0.0, 1.0].
 *
 * `extractClaims` validates the raw model text against `z.array(ClaimSchema)`
 * (returning `[]` on anything it cannot trust) and then filters to grounded
 * claims, so the result must ALWAYS be schema-conformant — even when the model
 * returns garbage. We therefore feed the agent a FAKE `ModelClient` whose
 * `complete()` emits a generated mix of:
 *   - valid `Claim[]` JSON (some with `evidenceText` that IS a substring of the
 *     generated content so they survive grounding, some that is not),
 *   - malformed (non-JSON) text,
 *   - well-formed JSON that is not an array of claims (object / null / number /
 *     string / a single claim object),
 *   - arrays containing adversarial claim objects (bogus `claimType`, empty
 *     `statementText`/`evidenceText`, out-of-range or wrong-typed `confidence`,
 *     missing fields), and
 *   - the empty array.
 * In every case the result must be an array whose every element passes
 * `ClaimSchema.safeParse`, and `extractClaims` must never throw.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** Every member of the claim_type enum (Requirement 13.1). */
const claimTypeArb = fc.constantFrom(...ClaimTypeEnum.options);

/** A model-assigned confidence inside the valid [0, 1] range. */
const validConfidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

/** A non-empty substring of `s` (used to produce GROUNDED evidence text). */
function nonEmptySubstringArb(s: string): fc.Arbitrary<string> {
  // Precondition: s.length >= 1.
  return fc
    .integer({ min: 0, max: s.length - 1 })
    .chain((start) =>
      fc.integer({ min: start + 1, max: s.length }).map((end) => s.slice(start, end)),
    );
}

/**
 * A VALID claim object. When `content` is non-empty its `evidenceText` is, with
 * even odds, a literal substring of `content` (so the claim survives grounding)
 * or an arbitrary non-empty string (so it is dropped by grounding) — both paths
 * must still yield schema-conformant output.
 */
function validClaimArb(content: string): fc.Arbitrary<unknown> {
  const evidenceArb =
    content.length > 0
      ? fc.oneof(nonEmptySubstringArb(content), fc.string({ minLength: 1 }))
      : fc.string({ minLength: 1 });

  return fc.record({
    claimType: claimTypeArb,
    statementText: fc.string({ minLength: 1 }),
    evidenceText: evidenceArb,
    confidence: validConfidenceArb,
  });
}

/** JSON text for an array of valid claims (possibly empty). */
function validClaimsTextArb(content: string): fc.Arbitrary<string> {
  return fc.array(validClaimArb(content), { maxLength: 6 }).map((arr) => JSON.stringify(arr));
}

/**
 * An adversarial "claim" object — each variant violates `ClaimSchema` in a
 * distinct way so the whole array fails `z.array(ClaimSchema)` validation.
 */
const invalidClaimObjArb: fc.Arbitrary<unknown> = fc.oneof(
  // Bogus claim_type outside the enum.
  fc.record({
    claimType: fc.string().map((s) => `bogus_${s}`),
    statementText: fc.string({ minLength: 1 }),
    evidenceText: fc.string({ minLength: 1 }),
    confidence: validConfidenceArb,
  }),
  // Empty statementText.
  fc.record({
    claimType: claimTypeArb,
    statementText: fc.constant(""),
    evidenceText: fc.string({ minLength: 1 }),
    confidence: validConfidenceArb,
  }),
  // Empty evidenceText.
  fc.record({
    claimType: claimTypeArb,
    statementText: fc.string({ minLength: 1 }),
    evidenceText: fc.constant(""),
    confidence: validConfidenceArb,
  }),
  // confidence out of [0, 1] range.
  fc.record({
    claimType: claimTypeArb,
    statementText: fc.string({ minLength: 1 }),
    evidenceText: fc.string({ minLength: 1 }),
    confidence: fc.oneof(
      fc.constant(5),
      fc.constant(-1),
      fc.double({ min: 1.0001, max: 1000, noNaN: true }),
    ),
  }),
  // Wrong-typed confidence.
  fc.record({
    claimType: claimTypeArb,
    statementText: fc.string({ minLength: 1 }),
    evidenceText: fc.string({ minLength: 1 }),
    confidence: fc.constantFrom("high", "0.5"),
  }),
  // Missing confidence entirely.
  fc.record({
    claimType: claimTypeArb,
    statementText: fc.string({ minLength: 1 }),
    evidenceText: fc.string({ minLength: 1 }),
  }),
);

/** JSON text for an array containing at least one adversarial claim object. */
const invalidClaimsTextArb: fc.Arbitrary<string> = fc
  .array(invalidClaimObjArb, { minLength: 1, maxLength: 6 })
  .map((arr) => JSON.stringify(arr));

/** Well-formed JSON that is NOT an array of claims. */
const nonArrayJsonArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant("{}"),
  fc.constant("null"),
  fc.constant("123"),
  fc.constant('"just a string"'),
  fc.constant("true"),
  // A single claim object (object, not array) — must not be returned as-is.
  fc.record({
    claimType: claimTypeArb,
    statementText: fc.string({ minLength: 1 }),
    evidenceText: fc.string({ minLength: 1 }),
    confidence: validConfidenceArb,
  }).map((o) => JSON.stringify(o)),
);

/** Text that does not parse as JSON at all. */
const malformedJsonArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.constant("   "),
  fc.constant("not json at all"),
  fc.constant("{ unterminated: "),
  fc.constant("[1, 2, 3"),
  fc.constant("<html>nope</html>"),
);

/**
 * A generated scenario: a `normalizedContent` paired with the raw text the fake
 * model will return, spanning valid, grounded, adversarial, and malformed cases.
 */
const scenarioArb = fc
  .string({ maxLength: 120 })
  .chain((normalizedContent) =>
    fc
      .oneof(
        validClaimsTextArb(normalizedContent),
        invalidClaimsTextArb,
        nonArrayJsonArb,
        malformedJsonArb,
        fc.constant("[]"),
      )
      .map((modelText) => ({ normalizedContent, modelText })),
  );

/**
 * Build the inline FAKE ModelClient described by the task: never
 * configured, returns the generated `text` and never makes a network call.
 */
function fakeModel(text: string): ModelClient {
  return {
    mode: "live",
    isConfigured: () => false,
    complete: async () => ({ text, simulated: true }),
  };
}

describe("Property 18: Extracted claims conform to the typed claim schema (Requirements 13.1)", () => {
  it("every claim returned by extractClaims conforms to ClaimSchema, regardless of model output", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ normalizedContent, modelText }) => {
        const model = fakeModel(modelText);

        // Must never throw, and must always resolve to a real array.
        const claims = await extractClaims({ normalizedContent, model });

        expect(claims).not.toBeNull();
        expect(claims).not.toBeUndefined();
        expect(Array.isArray(claims)).toBe(true);

        // Conformance: every returned element satisfies the typed claim schema.
        for (const claim of claims) {
          expect(ClaimSchema.safeParse(claim).success).toBe(true);
        }
      }),
      pbtParams(),
    );
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
