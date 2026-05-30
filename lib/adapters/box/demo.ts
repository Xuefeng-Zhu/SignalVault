import "server-only";

import { createHash } from "node:crypto";

import type {
  ArtifactType,
  BoxClient,
  BoxFolderSet,
  BoxUploadResult,
  RunMode,
} from "../types";

/**
 * Deterministic demo/mock implementation of {@link BoxClient}.
 *
 * This adapter is selected by the adapter factory (task 6.2) whenever Box
 * credentials are missing or `DEMO_MODE` is active, and it is also the fallback
 * the workflow substitutes when a live Box call errors, throws, or times out
 * (Requirements 10.5, 19.2). It never performs network access: every folder id,
 * file id, key, and URL is derived purely from its inputs via a stable hash, so
 * repeated demo scans of the same Company/Scan produce identical evidence
 * references (Requirement 18.7 determinism context).
 *
 * All generated identifiers are prefixed `mock-` and every result carries
 * `simulated = true` so downstream UI (the simulated-storage warning and
 * {@link folderWebLink}-backed BoxEvidenceLink, Requirement 10.6) can present
 * the evidence as mock storage.
 */

/**
 * The exact key set required by {@link BoxFolderSet.subfolders}:
 * `Exclude<ArtifactType, "screenshot"> | "screenshots"`. The `screenshot`
 * artifact type maps to the plural `screenshots` subfolder; the remaining
 * keys mirror the singular artifact types (Requirement 10.1 / 10.2).
 */
type SubfolderKey = Exclude<ArtifactType, "screenshot"> | "screenshots";

const SUBFOLDER_KEYS: readonly SubfolderKey[] = [
  "raw",
  "normalized",
  "screenshots",
  "diff",
  "claim",
  "report",
];

/**
 * Compute a short, stable hex token from arbitrary inputs. SHA-256 keeps the
 * mapping deterministic and collision-resistant; the first 16 hex characters
 * keep the generated ids compact while remaining effectively unique per input.
 * The parts are joined with a delimiter that cannot appear in the slug output
 * so distinct input tuples cannot alias to the same token.
 */
function token(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/**
 * Reduce an arbitrary string to a path-safe slug for use inside mock storage
 * keys. Deterministic: equal inputs always yield equal slugs. Empty results
 * collapse to `artifact` so the key segment is never blank.
 */
function slug(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "artifact";
}

export class DemoBoxClient implements BoxClient {
  readonly mode: RunMode = "demo";

  /** Demo client never holds live Box credentials. */
  isConfigured(): boolean {
    return false;
  }

  /**
   * Deterministically derive the mock scan folder tree for a Company/Scan.
   * The returned `subfolders` record contains exactly the six required keys,
   * each a `mock-folder-{key}-…` id derived from the scan folder id so the
   * subfolders are stably nested under their parent (Requirements 10.1, 10.5).
   */
  async ensureScanFolders(
    companyName: string,
    scanTimestamp: string,
  ): Promise<BoxFolderSet> {
    const scanFolderId = `mock-folder-scan-${token(companyName, scanTimestamp)}`;

    const subfolders = SUBFOLDER_KEYS.reduce(
      (acc, key) => {
        acc[key] = `mock-folder-${key}-${token(scanFolderId, key)}`;
        return acc;
      },
      {} as Record<SubfolderKey, string>,
    );

    return {
      scanFolderId,
      subfolders,
      simulated: true,
    };
  }

  /**
   * Produce a deterministic mock upload result. The `fileId`, `key`, and `url`
   * are derived from `folderId` + `artifactType` + `name`, so re-uploading the
   * same artifact to the same folder yields identical references. Both `url`
   * and `key` are persisted by callers per the InsForge storage convention
   * (Requirements 10.5, 19.2).
   */
  async upload(
    folderId: string,
    artifactType: ArtifactType,
    name: string,
    // `content` is intentionally unused: the mock never reads or transmits it.
    _content: Buffer | string,
  ): Promise<BoxUploadResult> {
    const digest = token(folderId, artifactType, name);
    const fileId = `mock-file-${digest}`;

    return {
      fileId,
      folderId,
      url: `https://mock.box/file/${fileId}`,
      key: `mock-${artifactType}/${digest}/${slug(name)}`,
      simulated: true,
    };
  }

  /**
   * Deterministic mock web link for a folder. Used by BoxEvidenceLink even when
   * the scan's evidence is represented by mock storage identifiers
   * (Requirement 10.6). No network access; the link is purely derived.
   */
  folderWebLink(folderId: string): string {
    return `https://mock.box/folder/${folderId}`;
  }
}

/** Construct a {@link DemoBoxClient}. */
export function createDemoBoxClient(): BoxClient {
  return new DemoBoxClient();
}
