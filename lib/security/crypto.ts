import "server-only";

/**
 * Server-only credential vault primitives (task 20.9, Requirements 22.1, 22.3,
 * 22.5).
 *
 * This module owns the at-rest encryption used when an Integration credential
 * is stored: the persisted value must be encrypted
 * such that it does not equal the plaintext credential (Requirement 22.3). It
 * also owns the masking primitive used to shape browser-facing responses so a
 * production credential value never reaches the browser in unmasked form
 * (Requirement 22.5).
 *
 * `import "server-only"` keeps these primitives out of the browser bundle
 * (Requirement 22.1). Under vitest, `server-only` is aliased to a no-op stub
 * (see `vitest.config.mts`), so the property test (task 20.11) can import
 * {@link encryptCredential} / {@link maskCredential} and exercise them directly
 * without weakening the production guard.
 *
 * ## Algorithm and serialized format
 *
 * - Cipher: AES-256-GCM (authenticated encryption — tampering with the stored
 *   value is detected on decrypt).
 * - Key derivation: scrypt over the server-side secret plus a per-record random
 *   16-byte salt, producing a 32-byte key. A fresh salt per encryption means
 *   the same plaintext under the same secret yields different ciphertext.
 * - Nonce: a fresh random 12-byte IV per encryption (GCM standard nonce size).
 * - Serialized form (all components base64, `.`-joined, version-tagged):
 *
 *     v1.<saltB64>.<ivB64>.<authTagB64>.<ciphertextB64>
 *
 *   The salt and IV are not secret and are stored alongside the ciphertext, as
 *   is standard; only the server-side secret (never persisted, never sent to
 *   the browser) is required to decrypt.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/** AEAD cipher used for credential encryption at rest. */
const ALGORITHM = "aes-256-gcm";
/** AES-256 key length in bytes. */
const KEY_LENGTH = 32;
/** GCM standard nonce length in bytes. */
const IV_LENGTH = 12;
/** Per-record key-derivation salt length in bytes. */
const SALT_LENGTH = 16;
/** Serialized-format version tag, so the format can evolve compatibly. */
const VERSION = "v1";

/**
 * Fixed, non-secret mask used in browser-facing responses to indicate that a
 * credential is configured WITHOUT revealing any part of it (Requirement 22.5).
 * Deliberately contains no characters drawn from any credential value.
 */
export const CREDENTIAL_MASK = "••••••••";

/**
 * Derive a 32-byte AES key from the server-side secret and a per-record salt.
 * scrypt is intentionally slow to make brute-forcing the secret expensive.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt a plaintext credential for storage at rest (Requirement 22.3).
 *
 * @param plaintext The plaintext credential value (or canonical serialization
 *   of a credential config) to protect.
 * @param secret    The server-side encryption secret (from
 *   `credentialEncryptionSecret()`); never persisted or sent to the browser.
 * @returns A version-tagged, `.`-joined base64 string
 *   `v1.<salt>.<iv>.<authTag>.<ciphertext>`. The returned value is never equal
 *   to `plaintext` (it is base64 ciphertext with random salt/IV), satisfying
 *   Requirement 22.3.
 * @throws If `secret` is empty (a real secret is required for live storage) or
 *   `plaintext` is empty.
 */
export function encryptCredential(plaintext: string, secret: string): string {
  if (secret.length === 0) {
    throw new Error("encryptCredential: a non-empty encryption secret is required");
  }
  if (plaintext.length === 0) {
    throw new Error("encryptCredential: a non-empty plaintext is required");
  }

  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(secret, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    salt.toString("base64"),
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypt a value produced by {@link encryptCredential}.
 *
 * @param serialized A `v1.<salt>.<iv>.<authTag>.<ciphertext>` string.
 * @param secret     The same server-side secret used to encrypt.
 * @returns The recovered plaintext.
 * @throws If the input is malformed, the version is unknown, or authentication
 *   fails (wrong secret or tampered ciphertext).
 */
export function decryptCredential(serialized: string, secret: string): string {
  const parts = serialized.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error("decryptCredential: malformed or unsupported ciphertext");
  }
  const [, saltB64, ivB64, authTagB64, ciphertextB64] = parts;

  const salt = Buffer.from(saltB64!, "base64");
  const iv = Buffer.from(ivB64!, "base64");
  const authTag = Buffer.from(authTagB64!, "base64");
  const ciphertext = Buffer.from(ciphertextB64!, "base64");

  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Return the fixed, non-secret {@link CREDENTIAL_MASK} for any input. Used to
 * shape browser responses: the masked indicator confirms a credential is
 * present without echoing any of its characters (Requirement 22.5). Accepting
 * the value (which is ignored) keeps call sites self-documenting and guards
 * against accidentally returning the raw value.
 */
export function maskCredential(_value?: string): string {
  return CREDENTIAL_MASK;
}

/**
 * True when `serialized` is a well-formed value produced by
 * {@link encryptCredential}. Does not attempt decryption (no secret required).
 */
export function isEncryptedCredential(serialized: string): boolean {
  const parts = serialized.split(".");
  return parts.length === 5 && parts[0] === VERSION;
}

/**
 * Constant-time equality for two UTF-8 strings. Exposed for callers that need
 * to compare secret-derived values without leaking length/timing. Returns false
 * for differing lengths.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
