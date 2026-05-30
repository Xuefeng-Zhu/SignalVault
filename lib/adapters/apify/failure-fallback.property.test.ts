// Feature: signalvault, Property 9: Apify failure or missing credentials produces simulated snapshots and continues
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { SourceTypeEnum, type SourceType } from "@/lib/schemas";
import type { SnapshotState } from "@/lib/demo";
import type { CaptureRequest } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { captureDemoRequests, demoScreenshotRef } from "./demo-capture";

/**
 * Property 9 (Validates: Requirements 8.6, 19.1):
 *
 * For any set of watched sources, when the Apify adapter is uncredentialed,
 * errors, throws, or times out, every affected source receives demo snapshot
 * data flagged `simulated = true` and the workflow proceeds to the next step.
 *
 * The pure `captureDemoRequests` IS the simulated fallback the system
 * substitutes whenever the Apify adapter resolves to `"demo"` (missing
 * credentials, per `resolveRunMode()`) or a live call fails (Requirement 19.1).
 * It performs no network I/O and does not validate URLs — it is the
 * deterministic substitute that lets a scan CONTINUE. So we assert the
 * substitution contract directly against it:
 *
 *   For ANY array of CaptureRequests (valid, invalid, or SSRF-looking URLs,
 *   spanning every page role), `captureDemoRequests`:
 *     1. NEVER throws (the workflow continues),
 *     2. returns exactly one result per request, preserving url + pageRole and
 *        input order,
 *     3. flags every result `simulated === true` and `ok === true` (demo
 *        snapshot data was substituted for the affected source), with a defined,
 *        non-empty `rawHtml` document and a defined `screenshotRef`, and
 *     4. records no `skippedReason` — the source is filled with simulated
 *        content rather than skipped.
 *
 * We deliberately center the property on `captureDemoRequests` rather than the
 * `DemoApifyClient` class or the selection factory: those modules pull in
 * `import "server-only"`, whose runtime guard throws under vitest. The pure
 * core carries exactly the simulated-fallback logic the server-only client
 * delegates to.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** Every page role, so requests span the full SourceType space. */
const pageRoleArb: fc.Arbitrary<SourceType> = fc.constantFrom(
  ...SourceTypeEnum.options,
);

/** The two seeded snapshot states the fallback can source content from. */
const stateArb: fc.Arbitrary<SnapshotState> = fc.constantFrom(
  "previous",
  "current",
);

/** URLs that exactly match seeded Demo_Company sources (force the URL-match path). */
const seededUrlArb = fc.constantFrom(
  "https://acme.ai/pricing",
  "https://acme.ai/trust",
  "https://docs.acme.ai",
  "https://acme.ai/careers",
  "HTTPS://ACME.AI/pricing/", // case/trailing-slash variant still matches
);

/**
 * URLs whose hosts would be REJECTED by the SSRF guard during a live capture.
 * The demo fallback does not validate them — it must still return simulated
 * `ok: true` content, demonstrating the substitute "continues" for every
 * affected source regardless of why live capture was unavailable.
 */
const ssrfLookingUrlArb = fc.constantFrom(
  "http://127.0.0.1/",
  "http://10.0.0.1/admin",
  "http://192.168.1.1/",
  "http://169.254.169.254/latest/meta-data/",
  "http://[::1]/",
  "http://localhost:8080/",
  "http://172.16.0.5/",
);

/** Plainly invalid / non-URL strings (the fallback never parses or validates). */
const invalidUrlArb = fc.oneof(
  fc.constant(""),
  fc.constant("not a url"),
  fc.constant("ftp://example.com/resource"),
  fc.constant("javascript:alert(1)"),
  fc.string(),
);

/** A varied URL space: seeded, ordinary-public, SSRF-looking, and invalid. */
const urlArb = fc.oneof(
  seededUrlArb,
  fc.webUrl(),
  ssrfLookingUrlArb,
  invalidUrlArb,
);

/** A single CaptureRequest with a varied URL, any page role, and any timeout. */
const captureRequestArb: fc.Arbitrary<CaptureRequest> = fc.record({
  url: urlArb,
  pageRole: pageRoleArb,
  timeoutMs: fc.integer({ min: 0, max: 60_000 }),
});

/** An arbitrary batch of requests, including the empty batch. */
const requestsArb = fc.array(captureRequestArb, { minLength: 0, maxLength: 12 });

/**
 * Assert the full simulated + ok + continue contract on a batch of results.
 * Factored out so both the default-state and explicit-state properties share it.
 */
function expectSimulatedFallback(
  requests: CaptureRequest[],
  results: ReturnType<typeof captureDemoRequests>,
): void {
  // (2) Exactly one result per request, preserving identity and order.
  expect(results).toHaveLength(requests.length);

  results.forEach((result, i) => {
    const request = requests[i]!;
    expect(result.url).toBe(request.url);
    expect(result.pageRole).toBe(request.pageRole);

    // (3) Demo snapshot data substituted: simulated + ok, with real content.
    expect(result.simulated).toBe(true);
    expect(result.ok).toBe(true);

    expect(result.rawHtml).toBeDefined();
    expect(typeof result.rawHtml).toBe("string");
    expect(result.rawHtml!.length).toBeGreaterThan(0);
    expect(result.rawHtml).toContain("<html><body><main>");

    expect(result.screenshotRef).toBeDefined();
    expect(result.screenshotRef).toBe(demoScreenshotRef(result.pageRole));

    // (4) No skip — the affected source is filled, not dropped.
    expect(result.skippedReason).toBeUndefined();
  });
}

describe("Property 9: Apify failure/missing credentials yields simulated snapshots and continues (Requirements 8.6, 19.1)", () => {
  it("substitutes simulated ok snapshots for any requests and never throws (default state)", () => {
    fc.assert(
      fc.property(requestsArb, (requests) => {
        // (1) Never throws — the workflow continues to the next step.
        let results!: ReturnType<typeof captureDemoRequests>;
        expect(() => {
          results = captureDemoRequests(requests);
        }).not.toThrow();

        expectSimulatedFallback(requests, results);
      }),
      pbtParams(),
    );
  });

  it("substitutes simulated ok snapshots for any requests and never throws (either seeded state)", () => {
    fc.assert(
      fc.property(requestsArb, stateArb, (requests, state) => {
        let results!: ReturnType<typeof captureDemoRequests>;
        expect(() => {
          results = captureDemoRequests(requests, state);
        }).not.toThrow();

        expectSimulatedFallback(requests, results);
      }),
      pbtParams(),
    );
  });

  it("returns simulated ok content even for SSRF-looking / invalid URLs (no validation in the fallback)", () => {
    const hostileUrlArb = fc.oneof(ssrfLookingUrlArb, invalidUrlArb);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            url: hostileUrlArb,
            pageRole: pageRoleArb,
            timeoutMs: fc.integer({ min: 0, max: 60_000 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (requests) => {
          const results = captureDemoRequests(requests);
          // Every hostile/invalid source is still substituted, never skipped.
          for (const result of results) {
            expect(result.ok).toBe(true);
            expect(result.simulated).toBe(true);
            expect(result.skippedReason).toBeUndefined();
            expect(result.rawHtml).toContain("<html><body><main>");
          }
        },
      ),
      pbtParams(),
    );
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
