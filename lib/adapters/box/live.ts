import "server-only";

import {
  boxClientId,
  boxClientSecret,
  boxDeveloperToken,
} from "@/lib/config/env";
import type { BoxClient } from "@/lib/adapters/types";

import { LiveBoxClient, type LiveBoxClientOptions } from "./live-box";

/**
 * Server-only entry for the live {@link BoxClient} (Box_Adapter).
 *
 * `import "server-only"` keeps the Box credentials and this client out of the
 * browser bundle (Requirement 22.1). This module's only job is to bind the real
 * Box credentials — read exclusively through `lib/config/env.ts`, never from
 * `process.env` here — to the testable {@link LiveBoxClient} core in
 * `./live-box`, which carries the folder-tree creation, type→subfolder routing,
 * upload, and idempotent 409 handling.
 *
 * Credential precedence matches `isBoxConfigured()`: a developer token is used
 * directly as a bearer token; otherwise the OAuth client id/secret pair drives
 * a client-credentials grant. The selection factory (task 6.2) constructs this
 * in live mode; uncredentialed or `DEMO_MODE` runs are routed to the demo
 * client (Requirements 10.5, 18.x).
 */
export function createLiveBoxClient(
  options: LiveBoxClientOptions = {},
): BoxClient {
  return new LiveBoxClient({
    ...options,
    developerToken: options.developerToken ?? boxDeveloperToken(),
    clientId: options.clientId ?? boxClientId(),
    clientSecret: options.clientSecret ?? boxClientSecret(),
  });
}
