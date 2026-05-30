import { describe, expect, it, vi } from "vitest";

import type { ArtifactType } from "@/lib/adapters/types";

import {
  BOX_WEB_BASE,
  LiveBoxClient,
  createLiveBoxClientCore,
  sanitizeBoxName,
} from "./live-box";
import { SUBFOLDER_BOX_NAMES, subfolderKeyForArtifact } from "./routing";

const TOKEN = "dev-token";

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
 * A fake Box backend: assigns deterministic ids to created folders keyed by
 * `parentId/name`, models `409 item_name_in_use` on duplicate folder creation,
 * and assigns file ids on upload. Records every request for assertions.
 */
function fakeBox() {
  const folders = new Map<string, string>(); // "parentId/name" -> folderId
  let folderSeq = 0;
  let fileSeq = 0;
  const folderCreates: Array<{ name: string; parentId: string }> = [];
  const uploads: Array<{ folderId: string; name: string }> = [];

  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);

      if (url.endsWith("/2.0/folders")) {
        const { name, parent } = JSON.parse(String(init?.body)) as {
          name: string;
          parent: { id: string };
        };
        const key = `${parent.id}/${name}`;
        folderCreates.push({ name, parentId: parent.id });
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
        return jsonResponse({ id, name, type: "folder" });
      }

      if (url.endsWith("/files/content")) {
        // Pull the destination folder id out of the multipart attributes.
        const form = init?.body as FormData;
        const attributes = JSON.parse(String(form.get("attributes"))) as {
          name: string;
          parent: { id: string };
        };
        uploads.push({ folderId: attributes.parent.id, name: attributes.name });
        fileSeq += 1;
        const id = `file-${fileSeq}`;
        return jsonResponse({ entries: [{ id, name: attributes.name, type: "file" }] });
      }

      throw new Error(`unexpected fetch to ${url}`);
    },
  );

  return { fetchImpl, folders, folderCreates, uploads };
}

describe("LiveBoxClient.isConfigured", () => {
  it("is true with a developer token", () => {
    expect(new LiveBoxClient({ developerToken: TOKEN }).isConfigured()).toBe(true);
  });

  it("is true with a client id + secret pair", () => {
    expect(
      new LiveBoxClient({ clientId: "id", clientSecret: "secret" }).isConfigured(),
    ).toBe(true);
  });

  it("is false with no credentials, or an incomplete client pair", () => {
    expect(new LiveBoxClient({}).isConfigured()).toBe(false);
    expect(new LiveBoxClient({ clientId: "id" }).isConfigured()).toBe(false);
    expect(new LiveBoxClient({ developerToken: "" }).isConfigured()).toBe(false);
  });

  it("reports live mode", () => {
    expect(new LiveBoxClient({ developerToken: TOKEN }).mode).toBe("live");
  });
});

describe("LiveBoxClient.ensureScanFolders", () => {
  it("creates exactly the six required subfolders under the scan folder", async () => {
    const box = fakeBox();
    const client = new LiveBoxClient({ developerToken: TOKEN, fetchImpl: box.fetchImpl });

    const set = await client.ensureScanFolders("Dropbox", "2024-01-01T00:00:00Z");

    expect(set.simulated).toBe(false);
    expect(Object.keys(set.subfolders).sort()).toEqual(
      ["claim", "diff", "normalized", "raw", "report", "screenshots"].sort(),
    );
    // Each subfolder id is distinct from the scan folder and from each other.
    const ids = Object.values(set.subfolders);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(set.scanFolderId);
  });

  it("creates the /SignalVault/{Company}/scans/{timestamp} path with sanitized names", async () => {
    const box = fakeBox();
    const client = new LiveBoxClient({ developerToken: TOKEN, fetchImpl: box.fetchImpl });

    await client.ensureScanFolders("Acme / AI", "2024-01-01T00:00:00Z");

    const created = box.folderCreates.map((c) => c.name);
    expect(created).toContain("SignalVault");
    expect(created).toContain("scans");
    // "/" is sanitized out of the company name.
    expect(created).toContain("Acme - AI");
    // The six Box folder names are created.
    for (const boxName of Object.values(SUBFOLDER_BOX_NAMES)) {
      expect(created).toContain(boxName);
    }
  });

  it("resolves an existing folder via 409 instead of failing (idempotent)", async () => {
    const box = fakeBox();
    const client = new LiveBoxClient({ developerToken: TOKEN, fetchImpl: box.fetchImpl });

    const first = await client.ensureScanFolders("Acme", "2024-01-01T00:00:00Z");
    const second = await client.ensureScanFolders("Acme", "2024-01-01T00:00:00Z");

    // Re-running yields the same ids (existing folders resolved from the 409).
    expect(second.scanFolderId).toBe(first.scanFolderId);
    expect(second.subfolders).toEqual(first.subfolders);
  });
});

