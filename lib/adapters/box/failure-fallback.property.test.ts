// Feature: signalvault, Property 14: Box failure or missing credentials yields mock identifiers and continues
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { ArtifactType, BoxClient } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

// The demo Box client is `server-only`. vitest.config.mts aliases `server-only`
// to a local no-op stub (tests/stubs/server-only.ts) so this fallback adapter is
// importable and testable here directly (the production Next.js build still
// resolves the real throwing guard).
import { createDemoBoxClient } from "./demo";

/**
 * Property 14 (Validates: Requirements 10.5, 19.2):
 *
 * When the Box adapter is uncredentialed, errors, throws, or times out, the
 * workflow substitutes the demo Box client, persists MOCK storage identifiers,
 * and CONTINUES to the next step. This test exercises that fallback contract on
 * the {@link createDemoBoxClient} fallback itself:
 *
 *   - `ensureScanFolders` returns `simulated === true`, a `mock-` prefixed
 *     `scanFolderId`, and a `subfolders` record with EXACTLY the six required
 *     keys (raw, normalized, screenshots, diff, claim, report), each a `mock-`
 *     prefixed id — and never throws.
 *   - `upload` returns `simulated === true` with a `mock-` prefixed `fileId`
 *     plus a non-empty `key` and `url` — and never throws.
 *   - `folderWebLink` returns a string link (works for mock storage,
 *     Requirement 10.6 cross-reference).
 *   - DETERMINISM: identical inputs yield identical mock ids across calls,
 *     which is what lets the workflow continue-without-failure reproducibly.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** The exact six subfolder keys required by `BoxFolderSet.subfolders`. */
const EXPECTED_SUBFOLDER_KEYS = [
  "raw",
  "normalized",
  "screenshots",
  "diff",
  "claim",
  "report",
] as const;

/** Every `ArtifactType` the upload contract must accept. */
const ARTIFACT_TYPES: readonly ArtifactType[] = [
  "raw",
  "normalized",
  "screenshot",
  "diff",
  "claim",
  "report",
];

/**
 * Free-text arbitrary covering the inputs a real scan throws at the adapter:
 * ordinary names, empty/whitespace-only strings, and full-unicode content
 * (company names, file names, and artifact payloads can be arbitrary text).
 */
const textArb = fc.oneof(
  fc.string(),
  fc.constant(""),
  fc.stringOf(fc.constantFrom(" ", "\t", "\n"), { maxLength: 8 }),
  fc.fullUnicodeString(),
);

/** Upload content is either a string or a Buffer; the mock must accept both. */
const contentArb = fc.oneof(
  textArb,
  fc.uint8Array().map((bytes) => Buffer.from(bytes)),
);

const artifactTypeArb = fc.constantFrom(...ARTIFACT_TYPES);

describe("Property 14: Box failure/missing credentials yields mock identifiers and continues", () => {
  it("ensureScanFolders returns simulated mock folders with exactly the six subfolders and never throws", () => {
    fc.assert(
      fc.asyncProperty(textArb, textArb, async (companyName, scanTimestamp) => {
        const box: BoxClient = createDemoBoxClient();

        // The fallback client is selected precisely because Box has no live
        // credentials; it must report that, never claiming to be configured.
        expect(box.isConfigured()).toBe(false);
        expect(box.mode).toBe("demo");

        // Must resolve (never throw) so the workflow can continue.
        const result = await box.ensureScanFolders(companyName, scanTimestamp);

        // Simulated mock storage.
        expect(result.simulated).toBe(true);
        expect(typeof result.scanFolderId).toBe("string");
        expect(result.scanFolderId.startsWith("mock-")).toBe(true);

        // Exactly the six required keys — no more, no fewer.
        const keys = Object.keys(result.subfolders).sort();
        expect(keys).toEqual([...EXPECTED_SUBFOLDER_KEYS].sort());

        // Every subfolder id is a non-empty mock identifier.
        for (const key of EXPECTED_SUBFOLDER_KEYS) {
          const id = result.subfolders[key];
          expect(typeof id).toBe("string");
          expect(id.startsWith("mock-")).toBe(true);
        }
      }),
      pbtParams(),
    );
  });

  it("upload returns a simulated mock file (mock- fileId, non-empty key/url) and never throws", () => {
    fc.assert(
      fc.asyncProperty(
        textArb,
        artifactTypeArb,
        textArb,
        contentArb,
        async (folderId, artifactType, name, content) => {
          const box: BoxClient = createDemoBoxClient();

          const upload = await box.upload(folderId, artifactType, name, content);

          expect(upload.simulated).toBe(true);
          expect(typeof upload.fileId).toBe("string");
          expect(upload.fileId.startsWith("mock-")).toBe(true);
          // The destination folder is echoed back unchanged.
          expect(upload.folderId).toBe(folderId);
          // Both `url` and `key` are persisted by callers — must be present.
          expect(typeof upload.url).toBe("string");
          expect(upload.url.length).toBeGreaterThan(0);
          expect(typeof upload.key).toBe("string");
          expect(upload.key.length).toBeGreaterThan(0);
        },
      ),
      pbtParams(),
    );
  });

  it("folderWebLink returns a string link for mock storage (Requirement 10.6)", () => {
    fc.assert(
      fc.property(textArb, (folderId) => {
        const box: BoxClient = createDemoBoxClient();

        const link = box.folderWebLink(folderId);
        expect(typeof link).toBe("string");
        expect(link.length).toBeGreaterThan(0);
      }),
      pbtParams(),
    );
  });

  it("is deterministic: identical inputs yield identical mock ids across calls", () => {
    fc.assert(
      fc.asyncProperty(
        textArb,
        textArb,
        artifactTypeArb,
        textArb,
        contentArb,
        async (companyName, scanTimestamp, artifactType, name, content) => {
          // Two independent client instances must agree on every identifier so
          // the workflow can continue reproducibly after a Box failure.
          const a = createDemoBoxClient();
          const b = createDemoBoxClient();

          const foldersA = await a.ensureScanFolders(companyName, scanTimestamp);
          const foldersB = await b.ensureScanFolders(companyName, scanTimestamp);
          expect(foldersA).toEqual(foldersB);

          const uploadA = await a.upload(
            foldersA.scanFolderId,
            artifactType,
            name,
            content,
          );
          const uploadB = await b.upload(
            foldersB.scanFolderId,
            artifactType,
            name,
            content,
          );
          expect(uploadA).toEqual(uploadB);

          expect(a.folderWebLink(foldersA.scanFolderId)).toBe(
            b.folderWebLink(foldersB.scanFolderId),
          );
        },
      ),
      pbtParams(),
    );
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
