import type { SnapshotState } from "@/lib/demo";
import { acmeSnapshots } from "@/lib/demo";
import type { SourceType } from "@/lib/schemas";
// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the pure capture logic stays unit-testable
// while the live/demo *clients* remain server-only.
import type { CaptureRequest, CaptureResult } from "@/lib/adapters/types";

/**
 * Pure, deterministic core of the demo Apify capture (Requirements 8.6, 18.1,
 * 19.1).
 *
 * Demo_Mode never touches the network: every {@link CaptureResult} is
 * synthesized from the deep-frozen "Dropbox" seed in `@/lib/demo`, so repeated
 * scans produce byte-for-byte identical output (Requirement 18.7). There is no
 * randomness, no clock, and no I/O anywhere in this module.
 *
 * The seed exposes only `normalizedContent` per source, so we deterministically
 * synthesize minimal raw HTML from it (`<html><body><main>…</main></body></html>`)
 * — preserving the content text so it round-trips back through normalization.
 *
 * This module is intentionally not `server-only`: it holds the pure logic that
 * the `server-only` {@link import('./demo').DemoApifyClient} delegates to.
 */

/** Snapshot state returned by the demo capture when not explicitly overridden. */
export const DEFAULT_CAPTURE_STATE: SnapshotState = "current";

/** Build the deterministic mock screenshot reference for a page role. */
export function demoScreenshotRef(pageRole: SourceType): string {
  return `mock-screenshot-${pageRole}`;
}

/** Escape the five XML/HTML special characters so content nests safely in markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert seeded normalized (markdown-ish) content into deterministic raw HTML.
 *
 * Blocks separated by blank lines become `<p>` elements (with their inner text
 * HTML-escaped and intra-block newlines collapsed to single spaces), wrapped in
 * a minimal document skeleton. The transform is a pure function of its input:
 * identical content always yields identical HTML.
 */
export function synthesizeRawHtml(normalizedContent: string): string {
  const blocks = normalizedContent
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const body = blocks
    .map((block) => `<p>${escapeHtml(block.replace(/\s*\n\s*/g, " "))}</p>`)
    .join("");

  return `<html><body><main>${body}</main></body></html>`;
}

/**
 * Deterministic generic HTML for a request that matches no seeded source (e.g.
 * a `homepage` request, or any URL outside the Demo_Company). The demo capture
 * never fails (Requirement 19.1), so unmatched sources still get `ok: true`
 * simulated content rather than a skip.
 */
export function genericSeededHtml(url: string, pageRole: SourceType): string {
  const heading = escapeHtml(pageRole);
  const safeUrl = escapeHtml(url);
  return (
    `<html><body><main>` +
    `<h1>${heading}</h1>` +
    `<p>Seeded demo content for ${safeUrl}.</p>` +
    `</main></body></html>`
  );
}

/** Normalize a URL for seed matching: trimmed, lower-cased, no trailing slash. */
function canonicalUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

interface SeededSource {
  url: string;
  pageRole: SourceType;
  normalizedContent: string;
}

/** Index the seeded sources for one snapshot state by canonical URL and by page role. */
function indexState(state: SnapshotState): {
  byUrl: Map<string, SeededSource>;
  byRole: Map<SourceType, SeededSource>;
} {
  const byUrl = new Map<string, SeededSource>();
  const byRole = new Map<SourceType, SeededSource>();

  const snapshot = acmeSnapshots.find((snap) => snap.state === state);
  if (snapshot) {
    for (const source of snapshot.sources) {
      const seeded: SeededSource = {
        url: source.url,
        pageRole: source.pageRole,
        normalizedContent: source.normalizedContent,
      };
      byUrl.set(canonicalUrl(source.url), seeded);
      // First seeded source for a role wins; the seed has one source per role.
      if (!byRole.has(source.pageRole)) {
        byRole.set(source.pageRole, seeded);
      }
    }
  }

  return { byUrl, byRole };
}

/**
 * Capture every request against the seeded Demo_Company snapshot, returning
 * exactly one {@link CaptureResult} per request in input order.
 *
 * Matching prefers an exact (canonical) URL match, then falls back to the page
 * role; an unmatched request gets deterministic generic HTML. Every result is
 * `ok: true, simulated: true` and never throws (Requirements 8.6, 18.1, 19.1).
 *
 * @param state Which seeded snapshot state to source content from. Defaults to
 *   `"current"` so a demo scan diffs against a prior `"previous"` snapshot and
 *   surfaces the upmarket shift.
 */
export function captureDemoRequests(
  requests: CaptureRequest[],
  state: SnapshotState = DEFAULT_CAPTURE_STATE,
): CaptureResult[] {
  const { byUrl, byRole } = indexState(state);

  return requests.map((request) => {
    const match =
      byUrl.get(canonicalUrl(request.url)) ?? byRole.get(request.pageRole);

    const rawHtml = match
      ? synthesizeRawHtml(match.normalizedContent)
      : genericSeededHtml(request.url, request.pageRole);

    return {
      url: request.url,
      pageRole: request.pageRole,
      ok: true,
      rawHtml,
      screenshotRef: demoScreenshotRef(request.pageRole),
      simulated: true,
    };
  });
}
