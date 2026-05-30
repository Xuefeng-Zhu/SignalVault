import { z } from "zod";

import type { IntegrationProvider } from "@/lib/adapters/types";

/**
 * Zod request-body schemas for the Integration credential endpoints
 * (`POST /api/integrations/apify`, `POST /api/integrations/box`; Requirement
 * 21.6) plus the canonical serialization used before encryption.
 *
 * This module is intentionally free of `server-only` and of any crypto import,
 * so it can be reused by the route handlers AND by the property test (task
 * 20.11) without pulling in the credential vault. The actual encrypt/mock +
 * response shaping lives in the server-only `./store` module.
 *
 * Each schema is `.strict()` so unexpected keys are rejected rather than
 * silently encrypted, keeping the stored credential config well-formed.
 */

/** Apify integration config: the API token used by the live ApifyClient. */
export const ApifyConfigSchema = z
  .object({
    apifyToken: z.string().min(1, "apifyToken is required"),
  })
  .strict();

export type ApifyConfig = z.infer<typeof ApifyConfigSchema>;

/**
 * Box integration config. Box can authenticate either with a developer token
 * (used directly as a bearer) OR with an OAuth client id + secret pair (see
 * `lib/config/env.ts#isBoxConfigured`). Exactly one of those shapes must be
 * supplied.
 */
export const BoxConfigSchema = z
  .object({
    developerToken: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.developerToken !== undefined ||
      (value.clientId !== undefined && value.clientSecret !== undefined),
    {
      message:
        "Provide either developerToken, or both clientId and clientSecret",
    },
  );

export type BoxConfig = z.infer<typeof BoxConfigSchema>;

/** Discriminated union of the two providers' validated configs. */
export type IntegrationConfig =
  | { provider: "Apify"; config: ApifyConfig }
  | { provider: "Box"; config: BoxConfig };

/** The Zod schema for a given provider's request body. */
export function configSchemaFor(provider: IntegrationProvider) {
  return provider === "Apify" ? ApifyConfigSchema : BoxConfigSchema;
}

/**
 * Canonical, deterministic serialization of a validated credential config,
 * used as the plaintext that gets encrypted at rest. Keys are emitted in a
 * fixed order and `undefined` values are dropped so the same logical config
 * always serializes identically (independent of input key order).
 */
export function serializeConfig(
  provider: IntegrationProvider,
  config: ApifyConfig | BoxConfig,
): string {
  if (provider === "Apify") {
    const apify = config as ApifyConfig;
    return JSON.stringify({ apifyToken: apify.apifyToken });
  }

  const box = config as BoxConfig;
  // Emit only present keys, in a fixed order.
  const ordered: Record<string, string> = {};
  if (box.developerToken !== undefined) {
    ordered.developerToken = box.developerToken;
  }
  if (box.clientId !== undefined) {
    ordered.clientId = box.clientId;
  }
  if (box.clientSecret !== undefined) {
    ordered.clientSecret = box.clientSecret;
  }
  return JSON.stringify(ordered);
}
