import type { Diff, DiffContent, ModifiedSection } from './types';

/**
 * Pure, deterministic diff computation for SignalVault snapshot comparison.
 *
 * Given the prior and current normalized content of a Watched_Source, this
 * module computes a {@link DiffContent}: a bounded `changeScore`, a short
 * `changeSummary`, the `addedText`/`removedText`, and per-heading
 * `modifiedSections`.
 *
 * change_score contract (Requirement 11.2):
 *   - It is always an INTEGER in the inclusive range [0, 100].
 *   - It is 0 if and only if the prior and current content are byte-for-byte
 *     identical.
 *   - Any difference (even a single character) yields a score of at least 1,
 *     and the score grows toward 100 as the proportion of changed content
 *     increases.
 *
 * No external services, randomness, time, or mutation of inputs are involved,
 * so repeated calls with the same arguments always return equal results.
 *
 * Requirements: 11.2
 */

/**
 * Above this product of token counts the exact O(n*m) LCS is skipped in favor
 * of an O(n) frequency-based dissimilarity, keeping the computation fast and
 * bounded for very large documents. The result stays in [0, 1] either way.
 */
const LCS_TOKEN_BUDGET = 2_000_000;

/** Split content into words, dropping whitespace-only tokens. */
function tokenizeWords(content: string): string[] {
  return content.split(/\s+/).filter((token) => token.length > 0);
}

/** Split content into lines, normalizing CRLF/CR to LF first. */
function splitLines(content: string): string[] {
  return content.replace(/\r\n?/g, '\n').split('\n');
}

/** Non-blank, trimmed lines used for added/removed text and counts. */
function meaningfulLines(content: string): string[] {
  return splitLines(content)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Length of the longest common subsequence of two token arrays, using a
 * rolling 1-D array (O(min(n, m)) space). Callers must respect
 * {@link LCS_TOKEN_BUDGET}.
 */
function lcsLength(a: string[], b: string[]): number {
  // Iterate so the inner (column) array tracks the shorter sequence.
  const [outer, inner] = a.length >= b.length ? [a, b] : [b, a];
  const innerLen = inner.length;
  if (innerLen === 0) return 0;

  let previous = new Array<number>(innerLen + 1).fill(0);
  let current = new Array<number>(innerLen + 1).fill(0);

  for (let i = 0; i < outer.length; i++) {
    const outerToken = outer[i];
    for (let j = 0; j < innerLen; j++) {
      current[j + 1] =
        outerToken === inner[j]
          ? (previous[j] ?? 0) + 1
          : Math.max(previous[j + 1] ?? 0, current[j] ?? 0);
    }
    [previous, current] = [current, previous];
  }

  return previous[innerLen] ?? 0;
}

/** Count of shared tokens treating each array as a multiset (O(n)). */
function multisetOverlap(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const token of a) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let overlap = 0;
  for (const token of b) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(token, remaining - 1);
    }
  }
  return overlap;
}

/**
 * Token dissimilarity ratio in [0, 1]. 0 means the token sequences share all
 * content; 1 means they share none. Derived from `1 - 2*common/(|a|+|b|)`,
 * which is the normalized edit ratio over tokens.
 */
function dissimilarityRatio(priorTokens: string[], currentTokens: string[]): number {
  const denominator = priorTokens.length + currentTokens.length;
  if (denominator === 0) {
    // Both contents are whitespace-only. They are not byte-identical (the
    // identical case is handled before this is called), so report them as
    // fully changed rather than unchanged.
    return 1;
  }

  const common =
    priorTokens.length * currentTokens.length > LCS_TOKEN_BUDGET
      ? multisetOverlap(priorTokens, currentTokens)
      : lcsLength(priorTokens, currentTokens);

  const ratio = 1 - (2 * common) / denominator;
  // Guard against floating-point drift outside the mathematical [0, 1] range.
  return Math.min(1, Math.max(0, ratio));
}

/**
 * Derive the integer change_score from prior/current content.
 *
 * Identical content scores exactly 0. Any difference scores at least 1 (so the
 * "0 iff identical" invariant holds even when the token-level ratio rounds to
 * 0, e.g. a whitespace-only edit), and at most 100.
 */
