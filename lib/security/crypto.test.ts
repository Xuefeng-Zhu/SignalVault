import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_MASK,
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
  maskCredential,
  safeEqual,
} from "./crypto";

// Unit tests for the credential vault primitives (task 20.9). These also
// confirm the `server-only` module is importable under vitest (it is aliased to
// a no-op stub in vitest.config.mts).

const SECRET = "test-server-side-secret-value-123";

describe("encryptCredential / decryptCredential", () => {
  it("round-trips a plaintext credential", () => {
    const plaintext = "apify_api_token_abc123";
    const ciphertext = encryptCredential(plaintext, SECRET);
    expect(decryptCredential(ciphertext, SECRET)).toBe(plaintext);
  });

  it("never produces ciphertext equal to the plaintext (Req 22.3)", () => {
    const plaintext = "super-secret-token";
    const ciphertext = encryptCredential(plaintext, SECRET);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.includes(plaintext)).toBe(false);
  });

  it("produces different ciphertext for the same plaintext (random salt + IV)", () => {
    const plaintext = "repeatable-value";
    const a = encryptCredential(plaintext, SECRET);
    const b = encryptCredential(plaintext, SECRET);
    expect(a).not.toBe(b);
    // ...but both decrypt back to the same plaintext.
    expect(decryptCredential(a, SECRET)).toBe(plaintext);
    expect(decryptCredential(b, SECRET)).toBe(plaintext);
  });

  it("is marked as encrypted by isEncryptedCredential", () => {
    const ciphertext = encryptCredential("x", SECRET);
    expect(isEncryptedCredential(ciphertext)).toBe(true);
    expect(isEncryptedCredential("mock-apify-credential")).toBe(false);
    expect(isEncryptedCredential("plain")).toBe(false);
  });

  it("fails to decrypt with the wrong secret", () => {
    const ciphertext = encryptCredential("value", SECRET);
    expect(() => decryptCredential(ciphertext, "a-different-secret")).toThrow();
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const ciphertext = encryptCredential("value", SECRET);
    const parts = ciphertext.split(".");
    // Flip the last base64 char of the ciphertext component.
    const last = parts[4]!;
    const tampered = [
      ...parts.slice(0, 4),
      (last.endsWith("A") ? last.slice(0, -1) + "B" : last.slice(0, -1) + "A"),
    ].join(".");
    expect(() => decryptCredential(tampered, SECRET)).toThrow();
  });

  it("throws on malformed serialized input", () => {
    expect(() => decryptCredential("not-a-valid-ciphertext", SECRET)).toThrow();
    expect(() => decryptCredential("v2.a.b.c.d", SECRET)).toThrow();
  });

  it("requires a non-empty secret and plaintext", () => {
    expect(() => encryptCredential("value", "")).toThrow();
    expect(() => encryptCredential("", SECRET)).toThrow();
  });
});

describe("maskCredential", () => {
  it("always returns the fixed mask regardless of input", () => {
    expect(maskCredential("anything-secret")).toBe(CREDENTIAL_MASK);
    expect(maskCredential()).toBe(CREDENTIAL_MASK);
  });
});

describe("safeEqual", () => {
  it("compares equal strings as equal and unequal as not", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