describe("LiveBoxClient.upload — type→subfolder routing & result shape", () => {
  const cases: Array<[ArtifactType, string]> = [
    ["raw", "raw"],
    ["normalized", "normalized"],
    ["screenshot", "screenshots"],
    ["diff", "diff"],
    ["claim", "claim"],
    ["report", "report"],
  ];

  it.each(cases)(
    "routes a %s artifact using the matching subfolder key",
    async (artifactType, expectedKey) => {
      expect(subfolderKeyForArtifact(artifactType)).toBe(expectedKey);
    },
  );

  it("uploads to the supplied folder and returns fileId/url/key with simulated=false", async () => {
    const box = fakeBox();
    const client = new LiveBoxClient({ developerToken: TOKEN, fetchImpl: box.fetchImpl });

    const set = await client.ensureScanFolders("Acme", "2024-01-01T00:00:00Z");
    const target = set.subfolders.raw;
    const result = await client.upload(target, "raw", "homepage.html", "<html></html>");

    expect(result.simulated).toBe(false);
    expect(result.folderId).toBe(target);
    expect(result.fileId).toMatch(/^file-/);
    expect(result.url).toBe(`${BOX_WEB_BASE}/file/${result.fileId}`);
    expect(result.key).toBe(`box/${target}/homepage.html`);
    expect(box.uploads).toContainEqual({ folderId: target, name: "homepage.html" });
  });

  it("sanitizes the file name and falls back when blank", async () => {
    const box = fakeBox();
    const client = new LiveBoxClient({ developerToken: TOKEN, fetchImpl: box.fetchImpl });

    const result = await client.upload("folder-x", "diff", "   ", "data");
    expect(box.uploads.at(-1)?.name).toBe("diff-artifact");
    expect(result.key).toBe("box/folder-x/diff-artifact");
  });
});

describe("LiveBoxClient.folderWebLink", () => {
  it("returns the canonical Box folder URL", () => {
    const client = new LiveBoxClient({ developerToken: TOKEN });
    expect(client.folderWebLink("12345")).toBe(`${BOX_WEB_BASE}/folder/12345`);
  });
});

describe("LiveBoxClient auth — client-credentials grant", () => {
  it("exchanges client id/secret for an access token and reuses it", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/oauth2/token")) {
          expect(String(init?.body)).toContain("grant_type=client_credentials");
          return jsonResponse({ access_token: "minted-token", expires_in: 3600 });
        }
        if (url.endsWith("/2.0/folders")) {
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            "Bearer minted-token",
          );
          return jsonResponse({ id: "f", name: "x", type: "folder" });
        }
        throw new Error(`unexpected fetch to ${url}`);
      },
    );

    const client = new LiveBoxClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });
    await client.ensureScanFolders("Acme", "2024-01-01T00:00:00Z");

    // Token is minted once and cached for subsequent calls in the same scan.
    const tokenCalls = fetchImpl.mock.calls.filter((c) =>
      String(c[0]).endsWith("/oauth2/token"),
    );
    expect(tokenCalls).toHaveLength(1);
  });
});

describe("sanitizeBoxName", () => {
  it("strips path separators and control characters, trims, and applies fallback", () => {
    expect(sanitizeBoxName("a/b\\c", "fb")).toBe("a-b-c");
    expect(sanitizeBoxName("  hi  ", "fb")).toBe("hi");
    expect(sanitizeBoxName("", "fb")).toBe("fb");
    expect(sanitizeBoxName(".", "fb")).toBe("fb");
    expect(sanitizeBoxName("..", "fb")).toBe("fb");
    expect(sanitizeBoxName("line\nbreak", "fb")).toBe("linebreak");
  });
});

describe("createLiveBoxClientCore", () => {
  it("constructs a live client honoring injected options", () => {
    const client = createLiveBoxClientCore({ developerToken: TOKEN, fetchImpl: vi.fn() });
    expect(client.mode).toBe("live");
    expect(client.isConfigured()).toBe(true);
  });
});
