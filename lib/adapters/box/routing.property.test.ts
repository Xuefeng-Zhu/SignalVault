// Feature: signalvault, Property 12: Box artifacts are routed to the type-matched subfolder
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { ArtifactType } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { LiveBoxClient } from "./live-box";
import {
  SUBFOLDER_BOX_NAMES,
  SUBFOLDER_KEYS,
  subfolderKeyForArtifact,
  type SubfolderKey,
} from "./routing";

/**
 * Property 12 (Validates: Requirements 10.1, 10.2):
 * For any evidence artifact uploaded for a scan,
 *   - the scan folder set contains exactly the six required subfolders
 *     (raw, normalized, screenshots, diffs, claims, reports) — Requirement 10.1, and
 *   - the artifact is uploaded into the subfolder matching its type
 *     (raw HTML -> raw, normalized -> normalized, screenshot -> screenshots,
 *      diff -> diffs, claim ledger -> claims, brief -> reports) — Requirement 10.2.
 *
 * The pure `subfolderKeyForArtifact` + `SUBFOLDER_KEYS` mapping is asserted
 * directly, and the routing is exercised end-to-end through the LIVE
 * `LiveBoxClient` with an injected fake Box backend so the artifact is shown to
 * physically land in the type-matched, correctly-named Box folder.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

const DEV_TOKEN = "dev-token";

/** Every member of the six-element ArtifactType union (Requirement 10.2 mapping). */
const ARTIFACT_TYPES = [
  "raw",
  "normalized",
  "screenshot",
  "diff",
  "claim",
  "report",
] as const satisfies readonly ArtifactType[];

/** Expected key set required by `BoxFolderSet.subfolders` (Requirement 10.1). */
const EXPECTED_SUBFOLDER_KEYS: readonly SubfolderKey[] = [
  "raw",
  "normalized",
  "screenshots",
  "diff",
  "claim",
  "report",
];

/** The expected routing of each ArtifactType to its SubfolderKey. */
const EXPECTED_KEY_FOR_TYPE: Record<ArtifactType, SubfolderKey> = {
  raw: "raw",
  normalized: "normalized",
  screenshot: "screenshots",
  diff: "diff",
  claim: "claim",
  report: "report",
};

/** A `Response`-like stub for the injected fetch. */
function jsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

/**
 * A fake Box backend (adapted from live-box.test.ts): assigns deterministic ids
 * to created folders keyed by `parentId/name`, models `409 item_name_in_use` on
 * duplicate folder creation, assigns file ids on upload, and — additionally —
 * records a reverse `folderId -> name` map plus every upload's destination
 * folder id so the test can prove an artifact landed in the type-matched,
 * correctly-named folder.
 */
function fakeBox() {
  const folders = new Map<string, string>(); // "parentId/name" -> folderId
  const folderNames = new Map<string, string>(); // folderId -> name
  let folderSeq = 0;
  let fileSeq = 0;
  const uploads: Array<{ folderId: string; name: string }> = [];

  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);

    if (url.endsWith("/2.0/folders")) {
      const { name, parent } = JSON.parse(String(init?.body)) as {
        name: string;
        parent: { id: string };
      };
      const key = `${parent.id}/${name}`;
      const existing = folders.get(key);
      if (existing) {
        return jsonResponse(
          { context_info: { conflicts: [{ id: existing, type: "folder" }] } },
          { ok: false, status: 409 },
        );
      }
      folderSeq += 1;
      const id = `folder-${folderSeq}`;
      folders.set(key, id);
      folderNames.set(id, name);
      return jsonResponse({ id, name, type: "folder" });
    }

    if (url.endsWith("/files/content")) {
      const form = init?.body as FormData;
      const attributes = JSON.parse(String(form.get("attributes"))) as {
        name: string;
        parent: { id: string };
      };
      uploads.push({ folderId: attributes.parent.id, name: attributes.name });
      fileSeq += 1;
      return jsonResponse({
        entries: [{ id: `file-${fileSeq}`, name: attributes.name, type: "file" }],
      });
    }

    throw new Error(`unexpected fetch to ${url}`);
  };

  return { fetchImpl, folderNames, uploads };
}

