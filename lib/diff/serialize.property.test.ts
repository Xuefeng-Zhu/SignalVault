// Feature: signalvault, Property 17: Diff serialization round-trips
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { deserializeDiff, renderDiffForViewer, serializeDiff } from './serialize';
import type { Diff, ModifiedSection } from './types';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

/**
 * Property 17 (Validates: Requirements 12.1, 12.2, 12.3):
 * For any computed Diff, deserializing the artifact produced by serializing
 * that Diff yields a Diff that
 *   - references the same prior snapshot and current snapshot,
 *   - contains the same set of detected changes, and
 *   - renders identical content in the DiffViewer
 * as the original Diff. This is exactly the design's equivalence definition for
 * the serialize -> deserialize round-trip (Requirement 12.3).
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/**
 * A string arbitrary mixing ordinary text with edge cases the serializer must
 * survive: empty strings, whitespace, unicode (including astral-plane code
 * points), and characters that are significant inside JSON (quotes, backslashes,
 * newlines). fc.fullUnicodeString covers the full code-point range; the oneof
 * biases toward the structurally interesting cases.
 */
const textArb = fc.oneof(
  fc.string(),
  fc.constant(''),
  fc.fullUnicodeString(),
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 8 }),
  // JSON-significant characters that must be escaped/unescaped correctly.
  fc.stringOf(fc.constantFrom('"', '\\', '{', '}', '[', ']', ':', ',', '\n'), {
    maxLength: 12,
  }),
);

/** A single modified section: heading, before, and after bodies. */
const modifiedSectionArb: fc.Arbitrary<ModifiedSection> = fc.record({
  heading: textArb,
  before: textArb,
  after: textArb,
});

/**
 * A valid Diff arbitrary:
 *   - priorSnapshotId: string | null (null models an initial baseline),
 *   - currentSnapshotId: string,
 *   - changeScore: integer in [0, 100],
 *   - changeSummary/addedText/removedText: arbitrary (incl. unicode/empty) text,
 *   - modifiedSections: ordered array (incl. empty and several entries).
 */
const diffArb: fc.Arbitrary<Diff> = fc.record({
  priorSnapshotId: fc.option(fc.string(), { nil: null }),
  currentSnapshotId: fc.string(),
  changeScore: fc.integer({ min: 0, max: 100 }),
  changeSummary: textArb,
  addedText: textArb,
  removedText: textArb,
  // maxLength > 1 exercises both the empty array and multi-entry/order cases.
  modifiedSections: fc.array(modifiedSectionArb, { maxLength: 6 }),
});

describe('Property 17: Diff serialization round-trips (Requirements 12.1, 12.2, 12.3)', () => {
  it('round-trips: same snapshot refs, same detected changes, identical viewer render', () => {
    fc.assert(
      fc.property(diffArb, (d) => {
        const d2 = deserializeDiff(serializeDiff(d));

        // 1. Same prior/current snapshot references (including null prior).
        expect(d2.priorSnapshotId).toBe(d.priorSnapshotId);
        expect(d2.currentSnapshotId).toBe(d.currentSnapshotId);

        // 2. Same set of detected changes.
        expect(d2.changeScore).toBe(d.changeScore);
        expect(d2.changeSummary).toBe(d.changeSummary);
        expect(d2.addedText).toBe(d.addedText);
        expect(d2.removedText).toBe(d.removedText);
        // modifiedSections deep-equal in order (same sequence of {heading,before,after}).
        expect(d2.modifiedSections).toEqual(d.modifiedSections);

        // 3. Renders identically in the DiffViewer (Requirement 12.3).
        expect(renderDiffForViewer(d2)).toBe(renderDiffForViewer(d));
      }),
      pbtParams(),
    );
  });

  it('throws on malformed/missing artifact input (Requirement 12.2)', () => {
    const malformed = [
      '',
      'not json',
      '{"version":2,"priorSnapshotId":null,"currentSnapshotId":"a","changeScore":0,"changeSummary":"","addedText":"","removedText":"","modifiedSections":[]}',
      // Valid JSON object missing required fields.
      '{"version":1,"currentSnapshotId":"a"}',
      // changeScore out of range.
      '{"version":1,"priorSnapshotId":null,"currentSnapshotId":"a","changeScore":101,"changeSummary":"","addedText":"","removedText":"","modifiedSections":[]}',
      // A JSON array, not an object.
      '[]',
    ];
    for (const input of malformed) {
      expect(() => deserializeDiff(input)).toThrow();
    }
  });

  it('runs each property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
