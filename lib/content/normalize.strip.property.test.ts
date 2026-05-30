// Feature: signalvault, Property 10: Normalization removes script, navigation, and footer content
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { normalizeHtml } from './normalize';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

/**
 * Property 10 (Validates: Requirements 9.2):
 * For any raw HTML containing script, navigation, and footer elements with
 * identifiable marker text, the normalized content contains none of those
 * markers. Conversely, marker text placed in ordinary visible content (outside
 * any stripped element) is retained.
 *
 * Strategy: each generated document is built from a list of "items", where each
 * item embeds a unique, prefixed marker token inside one of <script>, <nav>,
 * <footer>, or ordinary visible content. Markers are disjoint by construction:
 *   - visible markers begin with "VIS_"
 *   - script markers begin with "SCR_"
 *   - nav markers begin with "NAVX_"
 *   - footer markers begin with "FOOT_"
 * Because the only place a "SCR_"/"NAVX_"/"FOOT_" marker ever appears in the
 * input is inside its stripped element, any such marker surviving into the
 * normalized output is an unambiguous, false-match-proof violation. Each marker
 * also embeds its position index so every full marker string is unique.
 *
 * Items are optionally nested inside <div>/<section> wrappers and the whole
 * document is optionally wrapped in <html><body>, so the property exercises
 * nesting, multiple occurrences, and both bare-fragment and full-document forms.
 *
 * A guaranteed-present block of visible content keeps the normalized output
 * non-empty, so the fallback-to-raw path (Requirement 9.5) is never taken and
 * the core stripping behavior (Requirement 9.2) is exercised directly.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

type ItemKind = 'script' | 'nav' | 'footer' | 'visible';

interface Item {
  kind: ItemKind;
  token: string;
  /** When true, wrap the element inside <div><section> ... </section></div>. */
  nest: boolean;
}

/** Alphanumeric token body so markers never contain whitespace or markup. */
const rawToken = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
    minLength: 6,
    maxLength: 12,
  })
  .map((chars) => chars.join(''));

const itemArb: fc.Arbitrary<Item> = fc.record({
  kind: fc.constantFrom<ItemKind>('script', 'nav', 'footer', 'visible'),
  token: rawToken,
  nest: fc.boolean(),
});

const PREFIX: Record<ItemKind, string> = {
  visible: 'VIS_',
  script: 'SCR_',
  nav: 'NAVX_',
  footer: 'FOOT_',
};

/** Build the unique, prefixed marker for an item at a given index. */
function markerFor(item: Item, index: number): string {
  return `${PREFIX[item.kind]}${index}_${item.token}`;
}

/** Render a single item into HTML, optionally nested inside wrapper elements. */
function renderItem(item: Item, marker: string): string {
  let html: string;
  switch (item.kind) {
    case 'script':
      html = `<script type="text/javascript">\n  var data = "secret ${marker} payload";\n  console.log(data);\n</script>`;
      break;
    case 'nav':
      html = `<nav aria-label="main"><ul><li><a href="/home">${marker} home</a></li><li><a href="/about">about</a></li></ul></nav>`;
      break;
    case 'footer':
      html = `<footer><div class="legal"><p>&copy; 2024 ${marker} Inc.</p></div></footer>`;
      break;
    case 'visible':
      html = `<p>Article paragraph mentioning ${marker} in the body.</p>`;
      break;
  }
  return item.nest ? `<div class="wrap"><section>${html}</section></div>` : html;
}

describe('Property 10: Normalization removes script, navigation, and footer content (Requirement 9.2)', () => {
  it('strips all script/nav/footer marker text and retains visible marker text', () => {
    fc.assert(
      fc.property(
        fc.array(itemArb, { minLength: 0, maxLength: 24 }),
        // A non-empty pool of guaranteed-visible tokens keeps normalization
        // non-empty so the raw fallback path is never exercised here.
        fc.array(rawToken, { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        (items, guaranteedVisibleTokens, wrapInBody) => {
          const strippedMarkers: string[] = [];
          const visibleMarkers: string[] = [];

          const fragments = items.map((item, index) => {
            const marker = markerFor(item, index);
            if (item.kind === 'visible') {
              visibleMarkers.push(marker);
            } else {
              strippedMarkers.push(marker);
            }
            return renderItem(item, marker);
          });

          // Guaranteed visible content (distinct index space: "g<j>").
          guaranteedVisibleTokens.forEach((token, j) => {
            const marker = `${PREFIX.visible}g${j}_${token}`;
            visibleMarkers.push(marker);
            fragments.push(`<p>Required visible content ${marker} here.</p>`);
          });

          const body = fragments.join('\n');
          const html = wrapInBody
            ? `<!DOCTYPE html><html><head><title>Doc</title></head><body>${body}</body></html>`
            : body;

          const result = normalizeHtml(html);

          // We always include visible content, so normalization must succeed
          // (never fall back to storing the raw HTML, which would contain the
          // stripped markers). This isolates Requirement 9.2 from 9.5.
          expect(result.fallbackUsed).toBe(false);

          // Core assertion (Requirement 9.2): no script/nav/footer marker
          // survives into the normalized output.
          for (const marker of strippedMarkers) {
            expect(result.normalized).not.toContain(marker);
          }

          // Complementary check: ordinary visible markers are preserved.
          for (const marker of visibleMarkers) {
            expect(result.normalized).toContain(marker);
          }
        },
      ),
      pbtParams(),
    );
  });

  it('removes deeply nested and repeated script/nav/footer elements', () => {
    fc.assert(
      fc.property(rawToken, rawToken, rawToken, (s, n, f) => {
        const scriptMarker = `SCR_${s}`;
        const navMarker = `NAVX_${n}`;
        const footerMarker = `FOOT_${f}`;
        const html = `
          <html><body>
            <main>
              <p>Visible VIS_${s} opening.</p>
              <div>
                <section>
                  <nav><div><span>${navMarker}</span></div></nav>
                  <script>const t = "${scriptMarker}";</script>
                </section>
              </div>
              <article>
                <footer><nav>${footerMarker} ${navMarker}</nav></footer>
                <script>/* ${scriptMarker} */</script>
              </article>
              <p>Visible VIS_${f} closing.</p>
            </main>
          </body></html>`;

        const { normalized, fallbackUsed } = normalizeHtml(html);

        expect(fallbackUsed).toBe(false);
        expect(normalized).not.toContain(scriptMarker);
        expect(normalized).not.toContain(navMarker);
        expect(normalized).not.toContain(footerMarker);
        // Visible content survives.
        expect(normalized).toContain(`VIS_${s}`);
        expect(normalized).toContain(`VIS_${f}`);
      }),
      pbtParams(),
    );
  });

  it('runs each property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
