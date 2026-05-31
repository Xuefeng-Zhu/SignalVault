// Pure artifact→subfolder routing for the Box evidence hierarchy.
//
// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the routing logic stays unit-testable
// while the live Box *clients* remain server-only. This mirrors the apify
// adapter's capture split.
//
// The Box folder tree for a scan is
// `/SignalVault/{Company}/scans/{timestamp}/{raw,normalized,screenshots,diffs,claims,reports}`
// (design "Box Folder Structure", Requirement 10.1). Each uploaded artifact is
// routed to the subfolder matching its type (Requirement 10.2):
//   raw HTML        -> raw
//   normalized md   -> normalized
//   screenshot      -> screenshots
//   diff report     -> diffs
//   claim ledger    -> claims
//   final brief     -> reports

import type { ArtifactType } from "../types";

/**
 * The exact key set required by `BoxFolderSet.subfolders`:
 * `Exclude<ArtifactType, "screenshot"> | "screenshots"`. The singular
 * `screenshot` artifact type maps to the plural `screenshots` key; every other
 * key mirrors its singular artifact type (Requirements 10.1, 10.2).
 */
export type SubfolderKey = Exclude<ArtifactType, "screenshot"> | "screenshots";

/** The six subfolder keys, in canonical order. */
export const SUBFOLDER_KEYS: readonly SubfolderKey[] = [
  "raw",
  "normalized",
  "screenshots",
  "diff",
  "claim",
  "report",
];

/**
 * Map each subfolder key to the Box folder NAME used on disk. Box names are
 * plural where the singular artifact type is not, matching the design's folder
 * tree (`raw, normalized, screenshots, diffs, claims, reports`).
 */
export const SUBFOLDER_BOX_NAMES: Record<SubfolderKey, string> = {
  raw: "raw",
  normalized: "normalized",
  screenshots: "screenshots",
  diff: "diffs",
  claim: "claims",
  report: "reports",
};

/**
 * Resolve the {@link SubfolderKey} an {@link ArtifactType} routes to. The only
 * rename is `screenshot` -> `screenshots`; all other types map to the
 * identically named key (Requirement 10.2). Callers use the returned key to
 * index `BoxFolderSet.subfolders` and obtain the destination folder id to pass
 * to `BoxClient.upload`.
 */
export function subfolderKeyForArtifact(artifactType: ArtifactType): SubfolderKey {
  return artifactType === "screenshot" ? "screenshots" : artifactType;
}
