import { createHash } from 'node:crypto';

import { type Node, NodeType, parse, type HTMLElement } from 'node-html-parser';

/**
 * Content normalization for captured snapshots.
 *
 * Converts raw HTML into clean markdown/plain text so that diffing and claim
 * extraction operate on readable content. Script, style, navigation, and
 * footer elements (and their content) are stripped entirely. Two deterministic
 * SHA-256 hashes are computed: one over the raw HTML (`contentHash`) and one
 * over the normalized content (`normalizedTextHash`).
 *
 * The function is pure and deterministic: it performs no network access and
 * includes no timestamps or randomness, so equal inputs always yield equal
 * outputs and equal hashes.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

/** Structured result of normalizing a single snapshot's raw HTML. */
export interface NormalizationResult {
  /** Normalized markdown/plain-text content (or the raw text on fallback). */
  normalized: string;
  /** Deterministic SHA-256 hash (hex) of the raw HTML input. */
  contentHash: string;
  /** Deterministic SHA-256 hash (hex) of the normalized content. */
  normalizedTextHash: string;
  /** True when normalization failed or produced empty output and the raw text was stored instead. */
  fallbackUsed: boolean;
  /** Human-readable reason the fallback was used; absent on success. */
  failureReason?: string;
}

/**
 * Elements whose presence and text content must be excluded from normalized
 * output (Requirement 9.2, plus `style` for clean text). Grouped CSS selector
 * passed to the parser; matching is case-insensitive and recurses through the
 * full tree, so nested and repeated occurrences are all removed.
 */
const STRIP_SELECTOR = 'script, style, nav, footer';

/**
 * Block-level tags that introduce vertical separation in the rendered markdown.
 * Anything not listed (and not handled explicitly below) is treated as inline.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG',
  'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FORM', 'HEADER',
  'HGROUP', 'MAIN', 'OL', 'P', 'SECTION', 'TABLE', 'TBODY', 'TFOOT', 'THEAD',
  'TR',
]);

/** Compute a deterministic SHA-256 hex digest of a UTF-8 string. */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Collapse all runs of whitespace in a text node to single spaces. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === NodeType.ELEMENT_NODE;
}

/**
 * Recursively render a parsed node into markdown. Text nodes contribute
 * whitespace-collapsed text; elements are wrapped according to their tag.
 * Block elements are padded with newlines that are normalized afterward.
 */
function render(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return collapseWhitespace(node.text);
  }

  if (!isElement(node)) {
    return '';
  }

  const tag = node.tagName ? node.tagName.toUpperCase() : '';
  const inner = node.childNodes.map(render).join('');
  const trimmedInner = inner.trim();

  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(tag.charAt(1));
      return trimmedInner ? `\n\n${'#'.repeat(level)} ${trimmedInner}\n\n` : '';
    }
    case 'P':
      return trimmedInner ? `\n\n${trimmedInner}\n\n` : '';
    case 'BR':
      return '\n';
    case 'HR':
      return '\n\n---\n\n';
    case 'LI':
      return trimmedInner ? `\n- ${trimmedInner}` : '';
    case 'UL':
    case 'OL':
      return trimmedInner ? `\n\n${inner}\n\n` : '';
    case 'BLOCKQUOTE':
      return trimmedInner ? `\n\n> ${trimmedInner}\n\n` : '';
    case 'PRE': {
      // Preserve raw text content inside fenced code blocks.
      const code = node.text.replace(/\s+$/, '');
      return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : '';
    }
    case 'A': {
      const href = node.getAttribute('href');
      if (!trimmedInner) return '';
      return href ? `[${inner}](${href})` : inner;
    }
    case 'STRONG':
    case 'B':
      return trimmedInner ? `**${inner}**` : inner;
    case 'EM':
    case 'I':
      return trimmedInner ? `*${inner}*` : inner;
    case 'CODE':
      return trimmedInner ? `\`${inner}\`` : inner;
    default:
      if (BLOCK_TAGS.has(tag)) {
        return trimmedInner ? `\n\n${inner}\n\n` : '';
      }
      // Inline / unknown element: pass through its children.
      return inner;
  }
}

/**
 * Tidy the raw rendered markdown: trim trailing whitespace per line, collapse
 * repeated horizontal whitespace, limit consecutive blank lines, and trim the
 * document. Deterministic and idempotent on equal inputs.
 */
function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Convert raw HTML into normalized markdown, throwing on parse failure. */
function htmlToMarkdown(rawHtml: string): string {
  const root = parse(rawHtml);

  // Remove disallowed elements (and their content) wherever they appear.
  for (const element of root.querySelectorAll(STRIP_SELECTOR)) {
    element.remove();
  }

  // Prefer the document body when present; otherwise normalize the whole tree.
  const body = root.querySelector('body') ?? root;
  return tidy(render(body));
}

/**
 * Normalize a snapshot's raw HTML into markdown/plain text and compute the
 * raw and normalized content hashes.
 *
 * On any normalization error, or when the normalized content is empty after
 * trimming, the unmodified raw text is stored as the normalized content and a
 * failure reason is recorded (Requirement 9.5).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export function normalizeHtml(rawHtml: string): NormalizationResult {
  const contentHash = sha256Hex(rawHtml);

  let normalized: string;
  let fallbackUsed = false;
  let failureReason: string | undefined;

  try {
    const candidate = htmlToMarkdown(rawHtml);
    if (candidate.trim().length === 0) {
      // Normalization produced no usable content: fall back to the raw text.
      fallbackUsed = true;
      failureReason = 'normalized content was empty after trimming';
      normalized = rawHtml;
    } else {
      normalized = candidate;
    }
  } catch (error) {
    fallbackUsed = true;
    failureReason =
      error instanceof Error
        ? `normalization failed: ${error.message}`
        : 'normalization failed';
    normalized = rawHtml;
  }

  const normalizedTextHash = sha256Hex(normalized);

  return {
    normalized,
    contentHash,
    normalizedTextHash,
    fallbackUsed,
    ...(failureReason !== undefined ? { failureReason } : {}),
  };
}
