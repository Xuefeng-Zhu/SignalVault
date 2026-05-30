// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the live Box logic (folder-tree creation,
// type→subfolder routing, upload, idempotent 409 handling) stays unit-testable
// while the live *client entry* (`./live`) remains server-only. This mirrors
// the apify adapter's `live-capture` / `live` split.
import type {
  ArtifactType,
  BoxClient,
  BoxFolderSet,
  BoxUploadResult,
  RunMode,
} from "@/lib/adapters/types";

import {
  SUBFOLDER_BOX_NAMES,
  SUBFOLDER_KEYS,
  subfolderKeyForArtifact,
  type SubfolderKey,
} from "./routing";

/**
 * Testable core of the live {@link BoxClient} (Box_Adapter).
 *
 * Materializes the governed evidence hierarchy in Box and uploads each artifact
 * into the subfolder matching its type:
 * `/SignalVault/{Company}/scans/{timestamp}/{raw,normalized,screenshots,diffs,claims,reports}`
 * (Requirements 10.1, 10.2). Folder ids and per-file `fileId`/`url`/`key` are
 * returned for callers to persist on the related DB record (Requirement 10.3).
 *
 * This module is intentionally NOT `server-only`: it holds the logic (network
 * access is via an injected `fetch`) that the `server-only`
 * {@link import('./live')} entry binds to the real Box credentials + global
 * `fetch`. Credentials are never read here directly from `process.env`; they
 * are supplied by the constructor (Requirement 22.1).
 *
 * ## Box integration approach
 *
 * Per the Box skill's SDK-vs-REST guidance, this client uses the **Box REST API
 * with `fetch`** rather than an SDK, because the project has no Box SDK and
 * already centers on a lightweight `fetch` HTTP stack (mirroring the live Apify
 * client). Two Box hosts are used:
 *   - content/management API  `https://api.box.com/2.0`
 *   - upload API              `https://upload.box.com/api/2.0`
 *
 * Auth follows the credential precedence fixed by `isBoxConfigured()`:
 *   1. **Developer token** (`BOX_DEVELOPER_TOKEN`) — consumed directly as an
 *      OAuth 2.0 bearer access token.
 *   2. **Client Credentials Grant** (`BOX_CLIENT_ID` + `BOX_CLIENT_SECRET`) —
 *      exchanged at `https://api.box.com/oauth2/token` for a short-lived access
 *      token, cached for the lifetime of the client instance.
 *
 * Folder creation is idempotent: Box returns `409 item_name_in_use` when a
 * folder of the same name already exists in the parent, and the existing
 * folder id is recovered from the error's `context_info.conflicts`
 * (Requirement 10.1 — the tree is *created or resolved*).
 *
 * Live Box is not exercised in this environment; the focus here is correct
 * six-subfolder tree creation, type→subfolder routing, and result shape.
 */

/** Box content/management API base. */
const BOX_API_BASE = "https://api.box.com/2.0";
/** Box upload API base (multipart `files/content`). */
const BOX_UPLOAD_BASE = "https://upload.box.com/api/2.0";
/** Box OAuth 2.0 token endpoint (client-credentials grant). */
const BOX_TOKEN_URL = "https://api.box.com/oauth2/token";
/** Box web app base, used to build human-facing folder/file links. */
export const BOX_WEB_BASE = "https://app.box.com";
/** The id of the "All Files" root folder in every Box account. */
const BOX_ROOT_FOLDER_ID = "0";

/** Construction options; the server-only entry binds the env-backed defaults. */
export interface LiveBoxClientOptions {
  /** Box developer token; consumed directly as a bearer access token. */
  developerToken?: string;
  /** OAuth 2.0 client id (used with {@link LiveBoxClientOptions.clientSecret}). */
  clientId?: string;
  /** OAuth 2.0 client secret. */
  clientSecret?: string;
  /**
   * Enterprise id for the client-credentials grant. When present the token
   * request is scoped to this enterprise (`box_subject_type=enterprise`).
   */
  enterpriseId?: string;
  /** Parent folder under which `/SignalVault` is created. Defaults to root `0`. */
  rootFolderId?: string;
  /** Injectable fetch, primarily for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/** A Box folder object as returned by create/get (defensively typed). */
interface BoxFolder {
  id?: unknown;
}

/** A Box upload response: `{ entries: [{ id, name, ... }] }` (defensively typed). */
interface BoxUploadResponse {
  entries?: unknown;
}

/** A Box OAuth token response (defensively typed). */
interface BoxTokenResponse {
  access_token?: unknown;
}

/** Box error envelope carrying the conflicting item(s) for a 409. */
interface BoxErrorBody {
  context_info?: { conflicts?: unknown };
}

/** Coerce a value to a non-empty trimmed string, or undefined. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Sanitize a string into a valid Box folder/file name. Box rejects names that
 * contain `/` or `\`, are blank, or are `.`/`..`, and trims surrounding
 * whitespace. Control characters (including CR/LF) are stripped so they cannot
 * corrupt the upload's multipart `attributes` part.
 */
export function sanitizeBoxName(input: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "-")
    .trim();
  if (cleaned.length === 0 || cleaned === "." || cleaned === "..") {
    return fallback;
  }
  return cleaned;
}

