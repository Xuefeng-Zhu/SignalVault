// Feature: signalvault, Property 8: Capture yields one result per source and never throws on skips
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { guardUrl } from "@/lib/security";
import { SourceTypeEnum, type SourceType } from "@/lib/schemas";
import type { CaptureRequest, CaptureResult } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";
import {
  loopbackIPv4Arb,
  loopbackIPv6Arb,
  linkLocalIPv4Arb,
  linkLocalIPv6Arb,
  uniqueLocalIPv6Arb,
  privateIPv4Arb,
  publicIPv4Arb,
  publicHostnameArb,
} from "@/tests/arbitraries/ip";

import { LiveApifyClient } from "./live-capture";
import { captureDemoRequests } from "./demo-capture";

/**
 * Property 8 (Validates: Requirements 8.3, 8.4, 8.7):
 *
 * For ANY array of {@link CaptureRequest}s — freely mixing admissible public
 * URLs, SSRF-blocked hosts, and malformed URLs, and (for the live core) any
 * per-source upstream behavior (valid data, thrown error, non-ok response, or
 * missing fields) — `capture(requests)`:
 *   - resolves and NEVER throws/rejects (8.4, 8.7),
 *   - returns EXACTLY ONE {@link CaptureResult} per request, in input order,
 *     with each result's `url`/`pageRole` matching its request,
 *   - marks every SSRF-/malformed-rejected source as skipped (`ok === false`)
 *     with a recorded `skippedReason` and still returns results for the
 *     remaining valid sources (8.3, 8.4),
 *   - satisfies the SHAPE invariant: `ok === true` ⟺ both `rawHtml` and
 *     `screenshotRef` are present; `ok === false` ⟹ `skippedReason` is a
 *     non-empty string (8.7).
 *
 * Both adapter cores are exercised:
 *   - LIVE: {@link LiveApifyClient} with an injected, deterministic fake
 *     `fetchImpl` (no real network) whose response is selected per source.
 *   - DEMO: the pure {@link captureDemoRequests} core, which always yields
 *     `ok: true, simulated: true` data and never throws.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

const TOKEN = "test-token";

/* -------------------------------------------------------------------------- */
/* Fake fetch — deterministic, per-source upstream behavior (no real network) */
/* -------------------------------------------------------------------------- */

/** Upstream behaviors the live core must absorb without ever rejecting. */
type FetchBehavior =
  | "valid" // both raw HTML + screenshot ref  -> ok: true
  | "throw" // network/transport failure       -> ok: false
  | "non-ok" // HTTP 500                        -> ok: false
  | "empty-items" // 200 with []                -> ok: false
  | "missing-fields" // item with neither field -> ok: false
  | "html-only" // item with html, no screenshot -> ok: false
  | "screenshot-only"; // item with screenshot, no html -> ok: false

const FETCH_BEHAVIORS: FetchBehavior[] = [
  "valid",
  "throw",
  "non-ok",
  "empty-items",
  "missing-fields",
  "html-only",
  "screenshot-only",
];

/** A `Response`-like stub for the injected fetch (mirrors live-capture.test.ts). */
function jsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

/** Extract the start URL the live client encoded into the actor-run body. */
function startUrlFromInit(init?: RequestInit): string {
  try {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as {
      startUrls?: { url?: unknown }[];
    };
    const url = parsed.startUrls?.[0]?.url;
    return typeof url === "string" ? url : "";
  } catch {
    return "";
  }
}

/**
 * Build a fake `fetch` that resolves/throws synchronously based on the behavior
 * registered for the start URL it is asked to capture. Defaults to `valid` for
 * any URL not in the map. Fetch is only ever reached for guard-admitted URLs.
 */
