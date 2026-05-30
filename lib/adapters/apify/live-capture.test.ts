import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureRequest } from "@/lib/adapters/types";

import {
  APIFY_CAPTURE_ACTOR_ID,
  LiveApifyClient,
  MAX_CAPTURE_TIMEOUT_MS,
  createLiveApifyClient,
} from "./live-capture";

/** Build a CaptureRequest with a default 60s budget. */
function req(
  url: string,
  pageRole: CaptureRequest["pageRole"] = "homepage",
  timeoutMs = 60_000,
): CaptureRequest {
  return { url, pageRole, timeoutMs };
}

/** A `Response`-like stub for the injected fetch. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

const TOKEN = "test-token";

describe("LiveApifyClient.isConfigured", () => {
  it("is true with a non-empty token and false otherwise", () => {
    expect(new LiveApifyClient({ token: TOKEN }).isConfigured()).toBe(true);
    expect(new LiveApifyClient({ token: "" }).isConfigured()).toBe(false);
    expect(new LiveApifyClient({}).isConfigured()).toBe(false);
  });

  it("reports live mode", () => {
    expect(new LiveApifyClient({ token: TOKEN }).mode).toBe("live");
  });
});

describe("LiveApifyClient.capture — result cardinality & isolation", () => {
  it("returns exactly one result per request, in input order", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Echo the requested page URL back so we can assert ordering.
      return jsonResponse([
        { url, html: "<html><body>ok</body></html>", screenshotRef: "ref" },
      ]);
    });
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const requests = [
      req("https://a.example.com", "homepage"),
      req("https://b.example.com", "pricing"),
      req("https://c.example.com", "docs"),
    ];
    const results = await client.capture(requests);

    expect(results).toHaveLength(requests.length);
    results.forEach((r, i) => {
      expect(r.url).toBe(requests[i]!.url);
      expect(r.pageRole).toBe(requests[i]!.pageRole);
    });
  });

  it("shapes a successful capture with ok=true, simulated=false, both artifacts", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          url: "https://a.example.com",
          html: "<html><body>hi</body></html>",
          screenshotRef: "https://api.apify.com/v2/key-value-stores/s/records/shot",
        },
      ]),
    );
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("https://a.example.com", "pricing")]);

    expect(result).toMatchObject({
      url: "https://a.example.com",
      pageRole: "pricing",
      ok: true,
      simulated: false,
      rawHtml: "<html><body>hi</body></html>",
      screenshotRef: "https://api.apify.com/v2/key-value-stores/s/records/shot",
    });
    expect(result!.skippedReason).toBeUndefined();
  });

  it("never rejects the batch when one source throws; isolates the failure", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (body.includes("boom")) throw new Error("network down");
        return jsonResponse([{ html: "<html></html>", screenshotRef: "ref" }]);
      },
    );
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const results = await client.capture([
      req("https://ok.example.com"),
      req("https://boom.example.com"),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.skippedReason).toContain("network down");
    expect(results[1]!.simulated).toBe(false);
  });

  it("targets the puppeteer-scraper actor's run-sync endpoint with a bearer token", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse([{ html: "<html></html>", screenshotRef: "ref" }]),
    );
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    await client.capture([req("https://a.example.com")]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toContain(
      `/acts/${APIFY_CAPTURE_ACTOR_ID}/run-sync-get-dataset-items`,
    );
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("LiveApifyClient.capture — skip cases", () => {
  it("skips SSRF-rejected URLs without calling fetch (defensive guard)", async () => {
    const fetchImpl = vi.fn();
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("http://127.0.0.1/admin")]);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result!.ok).toBe(false);
    expect(result!.simulated).toBe(false);
    expect(result!.skippedReason).toBe("loopback address");
  });

  it("skips a malformed URL", async () => {
    const fetchImpl = vi.fn();
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("not a url")]);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toBe("malformed URL");
  });

  it("skips when no token is configured", async () => {
    const fetchImpl = vi.fn();
    const client = new LiveApifyClient({ fetchImpl });

    const [result] = await client.capture([req("https://a.example.com")]);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toBe("Apify token not configured");
  });

  it("skips when the run returns neither raw HTML nor a screenshot ref", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ url: "https://a.example.com" }]));
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("https://a.example.com")]);

    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toContain("neither raw HTML nor a screenshot");
  });

  it("skips when the run returns HTML but no screenshot ref", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ html: "<html></html>" }]),
    );
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("https://a.example.com")]);

    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toBe("Apify run returned no screenshot reference");
  });

  it("skips when the run returns a screenshot ref but no HTML", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ screenshotRef: "ref" }]));
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("https://a.example.com")]);

    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toBe("Apify run returned no raw HTML");
  });

  it("skips on a non-2xx Apify response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([], { ok: false, status: 500 }));
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("https://a.example.com")]);

    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toContain("HTTP 500");
  });

  it("skips when the run produces no dataset items", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const [result] = await client.capture([req("https://a.example.com")]);

    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toContain("no dataset items");
  });

  it("returns an empty array for empty input", async () => {
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl: vi.fn() });
    expect(await client.capture([])).toEqual([]);
  });
});

describe("LiveApifyClient.capture — 60s timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips a source whose run exceeds the cap, recording a timeout reason", async () => {
    // fetch never resolves -> the racing timeout must fire.
    const fetchImpl = vi.fn(
      () => new Promise<Response>(() => {/* never resolves */}),
    );
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const promise = client.capture([req("https://slow.example.com", "homepage", 60_000)]);
    await vi.advanceTimersByTimeAsync(MAX_CAPTURE_TIMEOUT_MS + 10);
    const [result] = await promise;

    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toContain("timed out");
    expect(result!.simulated).toBe(false);
  });

  it("clamps an over-budget timeout to the 60s ceiling", async () => {
    const fetchImpl = vi.fn(
      () => new Promise<Response>(() => {/* never resolves */}),
    );
    const client = new LiveApifyClient({ token: TOKEN, fetchImpl });

    const promise = client.capture([
      req("https://slow.example.com", "homepage", 5 * 60_000),
    ]);
    // Just past the ceiling is enough; the requested 5min was clamped to 60s.
    await vi.advanceTimersByTimeAsync(MAX_CAPTURE_TIMEOUT_MS + 10);
    const [result] = await promise;

    expect(result!.ok).toBe(false);
    expect(result!.skippedReason).toContain("60000ms");
  });
});

describe("createLiveApifyClient", () => {
  it("constructs a live client honoring injected options", () => {
    const client = createLiveApifyClient({ token: TOKEN, fetchImpl: vi.fn() });
    expect(client.mode).toBe("live");
    expect(client.isConfigured()).toBe(true);
  });
});