/**
 * Recover an existing folder/file id from a Box `409` conflict body. The
 * conflicts field is an array of mini objects; defensively also accept a single
 * object. Returns undefined when no usable id is present.
 */
function conflictItemId(body: unknown): string | undefined {
  const conflicts = (body as BoxErrorBody)?.context_info?.conflicts;
  const candidate = Array.isArray(conflicts) ? conflicts[0] : conflicts;
  if (!candidate || typeof candidate !== "object") return undefined;
  return nonEmptyString((candidate as BoxFolder).id);
}

/**
 * Normalize upload content to a `BlobPart`. A string is used as-is; a Node
 * `Buffer` is copied into a fresh `Uint8Array` so its backing buffer is a plain
 * `ArrayBuffer` (Node's `Buffer` types as `ArrayBufferLike`, which TS does not
 * accept directly as a `BlobPart`).
 */
function toBlobPart(content: Buffer | string): BlobPart {
  return typeof content === "string" ? content : new Uint8Array(content);
}

/** Read a response body as JSON without throwing on empty/invalid payloads. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export class LiveBoxClient implements BoxClient {
  readonly mode: RunMode = "live";

  private readonly developerToken: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly enterpriseId: string | undefined;
  private readonly rootFolderId: string;
  private readonly fetchImpl: typeof fetch;

  /** Cached access-token promise for the client-credentials grant. */
  private accessTokenPromise: Promise<string> | undefined;

  constructor(options: LiveBoxClientOptions = {}) {
    this.developerToken = nonEmptyString(options.developerToken);
    this.clientId = nonEmptyString(options.clientId);
    this.clientSecret = nonEmptyString(options.clientSecret);
    this.enterpriseId = nonEmptyString(options.enterpriseId);
    this.rootFolderId = nonEmptyString(options.rootFolderId) ?? BOX_ROOT_FOLDER_ID;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * True when live Box credentials are available: a developer token, or an
   * OAuth client id + secret pair. The server-only entry binds the env-backed
   * defaults, so this matches `isBoxConfigured()` (developer token present, or
   * the client-id/secret pair present).
   */
  isConfigured(): boolean {
    const hasDeveloperToken = this.developerToken !== undefined;
    const hasClientPair =
      this.clientId !== undefined && this.clientSecret !== undefined;
    return hasDeveloperToken || hasClientPair;
  }

  /**
   * Create (or resolve) the scan folder tree
   * `/SignalVault/{Company}/scans/{timestamp}/` and its six subfolders, and
   * return their ids. The returned `subfolders` record contains exactly the six
   * required keys (Requirements 10.1, 10.2). `simulated` is always `false` for
   * the live client.
   */
  async ensureScanFolders(
    companyName: string,
    scanTimestamp: string,
  ): Promise<BoxFolderSet> {
    const token = await this.getAccessToken();

    const company = sanitizeBoxName(companyName, "company");
    const timestamp = sanitizeBoxName(scanTimestamp, "scan");

    // Walk/create the path one level at a time so each level is idempotent.
    const signalVaultId = await this.ensureFolder(token, "SignalVault", this.rootFolderId);
    const companyId = await this.ensureFolder(token, company, signalVaultId);
    const scansId = await this.ensureFolder(token, "scans", companyId);
    const scanFolderId = await this.ensureFolder(token, timestamp, scansId);

    // Create the six subfolders under the scan folder, keyed exactly as
    // `BoxFolderSet.subfolders` requires.
    const entries = await Promise.all(
      SUBFOLDER_KEYS.map(async (key) => {
        const id = await this.ensureFolder(token, SUBFOLDER_BOX_NAMES[key], scanFolderId);
        return [key, id] as const;
      }),
    );

    const subfolders = entries.reduce(
      (acc, [key, id]) => {
        acc[key] = id;
        return acc;
      },
      {} as Record<SubfolderKey, string>,
    );

    return { scanFolderId, subfolders, simulated: false };
  }

  /**
   * Upload an artifact into the subfolder matching its {@link ArtifactType}
   * (Requirement 10.2). `folderId` must be the scan folder's subfolder id for
   * the artifact's type — the caller resolves it from
   * {@link BoxFolderSet.subfolders} via {@link subfolderKeyForArtifact}. Returns
   * the new file's id along with a web `url` and a path-like `key`; both are
   * persisted per the InsForge storage convention (Requirement 10.3).
   */
  async upload(
    folderId: string,
    artifactType: ArtifactType,
    name: string,
    content: Buffer | string,
  ): Promise<BoxUploadResult> {
    const token = await this.getAccessToken();
    // `subfolderKey` records the type→subfolder routing decision for `key`
    // even though the destination folder id is supplied by the caller.
    const subfolderKey = subfolderKeyForArtifact(artifactType);
    const fileName = sanitizeBoxName(name, `${subfolderKey}-artifact`);

    const fileId = await this.uploadFile(token, folderId, fileName, content);

    return {
      fileId,
      folderId,
      url: `${BOX_WEB_BASE}/file/${fileId}`,
      key: `box/${folderId}/${fileName}`,
      simulated: false,
    };
  }

  /**
   * Web link for a folder, used by BoxEvidenceLink (Requirement 10.6). Pure and
   * synchronous: the canonical Box folder URL is derived from the id without a
   * network call.
   */
  folderWebLink(folderId: string): string {
    return `${BOX_WEB_BASE}/folder/${folderId}`;
  }

  /* ----------------------------------------------------------------------- */
  /* Box REST helpers                                                        */
  /* ----------------------------------------------------------------------- */

  /**
   * Create a folder named `name` under `parentId`, returning its id. Idempotent:
   * a `409 item_name_in_use` resolves to the existing folder's id recovered from
   * the conflict body (Requirement 10.1 — create *or* resolve).
   */
  private async ensureFolder(
    token: string,
    name: string,
    parentId: string,
  ): Promise<string> {
    const response = await this.fetchImpl(`${BOX_API_BASE}/folders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ name, parent: { id: parentId } }),
    });

    if (response.ok) {
      const body = (await readJson(response)) as BoxFolder | undefined;
      const id = nonEmptyString(body?.id);
      if (!id) {
        throw new Error(`Box folder create for "${name}" returned no id`);
      }
      return id;
    }

    if (response.status === 409) {
      const existingId = conflictItemId(await readJson(response));
      if (existingId) return existingId;
      throw new Error(
        `Box folder "${name}" already exists but its id could not be resolved`,
      );
    }

    throw new Error(
      `Box folder create for "${name}" failed: HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }

  /**
   * Upload `content` as `name` into `folderId` via the multipart upload API,
   * returning the new file's id. The `attributes` part is appended before the
   * file part, as Box requires.
   */
  private async uploadFile(
    token: string,
    folderId: string,
    name: string,
    content: Buffer | string,
  ): Promise<string> {
    const form = new FormData();
    form.append("attributes", JSON.stringify({ name, parent: { id: folderId } }));
    form.append("file", new Blob([toBlobPart(content)]), name);

    const response = await this.fetchImpl(`${BOX_UPLOAD_BASE}/files/content`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: form,
    });

    if (response.ok) {
      const body = (await readJson(response)) as BoxUploadResponse | undefined;
      const entries = Array.isArray(body?.entries) ? body!.entries : [];
      const first = entries[0];
      const id =
        first && typeof first === "object"
          ? nonEmptyString((first as BoxFolder).id)
          : undefined;
      if (!id) {
        throw new Error(`Box upload of "${name}" returned no file id`);
      }
      return id;
    }

    // A same-named file already exists: recover its id so the upload is
    // idempotent rather than fatal.
    if (response.status === 409) {
      const existingId = conflictItemId(await readJson(response));
      if (existingId) return existingId;
    }

    throw new Error(
      `Box upload of "${name}" failed: HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }

  /**
   * Resolve an OAuth 2.0 bearer access token. A developer token is used
   * directly; otherwise a client-credentials grant is exchanged and cached for
   * the instance lifetime.
   */
  private getAccessToken(): Promise<string> {
    if (this.developerToken) {
      return Promise.resolve(this.developerToken);
    }
    if (!this.accessTokenPromise) {
      this.accessTokenPromise = this.requestClientCredentialsToken().catch(
        (error: unknown) => {
          // Don't cache a rejected token; allow a later retry.
          this.accessTokenPromise = undefined;
          throw error;
        },
      );
    }
    return this.accessTokenPromise;
  }

  /** Exchange client id/secret for an access token (client-credentials grant). */
  private async requestClientCredentialsToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Box client credentials are not configured");
    }

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (this.enterpriseId) {
      params.set("box_subject_type", "enterprise");
      params.set("box_subject_id", this.enterpriseId);
    }

    const response = await this.fetchImpl(BOX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `Box token request failed: HTTP ${response.status} ${response.statusText}`.trim(),
      );
    }

    const body = (await readJson(response)) as BoxTokenResponse | undefined;
    const token = nonEmptyString(body?.access_token);
    if (!token) {
      throw new Error("Box token response contained no access_token");
    }
    return token;
  }
}

/** Construct a {@link LiveBoxClient} from explicit options (credentials injected). */
export function createLiveBoxClientCore(
  options: LiveBoxClientOptions = {},
): BoxClient {
  return new LiveBoxClient(options);
}
