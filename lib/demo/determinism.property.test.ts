// Feature: signalvault, Property 27: Demo Mode is deterministic across repeated scans
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ACME_DEMO_COMPANY,
  ACME_WATCHED_SOURCES,
  acmeSnapshots,
  acmeClaims,
  DEMO_VERDICT,
  DEMO_FALLBACK_VERDICT,
  buildAcmeCompany,
  buildAcmeWatchedSources,
  buildAcmeSnapshots,
  buildAcmeClaims,
  buildAcmeClaimRecords,
  buildDemoVerdict,
  buildDemoFallbackVerdict,
} from './index';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

/**
 * Property 27 (Validates: Requirements 18.7):
 * For any number of repeated Demo_Mode "scans" of the Demo_Company, the
 * produced snapshots, claims, claim statuses, and verdict are identical across
 * runs.
 *
 * The seed builders in `lib/demo` are the deterministic source for Demo_Mode
 * scans, so we model "repeated scans" as repeated builder invocations driven by
 * a fast-check arbitrary (an iteration count `n`). The contract is pinned three
 * ways for every builder:
 *  1. Determinism across calls: invoking a builder `n` times yields results that
 *     are all deeply equal to one another (and to a first reference call).
 *  2. Equality to the frozen canonical constant: each built value deep-equals
 *     the exported frozen seed (so the constant and the builder agree).
 *  3. Fresh references: each built value is NOT the same reference as the frozen
 *     constant, so a caller mutating a scan result cannot corrupt the seed and
 *     break determinism for a later scan.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** A small, genuine repetition count standing in for "number of repeated scans". */
const repetitionsArb = fc.integer({ min: 2, max: 6 });

/**
 * A builder under test: its name, the zero-arg factory, and the frozen
 * canonical constant the factory must reproduce.
 */
interface BuilderCase {
  readonly name: string;
  readonly build: () => unknown;
  readonly frozen: unknown;
}

const BUILDER_CASES: readonly BuilderCase[] = [
  { name: 'buildAcmeCompany', build: buildAcmeCompany, frozen: ACME_DEMO_COMPANY },
  { name: 'buildAcmeWatchedSources', build: buildAcmeWatchedSources, frozen: ACME_WATCHED_SOURCES },
  { name: 'buildAcmeSnapshots', build: buildAcmeSnapshots, frozen: acmeSnapshots },
  { name: 'buildAcmeClaims', build: buildAcmeClaims, frozen: acmeClaims },
  { name: 'buildDemoVerdict', build: buildDemoVerdict, frozen: DEMO_VERDICT },
  { name: 'buildDemoFallbackVerdict', build: buildDemoFallbackVerdict, frozen: DEMO_FALLBACK_VERDICT },
];

/** Indices into BUILDER_CASES, so we can also vary which builder is exercised. */
const builderIndexArb = fc.integer({ min: 0, max: BUILDER_CASES.length - 1 });

describe('Property 27: Demo Mode is deterministic across repeated scans (Requirement 18.7)', () => {
  it('every seed builder is deeply equal across repeated calls and equal to its frozen constant', () => {
    fc.assert(
      fc.property(builderIndexArb, repetitionsArb, (index, n) => {
        const testCase = BUILDER_CASES[index]!;
        const reference = testCase.build();

        // The first build must reproduce the frozen canonical seed exactly...
        expect(reference).toEqual(testCase.frozen);

        // ...and every subsequent "scan" must be deeply equal to the first and
        // to the frozen constant, demonstrating determinism across n repeats.
        for (let i = 0; i < n; i += 1) {
          const repeated = testCase.build();
          expect(repeated).toEqual(reference);
          expect(repeated).toEqual(testCase.frozen);
        }
      }),
      pbtParams(),
    );
  });

  it('builders return fresh objects, never aliasing the frozen seed', () => {
    fc.assert(
      fc.property(builderIndexArb, (index) => {
        const testCase = BUILDER_CASES[index]!;
        const a = testCase.build();
        const b = testCase.build();

        // Fresh, non-aliased structures each call: a caller mutating one scan's
        // result cannot corrupt the frozen seed or another scan's result.
        expect(a).not.toBe(testCase.frozen);
        expect(b).not.toBe(testCase.frozen);
        expect(a).not.toBe(b);

        // ...while remaining deeply equal (fresh != different value).
        expect(a).toEqual(b);
      }),
      pbtParams(),
    );
  });

  it('a sequence of mixed builder "scans" reproduces identical results regardless of order', () => {
    fc.assert(
      fc.property(
        fc.array(builderIndexArb, { minLength: 1, maxLength: 12 }),
        (indices) => {
          for (const index of indices) {
            const testCase = BUILDER_CASES[index]!;
            // Each invocation in an arbitrary interleaving still equals the seed.
            expect(testCase.build()).toEqual(testCase.frozen);
          }
        },
      ),
      pbtParams(),
    );
  });

  it('the demo verdict and fallback verdict deep-equal their constants across repeats', () => {
    fc.assert(
      fc.property(repetitionsArb, (n) => {
        for (let i = 0; i < n; i += 1) {
          expect(buildDemoVerdict()).toEqual(DEMO_VERDICT);
          expect(buildDemoFallbackVerdict()).toEqual(DEMO_FALLBACK_VERDICT);
        }
        // The fallback differs from the standard verdict only by isFallback.
        expect(buildDemoVerdict().isFallback).toBe(false);
        expect(buildDemoFallbackVerdict().isFallback).toBe(true);
      }),
      pbtParams(),
    );
  });

  it('the claim-record projection is deterministic across repeated calls', () => {
    fc.assert(
      fc.property(repetitionsArb, (n) => {
        const reference = buildAcmeClaimRecords();
        for (let i = 0; i < n; i += 1) {
          const repeated = buildAcmeClaimRecords();
          expect(repeated).toEqual(reference);
        }
      }),
      pbtParams(),
    );
  });

  it('runs each property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
