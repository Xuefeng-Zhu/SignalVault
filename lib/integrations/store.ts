import "server-only";

/**
 * Server-only credential-storage logic for the Integration endpoints (task
 * 20.9, Requirements 22.2, 22.3, 22.5).
 *
 * This module turns a validated credential config into (a) the value persisted
 * at rest and (b) the value transmitted to the browser. It is the single place
 * that performs LIVE encryption, and it is the importable unit the
 * credential-non-leakage property test (task 20.11) exercises:
 *
 *   - {@link buildStoredCredential}  — persisted value (ciphertext).
 *   - {@link buildIntegrationResponse} — browser-facing value (only placeholders).
 *
 * `import "server-only"` keeps this out of the browser bundle (Requirement
 * 22.1); under vitest `server-only` is a no-op stub (see `vitest.config.mts`),
 * so the property test can import these functions directly.
 *
 * Invariants enforced here:
 *  - The persisted value is AES-256-GCM ciphertext and is never equal to the
 *    plaintext (Requirement 22.3).
 *  - The browser response contains only placeholders — never the plaintext and
 *    never the ciphertext (Requirements 22.2, 22.5).
 */

import type { IntegrationProvider, NewIntegration } from "@/lib/adapters/types";

import {
  CREDENTIAL_MASK,
  encryptCredential,
  maskCredential,
} from "@/lib/security/crypto";

/** The persisted credential decision for an integration row. */
export interface StoredCredential {
  /** The value written to `integrations.credential_ciphertext`. */
  credentialCiphertext: string;
  /** Whether the stored value is a mock (always false in production). */
  isMock: boolean;
}

/** Inputs to {@link buildStoredCredential}. */
export interface BuildStoredCredentialInput {
  provider: IntegrationProvider;
  /** Canonical serialization of the validated credential config (the plaintext). */
  plaintext: string;
  /**
   * The server-side encryption secret. Required (non-empty) so credentials are
   * genuinely encrypted (Requirement 22.3).
   */
  secret?: string;
}

/**
 * Decide what is persisted for an integration credential.
 *
 * Always produces AES-256-GCM ciphertext of `plaintext`, `isMock: false`. The
 * returned `credentialCiphertext` is never equal to `plaintext` (Requirement 22.3).
 *
 * @throws When storage is requested without a configured secret.
 */
export function buildStoredCredential(
  input: BuildStoredCredentialInput,
): StoredCredential {
  const secret = input.secret;
  if (secret === undefined || secret.length === 0) {
    throw new MissingEncryptionSecretError();
  }

  return {
    credentialCiphertext: encryptCredential(input.plaintext, secret),
    isMock: false,
  };
}

/**
 * Build the workspace-scoped integration insert row (array-insert convention is
 * applied by the repository). `workspaceId` is omitted because the repository
 * is already bound to a workspace.
 */
export function buildIntegrationRow(
  provider: IntegrationProvider,
  stored: StoredCredential,
): NewIntegration {
  return {
    provider,
    credentialCiphertext: stored.credentialCiphertext,
    isMock: stored.isMock,
  };
}

/**
 * The browser-facing shape returned by the integration endpoints. It confirms a
 * credential is configured WITHOUT exposing it: there is no field that carries
 * the plaintext or the ciphertext, and `credentialMask` is the fixed,
 * non-secret mask (Requirements 22.2, 22.5).
 */
export interface IntegrationResponse {
  provider: IntegrationProvider;
  /** Always true on a successful store: the credential is now configured. */
  configured: true;
  /** Whether the stored value is a mock (always false in production). */
  isMock: boolean;
  /** Fixed, non-secret mask indicating a value is present. */
  credentialMask: string;
}

/**
 * Shape the browser response for a stored integration. By construction it
 * carries only placeholders — never the plaintext, never the ciphertext
 * (Requirements 22.2, 22.5).
 */
export function buildIntegrationResponse(
  provider: IntegrationProvider,
  stored: StoredCredential,
): IntegrationResponse {
  return {
    provider,
    configured: true,
    isMock: stored.isMock,
    credentialMask: maskCredential(),
  };
}

/** Re-export for callers/tests that assert against the canonical mask. */
export { CREDENTIAL_MASK };

/**
 * Thrown when credential storage is attempted without a configured
 * server-side encryption secret. The route handler maps this to a 500
 * `INTERNAL` error without echoing any secret material.
 */
export class MissingEncryptionSecretError extends Error {
  constructor() {
    super(
      "Credential encryption secret is not configured (set CREDENTIAL_SECRET or ENCRYPTION_KEY)",
    );
    this.name = "MissingEncryptionSecretError";
  }
}