function makeFetchImpl(behaviorByUrl: Map<string, FetchBehavior>): typeof fetch {
  const impl = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = startUrlFromInit(init);
    const behavior = behaviorByUrl.get(url) ?? "valid";
    switch (behavior) {
      case "throw":
        throw new Error(`network failure for ${url}`);
      case "non-ok":
        return jsonResponse([], { ok: false, status: 500 });
      case "empty-items":
        return jsonResponse([]);
      case "missing-fields":
        return jsonResponse([{ url }]);
      case "html-only":
        return jsonResponse([{ url, html: "<html><body>only-html</body></html>" }]);
      case "screenshot-only":
        return jsonResponse([{ url, screenshotRef: "mock-screenshot-ref" }]);
      case "valid":
      default:
        return jsonResponse([
          {
            url,
            html: "<html><body>captured</body></html>",
            screenshotRef:
              "https://api.apify.com/v2/key-value-stores/s/records/shot",
          },
        ]);
    }
  };
  return impl as unknown as typeof fetch;
}

/* -------------------------------------------------------------------------- */
/* Arbitraries                                                                */
/* -------------------------------------------------------------------------- */

/** Any of the ten Watched_Source page roles. */
const pageRoleArb: fc.Arbitrary<SourceType> = fc.constantFrom(
  ...SourceTypeEnum.options,
);

/** Wrap a bare host in an http(s) URL; wrap IPv6 literals in brackets. */
function v4Url(host: string): string {
  return `http://${host}/path`;
}
function v6Url(addr: string): string {
  return `https://[${addr}]/path`;
}

/** Admissible URLs the SSRF guard admits (public hosts). */
const admissibleUrlArb: fc.Arbitrary<string> = fc.oneof(
  publicHostnameArb.map((host) => `https://${host}/`),
  publicHostnameArb.map((host) => `http://${host}/pricing`),
  publicIPv4Arb.map(v4Url),
);

/** URLs the SSRF guard rejects (loopback / private / link-local / unique-local). */
const blockedUrlArb: fc.Arbitrary<string> = fc.oneof(
  loopbackIPv4Arb.map(v4Url),
  privateIPv4Arb.map(v4Url),
  linkLocalIPv4Arb.map(v4Url),
  loopbackIPv6Arb.map(v6Url),
  linkLocalIPv6Arb.map(v6Url),
  uniqueLocalIPv6Arb.map(v6Url),
);

/** Malformed / non-http(s) URLs the guard rejects. */
const malformedUrlArb: fc.Arbitrary<string> = fc.constantFrom(
  "not a url",
  "",
  "http://",
  "://missing-scheme",
  "justtext",
  "ftp://example.com/file",
  "file:///etc/passwd",
  "ws://example.com/socket",
);

/** Any URL: a free mix of admissible, blocked, and malformed. */
const anyUrlArb: fc.Arbitrary<string> = fc.oneof(
  admissibleUrlArb,
  blockedUrlArb,
  malformedUrlArb,
);

interface SourceSpec {
  url: string;
  pageRole: SourceType;
  timeoutMs: number;
  behavior: FetchBehavior;
}

const sourceSpecArb: fc.Arbitrary<SourceSpec> = fc.record({
  url: anyUrlArb,
  pageRole: pageRoleArb,
  // Floored at MIN_CAPTURE_TIMEOUT_MS (1000) by the client; large values
  // exercise the 60s clamp. The fake fetch resolves immediately, so the
  // timeout timer never fires and runs stay fast.
  timeoutMs: fc.integer({ min: 1000, max: 90_000 }),
  behavior: fc.constantFrom(...FETCH_BEHAVIORS),
});

/** Arrays of requests, including the empty array. */
const specsArb: fc.Arbitrary<SourceSpec[]> = fc.array(sourceSpecArb, {
  minLength: 0,
  maxLength: 8,
});

/* -------------------------------------------------------------------------- */
/* Shared invariant assertions                                                */
/* -------------------------------------------------------------------------- */

