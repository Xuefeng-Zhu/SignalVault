// Feature: signalvault, Property 28: Credentials never leak to the browser
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { IntegrationProvider } from "@/lib/adapters/types";
import {
  CREDENTIAL_MASK,
  isEncryptedCredential,
} from "@/lib/security/crypto";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import {
  buildIntegrationResponse,
  buildStoredCredential,
  demoMockPlaceholder,
} from "./store";
import { serializeConfig } from "./schemas";

/**
 * Property 28 (Validates: Requirements 22.2, 22.4, 22.5):
 *
 * For ANY integration credential value and EITHER operating mode, neither the
 * value persisted at rest nor the value transmitted to the browser exposes the
 * credential:
 *
 *   - PERSISTED ≠ PLAINTEXT
 *       · LIVE (Demo_Mode inactive, Req 22.3): `buildStoredCredential` returns
 *         AES-256-GCM ciphertext that is never equal to — and never contains —
 *         the plaintext; `isMock === false`; the value is a well-formed
 *         encrypted credential.
 *       · DEMO (Demo_Mode active, Req 22.4): the persisted value is the fixed
 *         `mock-<provider>-credential` placeholder, never equal to the
 *         production credential; `isMock === true`; the plaintext is discarded.
 *
 *   - BROWSER RESPONSE carries NO secret (Req 22.2, 22.5): `buildIntegrationResponse`
 *     returns only `{ provider, configured: true, isMock, credentialMask }` —
 *     `JSON.stringify(response)` contains neither the plaintext, the raw token,
 *     nor the persisted `credentialCiphertext`, and `credentialMask` is the
 *     fixed non-secret {@link CREDENTIAL_MASK}.
 *
 * These modules are `server-only`; under vitest `server-only` is aliased to a
 * no-op stub (see `vitest.config.mts`), so they are imported and exercised
 * directly. The property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/* -------------------------------------------------------------------------- */
/* Arbitraries                                                                */
/* -------------------------------------------------------------------------- */

const providerArb: fc.Arbitrary<IntegrationProvider> = fc.constantFrom(
  "Apify",
  "Box",
);

const ALNUM =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");
const DIGITS = "0123456789".split("");

/**
 * A non-trivial credential token: alphanumeric, length >= 8, and guaranteed to
 * contain at least one digit. Two reasons for the digit guarantee:
 *  - It keeps the substring (`includes`) checks meaningful (Req 22.5): the
 *    browser response's fixed keys/values (`provider`, `configured`, `isMock`,
 *    `credentialMask`, the mask, `Apify`/`Box`) contain NO digits, so a token
 *    with a digit can never be a coincidental substring of the response — a
 *    positive `includes` would be a genuine leak, not a false alarm.
 *  - It is structurally distinct from the mask (`••••••••`) and the
 *    `mock-<provider>-credential` placeholder (which contains hyphens), so a
 *    generated token never collides with either.
 */
const tokenArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...DIGITS),
    fc.array(fc.constantFrom(...ALNUM), { minLength: 7, maxLength: 39 }),
  )
  .map(([digit, rest]) => digit + rest.join(""));

/** A non-empty server-side encryption secret (AES key material, Req 22.3). */
const secretArb: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 64,
});

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe("Property 28: credentials never leak to the browser (Requirements 22.2, 22.4, 22.5)", () => {
  it("persisted value != plaintext and the browser response carries no secret, in either mode", () => {
    fc.assert(
      fc.property(
        providerArb,
        tokenArb,
        secretArb,
        fc.boolean(),
        (provider, token, secret, demoMode) => {
          // The canonical plaintext that would be encrypted at rest.
          const plaintext = serializeConfig(
            provider,
            provider === "Apify"
              ? { apifyToken: token }
              : { developerToken: token },
          );

          // Preconditions that keep the leak checks meaningful: the plaintext
          // is neither the public mask nor the demo placeholder.
          expect(plaintext).not.toBe(CREDENTIAL_MASK);
          expect(plaintext).not.toBe(demoMockPlaceholder(provider));

          const stored = demoMode
            ? buildStoredCredential({ provider, plaintext, demoMode: true })
            : buildStoredCredential({
                provider,
                plaintext,
                demoMode: false,
                secret,
              });

          if (demoMode) {
            // DEMO (Req 22.4): a fixed mock placeholder is stored, never the
            // production credential; the plaintext is never read into storage.
            expect(stored.isMock).toBe(true);
            expect(stored.credentialCiphertext).toBe(
              demoMockPlaceholder(provider),
            );
            expect(stored.credentialCiphertext).not.toBe(plaintext);
            expect(stored.credentialCiphertext.includes(token)).toBe(false);
            // The placeholder is structurally distinct from ciphertext.
            expect(isEncryptedCredential(stored.credentialCiphertext)).toBe(
              false,
            );
          } else {
            // LIVE (Req 22.3): the persisted value is encrypted and is never
            // equal to — nor contains — the plaintext or the raw token.
            expect(stored.isMock).toBe(false);
            expect(stored.credentialCiphertext).not.toBe(plaintext);
            expect(stored.credentialCiphertext.includes(plaintext)).toBe(false);
            expect(stored.credentialCiphertext.includes(token)).toBe(false);
            expect(isEncryptedCredential(stored.credentialCiphertext)).toBe(
              true,
            );
          }

          // BROWSER RESPONSE (Req 22.2, 22.5): only placeholders are returned.
          const response = buildIntegrationResponse(provider, stored);
          expect(response).toEqual({
            provider,
            configured: true,
            isMock: stored.isMock,
            credentialMask: CREDENTIAL_MASK,
          });

          const serialized = JSON.stringify(response);
          // No part of the secret reaches the browser: not the plaintext, not
          // the raw token, and not the persisted ciphertext.
          expect(serialized.includes(plaintext)).toBe(false);
          expect(serialized.includes(token)).toBe(false);
          expect(serialized.includes(stored.credentialCiphertext)).toBe(false);
        },
      ),
      pbtParams(),
    );
  });

  it("runs the property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(
      PBT_MIN_RUNS,
    );
  });
});
