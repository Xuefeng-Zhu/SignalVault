// Feature: signalvault, Property 11: Content hashing is deterministic
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { normalizeHtml } from './normalize';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

/**
 * Property 11 (Validates: Requirements 9.4):
 * For any snapshot content, the content hash and normalized-text hash are
 * deterministic functions of their inputs — equal inputs always produce equal
 * hashes across repeated computations.
 *
 * The contract is pinned three ways:
 *  1. Determinism: normalizeHtml(s) called twice yields identical normalized,
 *     contentHash, and normalizedTextHash.
 *  2. Correctness of contentHash: it equals the SHA-256 hex of the raw input,
 *     computed independently via node:crypto.
 *  3. Correctness of normalizedTextHash: it equals the SHA-256 hex of the
 *     returned `normalized` field.
 *  4. Distinctness (soft): clearly-distinct raw inputs produce distinct
 *     contentHash values (acknowledging SHA-256 collision resistance).
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** Independent SHA-256 hex digest of a UTF-8 string (the pinned contract). */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * An HTML/string arbitrary that mixes ordinary markup with the edge cases the
 * normalizer and hasher must handle: tags, plain text, empty strings,
 * whitespace-only content, and unicode (including astral-plane code points).
 * fc.fullUnicodeString already covers arbitrary unicode; the oneof biases
 * generation toward structurally interesting HTML.
 */
const tagNameArb = fc.constantFrom(
  'div', 'p', 'span', 'h1', 'h2', 'ul', 'li', 'a', 'strong', 'em',
  'script', 'style', 'nav', 'footer', 'section', 'article', 'br', 'pre', 'code',
);

const htmlElementArb = fc.tuple(tagNameArb, fc.fullUnicodeString({ maxLength: 24 })).map(
  ([tag, inner]) => `<${tag}>${inner}</${tag}>`,
);

const htmlDocArb = fc.array(
  fc.oneof(htmlElementArb, fc.fullUnicodeString({ maxLength: 24 })),
  { maxLength: 8 },
).map((parts) => parts.join(''));

const inputArb = fc.oneof(
  // Bare strings (arbitrary unicode).
  fc.string(),
  fc.fullUnicodeString(),
  // Empty input.
  fc.constant(''),
  // Whitespace-only content.
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 12 }),
  // Structured HTML documents.
  htmlDocArb,
);

describe('Property 11: Content hashing is deterministic (Requirement 9.4)', () => {
  it('produces identical normalized + hashes when called twice on equal input', () => {
    fc.assert(
      fc.property(inputArb, (s) => {
        const a = normalizeHtml(s);
        const b = normalizeHtml(s);
        expect(b.contentHash).toBe(a.contentHash);
        expect(b.normalizedTextHash).toBe(a.normalizedTextHash);
        expect(b.normalized).toBe(a.normalized);
      }),
      pbtParams(),
    );
  });

  it('contentHash equals SHA-256 hex of the raw input', () => {
    fc.assert(
      fc.property(inputArb, (s) => {
        expect(normalizeHtml(s).contentHash).toBe(sha256Hex(s));
      }),
      pbtParams(),
    );
  });

  it('normalizedTextHash equals SHA-256 hex of the returned normalized content', () => {
    fc.assert(
      fc.property(inputArb, (s) => {
        const { normalized, normalizedTextHash } = normalizeHtml(s);
        expect(normalizedTextHash).toBe(sha256Hex(normalized));
      }),
      pbtParams(),
    );
  });

  it('produces distinct contentHash for clearly-distinct raw inputs', () => {
    fc.assert(
      fc.property(inputArb, inputArb, (a, b) => {
        // Only assert distinctness on genuinely different raw inputs;
        // SHA-256 collision resistance makes a clash on distinct bytes
        // practically impossible.
        fc.pre(a !== b);
        expect(normalizeHtml(a).contentHash).not.toBe(normalizeHtml(b).contentHash);
      }),
      pbtParams(),
    );
  });

  it('runs each property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
