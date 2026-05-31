import "server-only";

import {
  insforgeApiKey,
  insforgeApiUrl,
  storageBucketName,
} from "@/lib/config/env";
import type { BoxClient } from "@/lib/adapters/types";

import {
  InsForgeStorageClient,
  type InsForgeStorageClientOptions,
} from "./live-storage";

/**
 * Server-only entry for the InsForge Storage-backed {@link BoxClient}.
 *
 * `import "server-only"` keeps the InsForge API key out of the browser bundle.
 * This module binds the real InsForge credentials — read exclusively through
 * `lib/config/env.ts` — to the testable {@link InsForgeStorageClient} core.
 *
 * The evidence bucket must already exist on the InsForge project (created via
 * CLI or API). The default bucket name is "evidence".
 */
export function createLiveStorageClient(
  options: Partial<InsForgeStorageClientOptions> = {},
): BoxClient {
  const apiUrl = options.apiUrl ?? insforgeApiUrl();
  const apiKey = options.apiKey ?? insforgeApiKey();

  if (!apiUrl || !apiKey) {
    throw new Error(
      "InsForge storage requires INSFORGE_API_URL and INSFORGE_API_KEY to be set.",
    );
  }

  return new InsForgeStorageClient({
    apiUrl,
    apiKey,
    bucketName: options.bucketName ?? storageBucketName(),
    accessToken: options.accessToken,
  });
}
