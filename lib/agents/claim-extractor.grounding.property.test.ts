// Feature: signalvault, Property 19: Extracted claims are grounded in the normalized content
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ClaimTypeEnum, type Claim } from "@/lib/schemas";
import type { ModelClient } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { extractClaims } from "./claim-extractor";

/**
 * Property 19 (Validates: Requirements 13.5):
 *
 * For ANY normalized content and ANY model output, every claim that
 * `extractClaims` returns has an `evidenceText` that is a literal substring of
 * the `normalizedContent`, and no claim whose `evidenceText` is absent from
 * that content is ever emitted. The agent enforces grounding via an EXACT
 * `normalizedContent.includes(evidenceText)` filter (no trimming/case-folding),
 * so any claim the model fabricates evidence for is dropped.
 *
 * Strategy:
 *   - Generate a realistic `normalizedContent` string over printable ASCII.
 *   - PRESENT claims: `evidenceText` is a non-empty slice of `normalizedContent`
 *     (guaranteed grounded) — these MUST survive the filter, in input order.
 *   - ABSENT claims: `evidenceText` carries a `MARKER` control character
 *     (`\u0001`) that the printable-ASCII content can never contain, so the
 *     sentinel is guaranteed NOT to be a substring — these MUST be filtered out.
 *   - A fake {@link ModelClient} returns the candidate set as a JSON array;
 *     every candidate is otherwise `ClaimSchema`-valid so the only thing under
 *     test is the grounding filter.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/**
 * Control character used to forge "definitely absent" evidence. `fc.string`
 * and the realistic word list below only ever emit printable ASCII
 * (0x20–0x7e), so a sentinel containing this byte cannot occur in any generated
 * `normalizedContent`.
 */
const MARKER = "\u0001";

/** A model client that always returns a fixed `text` and performs no I/O. */
function fakeModelReturning(text: string): ModelClient {
  return {
    mode: "live",
    isConfigured: () => false,
    async complete() {
      return { text, simulated: true };
    },
  };
}

/** Realistic, all-ASCII fragments a public marketing/docs page might contain. */
const realisticWordArb: fc.Arbitrary<string> = fc.constantFrom(
  "Pricing",
  "plans",
  "start",
  "at",
  "$49/mo",
  "Enterprise",
  "tier",
  "SOC",
  "2",
  "Type",
  "II",
  "compliant",
  "GDPR",
  "ready",
  "99.9%",
  "uptime",
  "SLA",
  "SSO",
  "SAML",
  "free",
  "Slack",
  "integration",
  "API",
  "access",
  "security-first",
  "self-serve",
  "onboarding",
);

/**
 * Realistic, non-empty normalized content over printable ASCII only. The joined
 * words guarantee a length > 1; the optional `fc.string` suffix adds variety
 * (still printable ASCII, so still MARKER-free).
 */
const normalizedContentArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(realisticWordArb, { minLength: 3, maxLength: 30 }),
    fc.string({ maxLength: 40 }),
  )
  .map(([words, extra]) => {
    const base = words.join(" ");
    return extra.length > 0 ? `${base} ${extra}` : base;
  });

/** A non-empty slice of `content` — guaranteed grounded (a real substring). */
function presentEvidenceArb(content: string): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.nat({ max: content.length - 1 }),
      fc.integer({ min: 1, max: content.length }),
    )
    .map(([start, len]) => content.substring(start, start + len))
    .filter((slice) => slice.length >= 1);
}

/** A claimType drawn from the defined enum. */
const claimTypeArb = fc.constantFrom(...ClaimTypeEnum.options);
/** A non-empty statement (content is irrelevant to grounding). */
const statementTextArb = fc.string({ minLength: 1, maxLength: 60 });
/** A model confidence in the inclusive [0, 1] range. */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

/** A candidate claim tagged by whether its evidence is grounded. */
interface Candidate {
  kind: "present" | "absent";
  claim: Claim;
}

/** Build the full scenario: content + a guaranteed-present claim + a free mix. */
const scenarioArb = normalizedContentArb.chain((normalizedContent) => {
  const presentClaimArb: fc.Arbitrary<Candidate> = fc
    .record({
      claimType: claimTypeArb,
      statementText: statementTextArb,
      evidenceText: presentEvidenceArb(normalizedContent),
      confidence: confidenceArb,
    })
    .map((claim) => ({ kind: "present" as const, claim }));

  const absentClaimArb: fc.Arbitrary<Candidate> = fc
    .record({
      claimType: claimTypeArb,
      statementText: statementTextArb,
      sentinel: fc.uuid(),
      confidence: confidenceArb,
    })
    .map(({ sentinel, ...rest }) => ({
      kind: "absent" as const,
      // The MARKER byte guarantees this evidence is absent from the content.
      claim: { ...rest, evidenceText: `${MARKER}ABSENT-${sentinel}${MARKER}` },
    }));

  const anyClaimArb = fc.oneof(presentClaimArb, absentClaimArb);

  return fc.record({
    normalizedContent: fc.constant(normalizedContent),
    // `firstPresent` guarantees ≥ 1 grounded claim so the assertion that
    // grounded claims survive (filter isn't dropping everything) is meaningful.
    firstPresent: presentClaimArb,
    rest: fc.array(anyClaimArb, { minLength: 0, maxLength: 10 }),
  });
});

describe("Property 19: extracted claims are grounded in the normalized content (Requirements 13.5)", () => {
  it("returns only claims whose evidenceText is a substring; never the absent ones; keeps grounded ones in order", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ normalizedContent, firstPresent, rest }) => {
        const candidates: Candidate[] = [firstPresent, ...rest];

        // Pre-conditions of the scenario the harness must uphold.
        const presentCandidates = candidates.filter((c) => c.kind === "present");
        const absentCandidates = candidates.filter((c) => c.kind === "absent");
        expect(presentCandidates.length).toBeGreaterThanOrEqual(1);
        for (const c of presentCandidates) {
          expect(normalizedContent.includes(c.claim.evidenceText)).toBe(true);
        }
        for (const c of absentCandidates) {
          expect(normalizedContent.includes(c.claim.evidenceText)).toBe(false);
        }

        const model = fakeModelReturning(
          JSON.stringify(candidates.map((c) => c.claim)),
        );

        const returned = await extractClaims({ normalizedContent, model });

        // CORE INVARIANT (13.5): every returned claim is grounded.
        for (const claim of returned) {
          expect(normalizedContent.includes(claim.evidenceText)).toBe(true);
        }

        // None of the deliberately-absent claims are ever returned.
        const absentEvidence = new Set(
          absentCandidates.map((c) => c.claim.evidenceText),
        );
        for (const claim of returned) {
          expect(absentEvidence.has(claim.evidenceText)).toBe(false);
        }

        // Grounded claims ARE returned, in order — the filter isn't just
        // dropping everything. Compare on evidenceText (strings round-trip
        // through JSON exactly), which also pins length === present count.
        expect(returned.map((c) => c.evidenceText)).toEqual(
          presentCandidates.map((c) => c.claim.evidenceText),
        );
        expect(returned.length).toBeGreaterThanOrEqual(1);
      }),
      pbtParams(),
    );
  });

  it("runs the property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
