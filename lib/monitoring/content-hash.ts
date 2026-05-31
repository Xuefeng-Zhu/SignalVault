import "server-only";

import { createHash } from "node:crypto";

/**
 * Compute a SHA-256 content hash of page content.
 *
 * Normalizes whitespace to reduce false positives from insignificant
 * formatting changes (e.g., trailing newlines, indentation differences).
 */
export function computeContentHash(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Compare two content hashes. Returns true when they differ (i.e., content changed).
 */
export function hasContentChanged(
  previousHash: string | null,
  currentHash: string,
): boolean {
  if (previousHash === null) return true; // First check — treat as changed
  return previousHash !== currentHash;
}
