import { guardUrl, guardResolvedUrl } from "@/lib/security";
// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the live capture logic (SSRF re-check,
// 60s timeout, result shaping, error isolation) stays unit-testable while the
// live *client entry* (`./live`) remains server-only.
import type {
  ApifyClient,
  CaptureRequest,
  CaptureResult,
  RunMode,
} from "@/lib/adapters/types";

/**
 * Testable core of the live {@link ApifyClient} (Apify_Adapter).
 *
 * Runs an Apify actor **once per URL** to capture the page's raw HTML and a
 * screenshot reference, bounded to a hard 60-second cap (Requirement 8.1).
 * Every per-source failure — SSRF rejection, HTTP error, timeout, or a run that
 * does not return BOTH raw HTML and a screenshot reference — is isolated and
 * reported as a skipped result; the batch as a whole never throws and always
 * yields exactly one {@link CaptureResult} per {@link CaptureRequest}
 * (Requirements 8.3, 8.4, 8.7).
 *
 * This module is intentionally NOT `server-only`: it holds the pure-ish logic
 * (network access is via an injected `fetch`) that the `server-only`
 * {@link import('./live')} entry binds to the real Apify token + global
 * `fetch`. Credentials are never read here directly from `process.env`; the
 * token is supplied by the constructor (Requirement 22.1).
 *
 * ## Apify integration approach
 *
 * This client talks to the **Apify REST API with `fetch`** rather than the
 * `apify-client` npm package, to keep the dependency surface minimal. It uses
 * the synchronous run endpoint
 * `POST /v2/acts/{actorId}/run-sync-get-dataset-items`, which starts an actor
 * run, waits for it to finish, and returns the run's dataset items in one call.
 *
 * The actor targeted is **`apify/puppeteer-scraper`** (id
 * `apify~puppeteer-scraper`), a general-purpose headless-Chrome scraper. We
 * hand it a single `startUrl` and a `pageFunction` that returns the rendered
 * HTML and saves a full-page screenshot into the run's default key-value store,
 * returning a fully-qualified record URL as the screenshot reference. Because
 * the actor knows its own `defaultKeyValueStoreId` at runtime, the screenshot
 * ref is assembled inside the page function and returned in the dataset item,
 * so a single dataset row carries everything we need.
 *
 * Live Apify is not exercised in this environment; the focus here is correct
 * structure, the 60s cap, and exhaustive per-source error isolation.
 */

/** Full actor name targeted for capture (URL-encoded form used in REST paths). */
export const APIFY_CAPTURE_ACTOR_ID = "apify~puppeteer-scraper";

/** Base URL for the Apify REST API. */
const APIFY_API_BASE = "https://api.apify.com/v2";

/** Absolute ceiling for a single capture, per Requirement 8.1. */
export const MAX_CAPTURE_TIMEOUT_MS = 60_000;

/** Floor so a misconfigured tiny timeout cannot make every capture fail. */
const MIN_CAPTURE_TIMEOUT_MS = 1_000;

/**
 * The `pageFunction` handed to `apify/puppeteer-scraper`. It captures the
 * rendered HTML, stores a full-page screenshot in the run's key-value store,
 * and returns a single dataset item `{ url, html, screenshotRef }`.
 *
 * Defined as a string because the actor input transports the function as
 * source text that the actor evaluates in its own runtime.
 */
const CAPTURE_PAGE_FUNCTION = `async function pageFunction(context) {
  const { page, request, Apify } = context;
  const html = await page.content();
  const key = 'screenshot-' + Date.now();
  const buffer = await page.screenshot({ fullPage: true });
  const store = await Apify.openKeyValueStore();
  await store.setValue(key, buffer, { contentType: 'image/png' });
  const env = Apify.getEnv();
  const screenshotRef =
    '${APIFY_API_BASE}/key-value-stores/' +
    env.defaultKeyValueStoreId +
    '/records/' +
    key;
  return { url: request.url, html, screenshotRef };
}`;

/** A dataset row as returned by the capture actor (defensively typed). */
interface CaptureDatasetItem {
  url?: unknown;
  html?: unknown;
  rawHtml?: unknown;
  body?: unknown;
  screenshotRef?: unknown;
  screenshotUrl?: unknown;
}

/** Construction options; defaults are bound by the server-only `./live` entry. */
export interface LiveApifyClientOptions {
  /** Apify API token. Supplied by `./live` from `apifyToken()`. */
  token?: string;
  /** Actor id (URL-encoded `username~name`). Defaults to the puppeteer scraper. */
  actorId?: string;
  /** Injectable fetch, primarily for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/** Error used to distinguish our hard timeout from upstream failures. */
class CaptureTimeoutError extends Error {
  constructor(ms: number) {
    super(`capture timed out after ${ms}ms`);
    this.name = "CaptureTimeoutError";
  }
}

/**
 * Clamp a requested timeout into `[MIN, MAX]`. Non-finite or non-positive
 * requests fall back to the 60s ceiling (Requirement 8.1).
 */
function clampTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return MAX_CAPTURE_TIMEOUT_MS;
  return Math.min(
    MAX_CAPTURE_TIMEOUT_MS,
    Math.max(MIN_CAPTURE_TIMEOUT_MS, Math.floor(timeoutMs)),
  );
}

