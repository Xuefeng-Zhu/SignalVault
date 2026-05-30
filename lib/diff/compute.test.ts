import { describe, expect, it } from 'vitest';

import { computeDiff, makeDiff } from './compute';

describe('computeDiff change_score invariants (Requirement 11.2)', () => {
  it('is exactly 0 for identical content', () => {
    expect(computeDiff('', '').changeScore).toBe(0);
    expect(computeDiff('hello world', 'hello world').changeScore).toBe(0);
    const multiline = '# Pricing\n\n$10 per seat\n\n# Security\n\nSOC 2';
    expect(computeDiff(multiline, multiline).changeScore).toBe(0);
  });

  it('is strictly greater than 0 for any difference', () => {
    expect(computeDiff('a', 'b').changeScore).toBeGreaterThan(0);
    // Whitespace-only difference: token ratio rounds to 0 but score must be >= 1.
    expect(computeDiff('hello world', 'hello  world').changeScore).toBeGreaterThanOrEqual(1);
    expect(computeDiff('hello', 'hello ').changeScore).toBeGreaterThanOrEqual(1);
  });

  it('produces an integer within [0, 100]', () => {
    const samples: Array<[string, string]> = [
      ['', 'something new entirely'],
      ['old content here', ''],
      ['the quick brown fox', 'a totally different sentence'],
      ['shared words remain shared', 'shared words remain mostly shared too'],
    ];
    for (const [prior, current] of samples) {
      const { changeScore } = computeDiff(prior, current);
      expect(Number.isInteger(changeScore)).toBe(true);
      expect(changeScore).toBeGreaterThanOrEqual(0);
      expect(changeScore).toBeLessThanOrEqual(100);
    }
  });

  it('scores fully disjoint content near the maximum', () => {
    const { changeScore } = computeDiff('alpha beta gamma', 'delta epsilon zeta');
    expect(changeScore).toBe(100);
  });

  it('scores a small edit lower than a large edit', () => {
    const base = 'one two three four five six seven eight nine ten';
    const small = computeDiff(base, 'one two three four five six seven eight nine TEN').changeScore;
    const large = computeDiff(base, 'one two three').changeScore;
    expect(small).toBeLessThan(large);
  });

  it('is deterministic and does not mutate inputs', () => {
    const prior = '# Heading\n\nbody text';
    const current = '# Heading\n\nchanged body';
    const a = computeDiff(prior, current);
    const b = computeDiff(prior, current);
    expect(a).toEqual(b);
    expect(prior).toBe('# Heading\n\nbody text');
    expect(current).toBe('# Heading\n\nchanged body');
  });
});

describe('computeDiff text extraction', () => {
  it('captures added and removed lines', () => {
    const prior = 'line a\nline b\nline c';
    const current = 'line a\nline d\nline c';
    const result = computeDiff(prior, current);
    expect(result.addedText).toContain('line d');
    expect(result.removedText).toContain('line b');
    expect(result.addedText).not.toContain('line a');
    expect(result.removedText).not.toContain('line a');
  });

  it('reports modified sections by shared heading', () => {
    const prior = '# Pricing\n\n$10 per seat\n\n# Security\n\nSOC 2 in progress';
    const current = '# Pricing\n\n$25 per seat\n\n# Security\n\nSOC 2 in progress';
    const result = computeDiff(prior, current);
    expect(result.modifiedSections).toHaveLength(1);
    expect(result.modifiedSections[0]).toEqual({
      heading: 'Pricing',
      before: '$10 per seat',
      after: '$25 per seat',
    });
  });

  it('summarizes no-change as such', () => {
    expect(computeDiff('same', 'same').changeSummary).toBe('No changes detected.');
  });

  it('includes the score in the change summary when content differs', () => {
    const result = computeDiff('alpha beta', 'gamma delta');
    expect(result.changeSummary).toContain('%');
    expect(result.changeSummary).toContain(String(result.changeScore));
  });
});

describe('makeDiff snapshot references', () => {
  it('attaches prior and current snapshot ids', () => {
    const diff = makeDiff('old text', 'new text', 'snap-prior', 'snap-current');
    expect(diff.priorSnapshotId).toBe('snap-prior');
    expect(diff.currentSnapshotId).toBe('snap-current');
    expect(diff.changeScore).toBeGreaterThan(0);
  });

  it('allows a null prior snapshot id for a baseline', () => {
    const diff = makeDiff('', 'baseline content', null, 'snap-current');
    expect(diff.priorSnapshotId).toBeNull();
    expect(diff.currentSnapshotId).toBe('snap-current');
  });
});
