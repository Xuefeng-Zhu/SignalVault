import "server-only";

import { apifyToken } from "@/lib/config/env";
import type { ApifyClient } from "@/lib/adapters/types";

import { LiveApifyClient, type LiveApifyClientOptions } from "./live-capture";

/**
 * Server-only entry for the live {@link ApifyClient} (Apify_Adapter).
 *
 * `import "server-only"` keeps the Apify token and this client out of the
 * browser bundle (Requirement 22.1). This module's only job is to bind the real
 * Apify credential — read exclusively through `lib/config/env.ts`, never from
 * `process.env` here — to the testable {@link LiveApifyClient} core in
 * `./live-capture`, which carries the capture logic (per-URL actor run, 60s
 * cap, SSRF re-check, and per-source error isolation).
 *
 * The selection factory (task 6.2) constructs this in live mode; uncredentialed
 * or `DEMO_MODE` runs are routed to the demo client (Requirements 8.6, 18.x).
 */
export function createLiveApifyClient(
  options: LiveApifyClientOptions = {},
): ApifyClient {
  return new LiveApifyClient({
    ...options,
    token: options.token ?? apifyToken(),
  });
}