/** Coerce a dataset field to a non-empty trimmed string, or undefined. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class LiveApifyClient implements ApifyClient {
  readonly mode: RunMode = "live";

  private readonly token: string | undefined;
  private readonly actorId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LiveApifyClientOptions = {}) {
    this.token = options.token;
    this.actorId = options.actorId ?? APIFY_CAPTURE_ACTOR_ID;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * True when an Apify token is available. The server-only entry binds the
   * default token from `apifyToken()`, so this matches `isApifyConfigured()`
   * (both reduce to "APIFY_TOKEN present and non-empty").
   */
  isConfigured(): boolean {
    return this.token !== undefined && this.token.length > 0;
  }

  /**
   * Capture every request, returning exactly one {@link CaptureResult} per
   * input in input order. Each per-source capture is fully isolated: it can
   * only resolve (never reject), so one failure can never reject the batch
   * (Requirements 8.3, 8.4, 8.7).
   */
  async capture(requests: CaptureRequest[]): Promise<CaptureResult[]> {
    return Promise.all(requests.map((request) => this.captureOne(request)));
  }

  /** Capture a single source. Always resolves; never throws. */
  private async captureOne(request: CaptureRequest): Promise<CaptureResult> {
    const { url, pageRole } = request;

    // Defensive SSRF re-check. The workflow validates before invoking the
    // adapter, but the adapter re-runs the pure guard too (Requirement 8.2).
    const guard = guardUrl(url);
    if (!guard.ok) {
      return this.skip(request, guard.reason ?? "rejected by SSRF guard");
    }

    // DNS-resolution SSRF check: resolve hostname and validate resolved IPs
    // are not in blocked private/loopback ranges (prevents DNS rebinding).
    const dnsGuard = await guardResolvedUrl(url);
    if (!dnsGuard.ok) {
      return this.skip(request, dnsGuard.reason ?? "DNS resolves to blocked IP");
    }

    // Without a token we cannot reach Apify; skip rather than throw. (The
    // selection factory routes uncredentialed runs to a fallback per
    // Requirement 8.6; this is purely defensive.)
    if (!this.isConfigured()) {
      return this.skip(request, "Apify token not configured");
    }

    const timeoutMs = clampTimeout(request.timeoutMs);

    try {
      const item = await this.runActor(url, timeoutMs);
      const rawHtml =
        nonEmptyString(item.html) ??
        nonEmptyString(item.rawHtml) ??
        nonEmptyString(item.body);
      const screenshotRef =
        nonEmptyString(item.screenshotRef) ?? nonEmptyString(item.screenshotUrl);

      // Requirement 8.7: success requires BOTH raw HTML and a screenshot ref.
      if (!rawHtml && !screenshotRef) {
        return this.skip(
          request,
          "Apify run returned neither raw HTML nor a screenshot reference",
        );
      }
      if (!rawHtml) {
        return this.skip(request, "Apify run returned no raw HTML");
      }
      if (!screenshotRef) {
        return this.skip(request, "Apify run returned no screenshot reference");
      }

      return {
        url,
        pageRole,
        ok: true,
        rawHtml,
        screenshotRef,
        simulated: false,
      };
    } catch (error) {
      return this.skip(request, this.describeError(error));
    }
  }

  /**
   * Run the actor synchronously for one URL and return its first dataset item.
   * Enforces the 60s cap with an {@link AbortController} AND a racing timeout,
   * so the cap holds even if an injected `fetch` ignores the abort signal.
   */
  private async runActor(
    url: string,
    timeoutMs: number,
  ): Promise<CaptureDatasetItem> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, rejectTimeout) => {
      timer = setTimeout(() => {
        controller.abort();
        rejectTimeout(new CaptureTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.fetchImpl(this.runSyncUrl(timeoutMs), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(this.buildActorInput(url)),
          signal: controller.signal,
        }),
        timeout,
      ]);

      if (!response.ok) {
        throw new Error(
          `Apify responded with HTTP ${response.status} ${response.statusText}`.trim(),
        );
      }

      const payload: unknown = await response.json();
      const items = Array.isArray(payload) ? payload : [];
      const first = items[0];
      if (!first || typeof first !== "object") {
        throw new Error("Apify run produced no dataset items");
      }
      return first as CaptureDatasetItem;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Synchronous run endpoint with a server-side timeout matching our cap. */
  private runSyncUrl(timeoutMs: number): string {
    const timeoutSecs = Math.max(1, Math.ceil(timeoutMs / 1000));
    return (
      `${APIFY_API_BASE}/acts/${this.actorId}/run-sync-get-dataset-items` +
      `?timeout=${timeoutSecs}`
    );
  }

  /** Build the puppeteer-scraper input for a single start URL. */
  private buildActorInput(url: string): Record<string, unknown> {
    return {
      startUrls: [{ url }],
      pageFunction: CAPTURE_PAGE_FUNCTION,
      // One page, no link following — we capture exactly the requested URL.
      maxCrawlingDepth: 0,
      maxPagesPerCrawl: 1,
      proxyConfiguration: { useApifyProxy: true },
    };
  }

  /** Build a skipped (ok = false) result; never simulated for the live client. */
  private skip(request: CaptureRequest, reason: string): CaptureResult {
    return {
      url: request.url,
      pageRole: request.pageRole,
      ok: false,
      simulated: false,
      skippedReason: reason,
    };
  }

  /** Turn any thrown value into a stable, human-readable skip reason. */
  private describeError(error: unknown): string {
    if (error instanceof CaptureTimeoutError) return error.message;
    if (error instanceof DOMException && error.name === "AbortError") {
      return "Apify request aborted";
    }
    if (error instanceof Error && error.message.length > 0) return error.message;
    return "Apify capture failed";
  }
}

/** Construct a live Apify client from explicit options (token must be supplied). */
export function createLiveApifyClient(
  options: LiveApifyClientOptions = {},
): ApifyClient {
  return new LiveApifyClient(options);
}
