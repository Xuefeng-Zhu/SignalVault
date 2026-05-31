/**
 * Live {@link BoxClient} implementation backed by InsForge Storage.
 *
 * Replaces the former Box REST client with InsForge's S3-compatible object
 * storage. The folder tree concept maps to key prefixes:
 *   `/SignalVault/{Company}/scans/{timestamp}/{raw,normalized,screenshots,diffs,claims,reports}/`
 *
 * Each "folder" is a prefix string; `ensureScanFolders` computes the prefixes
 * deterministically (no network call needed — InsForge storage has no explicit
 * folder creation). Uploads go to `bucket.upload(key, blob)`.
 *
 * This module is intentionally NOT `server-only` so it remains unit-testable.
 * The `server-only` entry `./live.ts` binds the real credentials.
 */
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
} from "../box/routing";

/** Construction options for the InsForge storage client. */
export interface InsForgeStorageClientOptions {
  /** InsForge project API URL (e.g. `https://xxx.us-west.insforge.app`). */
  apiUrl: string;
  /** InsForge API key for server-side auth. */
  apiKey: string;
  /** Bucket name to store evidence artifacts. Default: `"evidence"`. */
  bucketName?: string;
  /** Optional access token for user-scoped operations. */
  accessToken?: string;
}

/**
 * Slugify a company name for use in storage keys.
 * Produces lowercase kebab-case: "Acme AI" → "acme-ai".
 */
function slugify(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "unknown";
}

/**
 * Format a scan timestamp for use in folder paths.
 * Ensures it's path-safe (replaces colons, spaces).
 */
function formatTimestamp(ts: string): string {
  return ts.replace(/[: ]/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
}

/**
 * Determine MIME type from artifact type and filename.
 */
function mimeType(artifactType: ArtifactType, name: string): string {
  if (name.endsWith(".html")) return "text/html";
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  switch (artifactType) {
    case "raw":
      return "text/html";
    case "normalized":
    case "diff":
    case "report":
      return "text/markdown";
    case "claim":
      return "application/json";
    case "screenshot":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

export class InsForgeStorageClient implements BoxClient {
  readonly mode: RunMode = "live";
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly bucket: string;
  private readonly accessToken?: string;

  constructor(options: InsForgeStorageClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.bucket = options.bucketName ?? "evidence";
    this.accessToken = options.accessToken;
  }

  isConfigured(): boolean {
    return Boolean(this.apiUrl && this.apiKey);
  }

  /**
   * Compute the scan folder tree as key prefixes. InsForge storage is
   * prefix-based (like S3), so no network call is needed to "create" folders.
   * We return prefix strings as folder IDs.
   */
  async ensureScanFolders(
    companyName: string,
    scanTimestamp: string,
  ): Promise<BoxFolderSet> {
    const company = slugify(companyName);
    const ts = formatTimestamp(scanTimestamp);
    const basePath = `SignalVault/${company}/scans/${ts}`;

    const scanFolderId = basePath;
    const subfolders = SUBFOLDER_KEYS.reduce(
      (acc, key) => {
        acc[key] = `${basePath}/${SUBFOLDER_BOX_NAMES[key]}`;
        return acc;
      },
      {} as Record<SubfolderKey, string>,
    );

    return {
      scanFolderId,
      subfolders,
      simulated: false,
    };
  }

  /**
   * Upload an artifact to InsForge storage.
   * The `folderId` is actually a key prefix (from `ensureScanFolders`).
   */
  async upload(
    folderId: string,
    artifactType: ArtifactType,
    name: string,
    content: Buffer | string,
  ): Promise<BoxUploadResult> {
    const key = `${folderId}/${name}`;
    const contentType = mimeType(artifactType, name);

    // Convert content to a Blob for the upload API
    const bytes =
      typeof content === "string"
        ? new TextEncoder().encode(content)
        : new Uint8Array(content);
    const body = new Blob([bytes], { type: contentType });

    // Use InsForge Storage REST API directly (multipart upload)
    const formData = new FormData();
    formData.append("file", body, name);

    const authHeader = this.accessToken
      ? `Bearer ${this.accessToken}`
      : `Bearer ${this.apiKey}`;

    const response = await fetch(
      `${this.apiUrl}/api/storage/buckets/${this.bucket}/objects/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: {
          Authorization: authHeader,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `InsForge storage upload failed (${response.status}): ${errorText}`,
      );
    }

    const result = await response.json();

    // Build the URL for the stored object
    const url =
      result?.url ??
      `${this.apiUrl}/api/storage/buckets/${this.bucket}/objects/${encodeURIComponent(key)}`;
    const fileId = result?.id ?? key;

    return {
      fileId,
      folderId,
      url,
      key,
      simulated: false,
    };
  }

  /**
   * Generate a web link to browse the folder (prefix) in InsForge storage.
   * Since InsForge doesn't have a folder browser UI like Box, we return
   * an API listing URL.
   */
  folderWebLink(folderId: string): string {
    return `${this.apiUrl}/api/storage/buckets/${this.bucket}/objects?prefix=${encodeURIComponent(folderId + "/")}`;
  }
}
