import { describe, expect, it } from "vitest";

import { acmeSnapshots } from "@/lib/demo";
import type { CaptureRequest } from "@/lib/adapters/types";

import {
  captureDemoRequests,
  demoScreenshotRef,
  genericSeededHtml,
  synthesizeRawHtml,
} from "./demo-capture";

/** Build a CaptureRequest with the usual demo defaults. */
function req(
  url: string,
  pageRole: CaptureRequest["pageRole"],
): CaptureRequest {
  return { url, pageRole, timeoutMs: 60_000 };
}

describe("synthesizeRawHtml", () => {
  it("wraps blank-line blocks as <p> inside a minimal document", () => {
    const html = synthesizeRawHtml("# Pricing\n\nContact sales");
    expect(html).toBe(
      "<html><body><main><p># Pricing</p><p>Contact sales</p></main></body></html>",
    );
  });

  it("collapses intra-block newlines to single spaces", () => {
    expect(synthesizeRawHtml("line one\nline two")).toBe(
      "<html><body><main><p>line one line two</p></main></body></html>",
    );
  });

  it("escapes HTML special characters", () => {
    expect(synthesizeRawHtml("a & b <tag> \"q\" 'x'")).toBe(
      "<html><body><main><p>a &amp; b &lt;tag&gt; &quot;q&quot; &#39;x&#39;</p></main></body></html>",
    );
  });

  it("is deterministic for identical input", () => {
    const content = "# Trust\n\nSOC 2 Type II";
    expect(synthesizeRawHtml(content)).toBe(synthesizeRawHtml(content));
  });
});

describe("demoScreenshotRef", () => {
  it("builds a deterministic per-role mock reference", () => {
    expect(demoScreenshotRef("pricing")).toBe("mock-screenshot-pricing");
    expect(demoScreenshotRef("trust")).toBe("mock-screenshot-trust");
  });
});

describe("captureDemoRequests", () => {
  const seededRequests: CaptureRequest[] = [
    req("https://www.dropbox.com/plans", "pricing"),
    req("https://www.dropbox.com/security", "trust"),
    req("https://www.dropbox.com/developers/documentation", "docs"),
    req("https://www.dropbox.com/jobs", "careers"),
  ];

  it("returns exactly one result per request, in order", () => {
    const results = captureDemoRequests(seededRequests);
    expect(results).toHaveLength(seededRequests.length);
    results.forEach((result, i) => {
      expect(result.url).toBe(seededRequests[i]!.url);
      expect(result.pageRole).toBe(seededRequests[i]!.pageRole);
    });
  });

  it("marks every result ok and simulated with a screenshot ref", () => {
    for (const result of captureDemoRequests(seededRequests)) {
      expect(result.ok).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.skippedReason).toBeUndefined();
      expect(result.screenshotRef).toBe(demoScreenshotRef(result.pageRole));
      expect(result.rawHtml).toBeDefined();
    }
  });

  it("defaults to the current-state content (AI-platform pivot)", () => {
    const [pricing] = captureDemoRequests([req("https://www.dropbox.com/plans", "pricing")]);
    // Current pricing seed contains the enterprise/AI language, not the free Basic tier.
    expect(pricing!.rawHtml).toContain("Contact sales for custom pricing");
    expect(pricing!.rawHtml).not.toContain("2 GB of free storage");
  });

  it("can select the previous-state content explicitly", () => {
    const [pricing] = captureDemoRequests(
      [req("https://www.dropbox.com/plans", "pricing")],
      "previous",
    );
    expect(pricing!.rawHtml).toContain("2 GB of free storage");
    expect(pricing!.rawHtml).not.toContain("Contact sales for custom pricing");
  });

  it("matches seeded sources by URL ignoring case and trailing slash", () => {
    const [result] = captureDemoRequests([
      req("HTTPS://WWW.DROPBOX.COM/PLANS/", "pricing"),
    ]);
    expect(result!.rawHtml).toContain("Contact sales for custom pricing");
  });

  it("synthesizes raw HTML from the matched seeded normalized content", () => {
    const current = acmeSnapshots.find((s) => s.state === "current")!;
    const trustSeed = current.sources.find((s) => s.pageRole === "trust")!;
    const [result] = captureDemoRequests([req("https://www.dropbox.com/security", "trust")]);
    expect(result!.rawHtml).toBe(synthesizeRawHtml(trustSeed.normalizedContent));
  });

  it("falls back to generic seeded HTML for an unmatched URL/role", () => {
    const [result] = captureDemoRequests([
      req("https://unknown.example.com/", "homepage"),
    ]);
    expect(result!.ok).toBe(true);
    expect(result!.simulated).toBe(true);
    expect(result!.rawHtml).toBe(
      genericSeededHtml("https://unknown.example.com/", "homepage"),
    );
  });

  it("never throws and returns empty output for empty input", () => {
    expect(captureDemoRequests([])).toEqual([]);
  });

  it("is deterministic across repeated calls (Requirement 18.7)", () => {
    expect(captureDemoRequests(seededRequests)).toEqual(
      captureDemoRequests(seededRequests),
    );
  });
});
