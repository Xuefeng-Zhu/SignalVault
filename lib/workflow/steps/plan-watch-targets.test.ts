import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CAPTURE_TIMEOUT_MS,
  CapturePlanStateSchema,
  type BaselineState,
} from "../context";
import {
  PLAN_WATCH_TARGETS_STATUS,
  planWatchTargetsCore,
} from "./plan-watch-targets";
import { makeStepDeps } from "./test-helpers";

/**
 * Unit tests for `planWatchTargetsStep`'s pure core (task 18.1, Requirements
 * 8.2, 8.3, 8.4, 23.4).
 *
 * The core runs the SSRF guard over each Watched_Source URL, builds the capture
 * plan for the admissible ones, and records SSRF rejections as skips with a
 * reason + warning. It touches no adapter, so it is exercised directly.
 */

/** A baseline state carrying `urls`, with empty diagnostics. */
function baseline(urls: BaselineState["urls"]): BaselineState {
  return {
    scanId: randomUUID(),
    workspaceId: randomUUID(),
    companyId: randomUUID(),
    companyName: "Dropbox",
    companySlug: "dropbox",
    mode: "demo",
    warnings: [],
    skipped: [],
    urls,
  };
}

describe("planWatchTargetsCore", () => {
  it("plans every admissible URL with a capped timeout and page role", async () => {
    const { deps } = makeStepDeps();
    const input = baseline([
      { url: "https://acme.example/pricing", pageRole: "pricing" },
      { url: "https://acme.example/docs", pageRole: "docs" },
      { url: "https://acme.example/", pageRole: "homepage" },
    ]);

    const out = await planWatchTargetsCore(input, deps);

    expect(CapturePlanStateSchema.safeParse(out).success).toBe(true);
    expect(out.capturePlan).toHaveLength(3);
    for (const entry of out.capturePlan) {
      expect(entry.timeoutMs).toBe(CAPTURE_TIMEOUT_MS);
      expect(entry.timeoutMs).toBeLessThanOrEqual(60_000);
    }
    // Page roles preserved in order.
    expect(out.capturePlan.map((c) => c.pageRole)).toEqual([
      "pricing",
      "docs",
      "homepage",
    ]);
    // No skips for all-admissible input.
    expect(out.skipped).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("skips SSRF-rejected URLs, records the reason, and keeps the valid ones", async () => {
    const { deps } = makeStepDeps();
    const input = baseline([
      { url: "https://public.example/pricing", pageRole: "pricing" },
      // Loopback — must be rejected by the SSRF guard (Requirement 8.2).
      { url: "http://127.0.0.1/admin", pageRole: "docs" },
      // Private range — must be rejected.
      { url: "http://10.0.0.5/internal", pageRole: "changelog" },
      { url: "https://public.example/", pageRole: "homepage" },
    ]);

    const out = await planWatchTargetsCore(input, deps);

    // Only the two public URLs are planned.
    expect(out.capturePlan.map((c) => c.url)).toEqual([
      "https://public.example/pricing",
      "https://public.example/",
    ]);

    // Both private/loopback URLs are recorded as skips with a reason.
    expect(out.skipped).toEqual([
      { url: "http://127.0.0.1/admin", reason: "loopback address" },
      { url: "http://10.0.0.5/internal", reason: "private IPv4 range" },
    ]);

    // Each skip surfaces a matching warning identifying the source (Req 8.4).
    expect(out.warnings).toEqual([
      "Skipped http://127.0.0.1/admin: loopback address",
      "Skipped http://10.0.0.5/internal: private IPv4 range",
    ]);
  });

  it("produces an empty capture plan when every URL is rejected", async () => {
    const { deps } = makeStepDeps();
    const input = baseline([
      { url: "http://127.0.0.1/", pageRole: "homepage" },
      { url: "http://192.168.1.1/", pageRole: "pricing" },
      { url: "http://169.254.1.1/", pageRole: "docs" },
    ]);

    const out = await planWatchTargetsCore(input, deps);

    expect(out.capturePlan).toEqual([]);
    expect(out.skipped).toHaveLength(3);
    expect(out.warnings).toHaveLength(3);
  });

  it("preserves pre-existing diagnostics and appends to them", async () => {
    const { deps } = makeStepDeps();
    const input: BaselineState = {
      ...baseline([
        { url: "https://public.example/", pageRole: "homepage" },
        { url: "http://127.0.0.1/", pageRole: "pricing" },
        { url: "https://public.example/docs", pageRole: "docs" },
      ]),
      warnings: ["earlier warning"],
      skipped: [{ url: "https://earlier.example", reason: "earlier skip" }],
    };

    const out = await planWatchTargetsCore(input, deps);

    expect(out.warnings[0]).toBe("earlier warning");
    expect(out.skipped[0]).toEqual({
      url: "https://earlier.example",
      reason: "earlier skip",
    });
    // Plus the new loopback skip.
    expect(out.skipped).toContainEqual({
      url: "http://127.0.0.1/",
      reason: "loopback address",
    });
  });

  it("maps to the 'scraping' status", () => {
    expect(PLAN_WATCH_TARGETS_STATUS).toBe("scraping");
  });
});
