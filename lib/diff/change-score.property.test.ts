// Feature: signalvault, Property 16: change_score is bounded and zero iff content is identical
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { computeDiff } from './compute';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

/**
 * Property 16 (Validates: Requirements 11.2):
 * For any pair of prior and current normalized contents, the computed
 * change_score is an integer in [0, 100], and it equals 0 if and only if the
 * prior and current normalized contents are identical.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/**
 * A string arbitrary that mixes ordinary words with edge cases the diff must
 * handle: empty strings, whitespace-only content, unicode, and markdown-ish
 * headings. fc.string() already covers arbitrary unicode code points; the
 * oneof biases generation toward the interesting structural cases.
 */
const contentArb = fc.oneof(
  fc.string(),
  fc.constant(''),
  // Whitespace-only content (spaces, tabs, newlines, CR).
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 12 }),
  // Unicode-heavy content (full unicode strings, including astral plane).
  fc.fullUnicodeString(),
  // Markdown-ish multi-line content with headings and bodies.
  fc.array(
    fc.oneof(
      fc.string().map((s) => `# ${s}`),
      fc.string(),
    ),
    { maxLength: 8 },
  ).map((lines) => lines.join('\n')),
);

describe('Property 16: change_score is bounded and zero iff content is identical (Requirement 11.2)', () => {
  it('is an integer in [0, 100] for any pair of strings', () => {
    fc.assert(
      fc.property(contentArb, contentArb, (prior, current) => {
        const { changeScore } = computeDiff(prior, current);
        expect(Number.isInteger(changeScore)).toBe(true);
        expect(changeScore).toBeGreaterThanOrEqual(0);
        expect(changeScore).toBeLessThanOrEqual(100);
      }),
      pbtParams(),
    );
  });

  it('is exactly 0 when content is identical (identical => 0)', () => {
    fc.assert(
      fc.property(contentArb, (s) => {
        expect(computeDiff(s, s).changeScore).toBe(0);
      }),
      pbtParams(),
    );
  });

  it('is strictly positive when content differs (different => > 0, completing the biconditional)', () => {
    fc.assert(
      fc.property(
        contentArb,
        contentArb,
        (a, b) => {
          // Only assert on genuinely distinct inputs.
          fc.pre(a !== b);
          expect(computeDiff(a, b).changeScore).toBeGreaterThan(0);
        },
      ),
      pbtParams(),
    );
  });

  it('runs each property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