/** The shape invariant every CaptureResult must satisfy (Requirement 8.7). */
function assertShapeInvariant(result: CaptureResult): void {
  const hasArtifacts =
    typeof result.rawHtml === "string" &&
    result.rawHtml.length > 0 &&
    typeof result.screenshotRef === "string" &&
    result.screenshotRef.length > 0;

  // ok === true  ⟺  both rawHtml and screenshotRef are present.
  expect(result.ok).toBe(hasArtifacts);

  if (result.ok) {
    expect(typeof result.rawHtml).toBe("string");
    expect(result.rawHtml!.length).toBeGreaterThan(0);
    expect(typeof result.screenshotRef).toBe("string");
    expect(result.screenshotRef!.length).toBeGreaterThan(0);
  } else {
    // ok === false  ⟹  a non-empty skippedReason is recorded.
    expect(typeof result.skippedReason).toBe("string");
    expect(result.skippedReason!.length).toBeGreaterThan(0);
  }
}

/** Cardinality + ordering + per-result url/pageRole correspondence. */
function assertCardinalityAndOrder(
  requests: CaptureRequest[],
  results: CaptureResult[],
): void {
  expect(results).toHaveLength(requests.length);
  results.forEach((result, i) => {
    expect(result.url).toBe(requests[i]!.url);
    expect(result.pageRole).toBe(requests[i]!.pageRole);
  });
}

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

describe("Property 8: capture yields one result per source and never throws (Requirements 8.3, 8.4, 8.7)", () => {
  it("LIVE core: never rejects; one result per source; shape + skip invariants hold", async () => {
    await fc.assert(
      fc.asyncProperty(specsArb, async (specs) => {
        const requests: CaptureRequest[] = specs.map((s) => ({
          url: s.url,
          pageRole: s.pageRole,
          timeoutMs: s.timeoutMs,
        }));

        // Last-writer-wins behavior map keyed by URL (duplicates collapse).
        const behaviorByUrl = new Map<string, FetchBehavior>();
        for (const s of specs) behaviorByUrl.set(s.url, s.behavior);

        const client = new LiveApifyClient({
          token: TOKEN,
          fetchImpl: makeFetchImpl(behaviorByUrl),
        });

        // Must resolve, never reject (8.4, 8.7).
        const results = await client.capture(requests);

        assertCardinalityAndOrder(requests, results);

        results.forEach((result, i) => {
          assertShapeInvariant(result);
          // The live core never fabricates demo data.
          expect(result.simulated).toBe(false);

          const url = requests[i]!.url;
          const admitted = guardUrl(url).ok;

          if (!admitted) {
            // 8.3: every rejected source is skipped with a recorded reason.
            expect(result.ok).toBe(false);
            expect(result.skippedReason!.length).toBeGreaterThan(0);
          } else if ((behaviorByUrl.get(url) ?? "valid") === "valid") {
            // 8.4: valid sources still produce captured results alongside skips.
            expect(result.ok).toBe(true);
            expect(result.rawHtml!.length).toBeGreaterThan(0);
            expect(result.screenshotRef!.length).toBeGreaterThan(0);
          }
          // Admitted + non-"valid" behavior => an isolated upstream failure;
          // the shape invariant above already pins it to ok:false + reason.
        });
      }),
      pbtParams(),
    );
  });

  it("DEMO core: never throws; one ok+simulated result per source", () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const requests: CaptureRequest[] = specs.map((s) => ({
          url: s.url,
          pageRole: s.pageRole,
          timeoutMs: s.timeoutMs,
        }));

        // captureDemoRequests is pure and must never throw for any input.
        const results = captureDemoRequests(requests);

        assertCardinalityAndOrder(requests, results);

        for (const result of results) {
          assertShapeInvariant(result);
          // Demo always succeeds with simulated data (8.6/19.1 territory),
          // which by the shape invariant means ok:true with both artifacts.
          expect(result.ok).toBe(true);
          expect(result.simulated).toBe(true);
          expect(result.skippedReason).toBeUndefined();
        }
      }),
      pbtParams(),
    );
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
