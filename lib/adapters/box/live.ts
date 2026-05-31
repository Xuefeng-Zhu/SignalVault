import "server-only";

import type { BoxClient } from "@/lib/adapters/types";

import { LiveBoxClient, type LiveBoxClientOptions } from "./live-box";

/**
 * Server-only entry for the live {@link BoxClient} (Box_Adapter).
 *
 * @deprecated Box storage has been replaced by InsForge Storage. This entry
 * remains for tests that exercise the LiveBoxClient logic directly. The adapter
 * factory now constructs the InsForge Storage client via `./storage/live`.
 */
export function createLiveBoxClient(
  options: LiveBoxClientOptions = {},
): BoxClient {
  return new LiveBoxClient({
    ...options,
  });
}