function computeChangeScore(prior: string, current: string): number {
  if (prior === current) return 0;
  const ratio = dissimilarityRatio(tokenizeWords(prior), tokenizeWords(current));
  return Math.min(100, Math.max(1, Math.round(ratio * 100)));
}

/**
 * Order-preserving multiset difference of meaningful lines. Returns lines
 * present in `currentLines` but not `priorLines` (added) and lines present in
 * `priorLines` but not `currentLines` (removed).
 */
function diffLines(
  priorLines: string[],
  currentLines: string[],
): { added: string[]; removed: string[] } {
  const added = subtractMultiset(currentLines, priorLines);
  const removed = subtractMultiset(priorLines, currentLines);
  return { added, removed };
}

/** Items of `from` not accounted for by a matching occurrence in `against`. */
function subtractMultiset(from: string[], against: string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of against) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  const result: string[] = [];
  for (const item of from) {
    const remaining = counts.get(item) ?? 0;
    if (remaining > 0) {
      counts.set(item, remaining - 1);
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * Parse markdown-ish content into a heading -> body map. Lines beginning with
 * one to six `#` characters start a new section; content before the first
 * heading is not attributed to any section. Duplicate headings have their
 * bodies concatenated, preserving document order.
 */
function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (heading === null) return;
    const body = buffer.join('\n').trim();
    const existing = sections.get(heading);
    sections.set(heading, existing === undefined ? body : `${existing}\n${body}`);
  };

  for (const line of splitLines(content)) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = (match[2] ?? '').trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Sections present (by heading) in both contents whose body changed, in prior
 * document order.
 */
function computeModifiedSections(prior: string, current: string): ModifiedSection[] {
  const priorSections = parseSections(prior);
  const currentSections = parseSections(current);
  const modified: ModifiedSection[] = [];

  for (const [heading, before] of priorSections) {
    const after = currentSections.get(heading);
    if (after !== undefined && after !== before) {
      modified.push({ heading, before, after });
    }
  }

  return modified;
}

/** Build the short human-readable summary string. */
function buildSummary(
  changeScore: number,
  addedCount: number,
  removedCount: number,
  modifiedCount: number,
): string {
  if (changeScore === 0) return 'No changes detected.';

  const parts: string[] = [];
  if (modifiedCount > 0) {
    parts.push(`${modifiedCount} section${modifiedCount === 1 ? '' : 's'} modified`);
  }
  if (addedCount > 0) {
    parts.push(`${addedCount} line${addedCount === 1 ? '' : 's'} added`);
  }
  if (removedCount > 0) {
    parts.push(`${removedCount} line${removedCount === 1 ? '' : 's'} removed`);
  }

  const detail = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  return `${changeScore}% change${detail}.`;
}

/**
 * Compute the diff content between prior and current normalized content.
 *
 * Pure and deterministic: the inputs are never mutated and the output depends
 * only on the argument strings.
 *
 * Requirements: 11.2
 */
export function computeDiff(prior: string, current: string): DiffContent {
  const changeScore = computeChangeScore(prior, current);
  const { added, removed } = diffLines(meaningfulLines(prior), meaningfulLines(current));
  const modifiedSections = computeModifiedSections(prior, current);

  return {
    changeScore,
    changeSummary: buildSummary(changeScore, added.length, removed.length, modifiedSections.length),
    addedText: added.join('\n'),
    removedText: removed.join('\n'),
    modifiedSections,
  };
}

/**
 * Compute a full {@link Diff} by attaching the compared snapshot references to
 * the pure {@link computeDiff} result. `priorSnapshotId` is null when the
 * current snapshot is an initial baseline.
 *
 * Requirements: 11.2
 */
export function makeDiff(
  prior: string,
  current: string,
  priorSnapshotId: string | null,
  currentSnapshotId: string,
): Diff {
  return {
    priorSnapshotId,
    currentSnapshotId,
    ...computeDiff(prior, current),
  };
}
