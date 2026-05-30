import { describe, expect, it } from "vitest";

import { isEncryptedCredential } from "@/lib/security/crypto";

import {
  buildIntegrationResponse,
  buildIntegrationRow,
  buildStoredCredential,
  CREDENTIAL_MASK,
  demoMockPlaceholder,
  MissingEncryptionSecretError,
} from "./store";
import { serializeConfig } from "./schemas";

// Unit tests for the importable encrypt/mock + response-shaping logic (task
// 20.9). The credential-non-leakage property test (task 20.11) builds on these
// same functions.

const SECRET = "unit-test-encryption-secret";

describe("buildStoredCredential", () => {
  it("encrypts live credentials so the persisted value != plaintext (Req 22.3)", () => {
    const plaintext = serializeConfig("Apify", { apifyToken: "tok_live_123" });
    const stored = buildStoredCredential({
      provider: "Apify",
      plaintext,
      demoMode: false,
      secret: SECRET,
    });

    expect(stored.isMock).toBe(false);
    expect(stored.credentialCiphertext).not.toBe(plaintext);
    expect(stored.credentialCiphertext.includes("tok_live_123")).toBe(false);
    expect(isEncryptedCredential(stored.credentialCiphertext)).toBe(true);
  });

  it("stores a mock placeholder in Demo_Mode (Req 22.4)", () => {
    const plaintext = serializeConfig("Box", { developerToken: "dev_tok" });
    const stored = buildStoredCredential({
      provider: "Box",
      plaintext,
      demoMode: true,
    });

    expect(stored.isMock).toBe(true);
    expect(stored.credentialCiphertext).toBe(demoMockPlaceholder("Box"));
    expect(stored.credentialCiphertext.includes("dev_tok")).toBe(false);
    // The mock placeholder is structurally distinct from ciphertext.
    expect(isEncryptedCredential(stored.credentialCiphertext)).toBe(false);
  });

  it("throws when live storage has no encryption secret", () => {
    expect(() =>
      buildStoredCredential({
        provider: "Apify",
        plaintext: "x",
        demoMode: false,
        secret: undefined,
      }),
    ).toThrow(MissingEncryptionSecretError);
  });
});

describe("buildIntegrationRow", () => {
  it("maps to a workspace-omitted NewIntegration insert shape", () => {
    const stored = { credentialCiphertext: "v1.a.b.c.d", isMock: false };
    const row = buildIntegrationRow("Apify", stored);
    expect(row).toEqual({
      provider: "Apify",
      credentialCiphertext: "v1.a.b.c.d",
      isMock: false,
    });
  });
});

describe("buildIntegrationResponse", () => {
  it("returns only placeholders, never the secret (Req 22.2, 22.5)", () => {
    const plaintext = serializeConfig("Apify", { apifyToken: "tok_secret" });
    const stored = buildStoredCredential({
      provider: "Apify",
      plaintext,
      demoMode: false,
      secret: SECRET,
    });
    const response = buildIntegrationResponse("Apify", stored);

    expect(response).toEqual({
      provider: "Apify",
      configured: true,
      isMock: false,
      credentialMask: CREDENTIAL_MASK,
    });

    // No response value carries the plaintext or the ciphertext.
    const serialized = JSON.stringify(response);
    expect(serialized.includes("tok_secret")).toBe(false);
    expect(serialized.includes(stored.credentialCiphertext)).toBe(false);
  });

  it("reflects the mock flag for demo storage", () => {
    const stored = buildStoredCredential({
      provider: "Box",
      plaintext: serializeConfig("Box", { developerToken: "d" }),
      demoMode: true,
    });
    const response = buildIntegrationResponse("Box", stored);
    expect(response.isMock).toBe(true);
    expect(response.configured).toBe(true);
    expect(response.credentialMask).toBe(CREDENTIAL_MASK);
  });
});
