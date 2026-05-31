import "server-only";

import type { NextResponse } from "next/server";

import type { IntegrationProvider } from "@/lib/adapters/types";
import { credentialEncryptionSecret } from "@/lib/config/env";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/errors";
import { requireActiveWorkspace } from "@/lib/api/workspace";

import { configSchemaFor, serializeConfig } from "./schemas";
import {
  buildIntegrationResponse,
  buildIntegrationRow,
  buildStoredCredential,
  MissingEncryptionSecretError,
} from "./store";

/**
 * Shared implementation behind `POST /api/integrations/apify` and
 * `POST /api/integrations/box` (Requirement 21.6). The per-provider route files
 * are thin wrappers that pass their {@link IntegrationProvider} here, so the
 * security-critical logic lives in exactly one place.
 *
 * Flow (Requirements 21.6, 22.2, 22.3, 22.5):
 *  1. Resolve the active workspace; unauthenticated → 401 (no scoped data).
 *  2. Validate the request body with the provider's Zod schema → 400 on failure.
 *  3. Encrypt the canonical config SERVER-SIDE as AES-256-GCM ciphertext,
 *     `isMock: false`; the persisted value never equals the plaintext (22.3).
 *  4. Upsert into the workspace-scoped `integrations` repo (onConflict
 *     workspace_id, provider).
 *  5. Return a browser response containing ONLY placeholders — never the
 *     plaintext, never the ciphertext (22.2, 22.5).
 */
export async function handleStoreIntegration(
  request: Request,
  provider: IntegrationProvider,
): Promise<NextResponse> {
  // 1. Active workspace (server-side; 401 instead of a page redirect).
  const workspace = await requireActiveWorkspace();
  if (!workspace.ok) {
    return workspace.response;
  }

  // 2. Validate the provider-specific body.
  const schema = configSchemaFor(provider);
  const parsed = await parseJsonBody(request, schema);
  if (!parsed.ok) {
    return parsed.response;
  }

  // 3. Persist an encrypted representation. The plaintext (canonical
  //    serialization of the validated config) never leaves the server.
  const plaintext = serializeConfig(provider, parsed.data);

  let stored;
  try {
    stored = buildStoredCredential({
      provider,
      plaintext,
      secret: credentialEncryptionSecret(),
    });
  } catch (error) {
    if (error instanceof MissingEncryptionSecretError) {
      // Misconfiguration: live storage requested without a secret. Do not echo
      // any secret material.
      return jsonError(
        "INTERNAL",
        "Credential encryption is not configured on the server",
      );
    }
    throw error;
  }

  // 4. Persist (array-form upsert; onConflict workspace_id, provider).
  const repo = workspace.insforge.scoped(workspace.workspace.id).integrations;
  try {
    await repo.upsert([buildIntegrationRow(provider, stored)]);
  } catch {
    return jsonError("INTERNAL", "Failed to store integration configuration");
  }

  // 5. Browser response: placeholders only (never plaintext or ciphertext).
  return jsonOk(buildIntegrationResponse(provider, stored), 200);
}