describe("Property 12: Box artifacts are routed to the type-matched subfolder (Requirements 10.1, 10.2)", () => {
  const artifactTypeArb = fc.constantFrom<ArtifactType>(...ARTIFACT_TYPES);
  // Names exercise sanitization paths without affecting the routing decision.
  const nameArb = fc.oneof(
    fc.string(),
    fc.constant(""),
    fc.constant("   "),
    fc.fullUnicodeString(),
    fc.constantFrom("homepage.html", "brief.md", "ledger.json", "page.png"),
  );
  const contentArb = fc.oneof(
    fc.string(),
    fc.constant(""),
    fc.fullUnicodeString(),
  );

  it("pure routing: subfolderKeyForArtifact maps every type to its key, which is a member of SUBFOLDER_KEYS (Requirement 10.2)", () => {
    fc.assert(
      fc.property(artifactTypeArb, (type) => {
        const key = subfolderKeyForArtifact(type);

        // screenshot -> 'screenshots'; every other type -> identically-named key.
        expect(key).toBe(EXPECTED_KEY_FOR_TYPE[type]);
        if (type === "screenshot") {
          expect(key).toBe("screenshots");
        } else {
          expect(key).toBe(type);
        }

        // The returned key is one of the six canonical subfolder keys.
        expect(SUBFOLDER_KEYS).toContain(key);
      }),
      pbtParams(),
    );
  });

  it("live client: an uploaded artifact lands in the type-matched subfolder, and the folder set has exactly the six required subfolders (Requirements 10.1, 10.2)", async () => {
    await fc.assert(
      fc.asyncProperty(
        artifactTypeArb,
        fc.string({ minLength: 1, maxLength: 40 }), // company name
        fc.string({ minLength: 1, maxLength: 40 }), // scan timestamp
        nameArb,
        contentArb,
        async (type, company, timestamp, name, content) => {
          const box = fakeBox();
          const client = new LiveBoxClient({
            developerToken: DEV_TOKEN,
            fetchImpl: box.fetchImpl,
          });

          const set = await client.ensureScanFolders(company, timestamp);

          // Requirement 10.1: exactly the six required subfolder keys, no more, no fewer.
          expect(Object.keys(set.subfolders).sort()).toEqual(
            [...EXPECTED_SUBFOLDER_KEYS].sort(),
          );
          // The six subfolder ids are distinct and name-mapped to the six Box folder names.
          const subfolderIds = Object.values(set.subfolders);
          expect(new Set(subfolderIds).size).toBe(subfolderIds.length);
          const subfolderNames = subfolderIds
            .map((id) => box.folderNames.get(id))
            .sort();
          expect(subfolderNames).toEqual(
            Object.values(SUBFOLDER_BOX_NAMES).sort(),
          );

          // Requirement 10.2: route by type and upload into that subfolder.
          const key = subfolderKeyForArtifact(type);
          const targetFolderId = set.subfolders[key];
          const result = await client.upload(targetFolderId, type, name, content);

          // The upload's returned destination is the type-matched subfolder id.
          expect(result.folderId).toBe(targetFolderId);
          // The fake backend recorded the upload against that same folder id.
          expect(box.uploads).toContainEqual({
            folderId: targetFolderId,
            name: result.key.split("/").pop(),
          });
          // The destination folder is named exactly the type's Box folder name
          // (raw / normalized / screenshots / diffs / claims / reports).
          expect(box.folderNames.get(result.folderId)).toBe(
            SUBFOLDER_BOX_NAMES[key],
          );
          expect(result.simulated).toBe(false);
        },
      ),
      pbtParams(),
    );
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
