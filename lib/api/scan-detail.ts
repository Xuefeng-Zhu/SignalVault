/**
 * Pure response shaping for `GET /api/scans/:id` (Requirement 21.5).
 *
 * No `server-only`, no `next/*` imports: this module turns the workspace-scoped
 * repository rows (scan + snapshots + diffs + claims + verdict) into the JSON
 * payload the Scan detail page and the ScanProgressTimeline poller consume. It
 * is pure so it can be unit-tested directly; the route handler (which performs
 * auth, scoping, and I/O) calls {@link shapeScanDetail} with the rows it read.
 *
 * The payload deliberately surfaces the Box evidence identifiers/links carried
 * on each entity — snapshot raw/normalized/screenshot (`url` + `key` +
 * `boxFileId`), diff `diffBoxFileId`, and the scan's `boxScanFolderId` — plus a
 * flattened {@link EvidenceArtifactSummary} list and an `evidenceFolder` link so
 * the UI can render `EvidenceArtifactList` and `BoxEvidenceLink` without
 * re-deriving anything client-side (design "API Routes", Req 10.6, 17.4).
 */

import type {
  ClaimRow,
  DiffRow,
  Scan,
  Snapshot,
  VerdictRow,
} from "@/lib/adapters/types";
import type { ArtifactType } from "@/lib/adapters/types";

/* -------------------------------------------------------------------------- */
/* Response field shapes                                                      */
/* -------------------------------------------------------------------------- */

/** A single Box-stored artifact reference (url + key + Box file id). */
export interface BoxArtifactRef {
  url: string | null;
  key: string | null;
  boxFileId: string | null;
}

/** Scan status + lifecycle fields, plus the Box evidence folder identifiers. */
export interface ScanDetailScan {
  id: string;
  companyId: string;
  status: Scan["status"];
  triggerType: string;
  failureReason: string | null;
  /** Box folder id holding this scan's evidence tree (may be a `mock-` id). */
  boxScanFolderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A snapshot with its three Box artifact references and content hashes. */
export interface ScanDetailSnapshot {
  id: string;
  watchedSourceId: string;
  contentHash: string | null;
  normalizedTextHash: string | null;
  simulated: boolean;
  createdAt: string;
  artifacts: {
    raw: BoxArtifactRef;
    normalized: BoxArtifactRef;
    screenshot: BoxArtifactRef;
  };
}

/** A computed + persisted diff, including its Box diff-report file id. */
export interface ScanDetailDiff {
  id: string;
  priorSnapshotId: string | null;
  currentSnapshotId: string;
  changeScore: number;
  changeSummary: string;
  addedText: string;
  removedText: string;
  modifiedSections: DiffRow["modifiedSections"];
  diffBoxFileId: string | null;
  createdAt: string;
}

/** A persisted claim with its classification status. */
export interface ScanDetailClaim {
  id: string;
  snapshotId: string;
  claimType: ClaimRow["claimType"];
  statementText: string;
  evidenceText: string;
  confidence: number;
  claimStatus: ClaimRow["claimStatus"];
  riskLevel: string | null;
  createdAt: string;
}

/** The strategy verdict concluding the scan. */
export interface ScanDetailVerdict {
  id: string;
  strategyPrediction: VerdictRow["strategyPrediction"];
  confidence: number;
  riskScore: number;
  recommendedActions: string[];
  keyEvidence: string[];
  counterEvidence: string[];
  isFallback: boolean;
  createdAt: string;
}

/**
 * A flattened Evidence_Artifact entry, aligned with the `EvidenceArtifactList`
 * component's `EvidenceArtifact` props (type + Box location, Req 17.4).
 */
export interface EvidenceArtifactSummary {
  type: ArtifactType;
  name?: string;
  boxUrl?: string;
  fileId?: string;
  simulated?: boolean;
}

/** The Box evidence folder link for `BoxEvidenceLink` (Req 10.6). */
export interface EvidenceFolderRef {
  boxFolderId: string;
  url: string;
  simulated: boolean;
}

/** The full `GET /api/scans/:id` response payload (Requirement 21.5). */
export interface ScanDetailResponse {
  scan: ScanDetailScan;
  snapshots: ScanDetailSnapshot[];
  diffs: ScanDetailDiff[];
  claims: ScanDetailClaim[];
  verdict: ScanDetailVerdict | null;
  /** One entry per stored artifact, for `EvidenceArtifactList`. */
  artifacts: EvidenceArtifactSummary[];
  /** The scan's Box evidence folder link, or null when none was recorded. */
  evidenceFolder: EvidenceFolderRef | null;
}

/* -------------------------------------------------------------------------- */
/* Shaping                                                                    */
/* -------------------------------------------------------------------------- */

/** The repository rows the shaper consumes (all already workspace-scoped). */
export interface ScanDetailRows {
  scan: Scan;
  snapshots: Snapshot[];
  diffs: DiffRow[];
  claims: ClaimRow[];
  verdict: VerdictRow | null;
}

/**
 * Optional Box link derivation. The route supplies these from the (pure,
 * non-network) Box adapter so this module stays free of server-only imports.
 */
export interface ScanDetailBoxLinks {
  /** Derive a Box web link for a folder id (e.g. `BoxClient.folderWebLink`). */
  folderWebLink?: (folderId: string) => string;
  /** Whether Box storage is simulated/mock for this run. */
  boxSimulated?: boolean;
}

function artifactRef(
  url: string | null | undefined,
  key: string | null | undefined,
  boxFileId: string | null | undefined,
): BoxArtifactRef {
  return {
    url: url ?? null,
    key: key ?? null,
    boxFileId: boxFileId ?? null,
  };
}

/** True when an artifact reference carries any locating identifier. */
function hasLocation(ref: BoxArtifactRef): boolean {
  return ref.url !== null || ref.boxFileId !== null || ref.key !== null;
}

/** Build a flattened {@link EvidenceArtifactSummary} from a Box reference. */
function toArtifactSummary(
  type: ArtifactType,
  ref: BoxArtifactRef,
  simulated: boolean,
  name?: string,
): EvidenceArtifactSummary {
  const summary: EvidenceArtifactSummary = { type, simulated };
  if (name !== undefined) summary.name = name;
  if (ref.url !== null) summary.boxUrl = ref.url;
  if (ref.boxFileId !== null) summary.fileId = ref.boxFileId;
  return summary;
}

/**
 * Shape workspace-scoped scan rows into the `GET /api/scans/:id` payload.
 * Pure and total: it never throws and produces a complete, render-ready shape
 * for the Scan detail page and the polling client.
 */
export function shapeScanDetail(
  rows: ScanDetailRows,
  links: ScanDetailBoxLinks = {},
): ScanDetailResponse {
  const { scan, snapshots, diffs, claims, verdict } = rows;
  const boxSimulated = links.boxSimulated ?? false;

  const shapedSnapshots: ScanDetailSnapshot[] = snapshots.map((s) => ({
    id: s.id,
    watchedSourceId: s.watchedSourceId,
    contentHash: s.contentHash ?? null,
    normalizedTextHash: s.normalizedTextHash ?? null,
    simulated: s.simulated,
    createdAt: s.createdAt,
    artifacts: {
      raw: artifactRef(s.rawArtifactUrl, s.rawArtifactKey, s.rawBoxFileId),
      normalized: artifactRef(
        s.normalizedArtifactUrl,
        s.normalizedArtifactKey,
        s.normalizedBoxFileId,
      ),
      screenshot: artifactRef(
        s.screenshotArtifactUrl,
        s.screenshotArtifactKey,
        s.screenshotBoxFileId,
      ),
    },
  }));

  const shapedDiffs: ScanDetailDiff[] = diffs.map((d) => ({
    id: d.id,
    priorSnapshotId: d.priorSnapshotId,
    currentSnapshotId: d.currentSnapshotId,
    changeScore: d.changeScore,
    changeSummary: d.changeSummary,
    addedText: d.addedText,
    removedText: d.removedText,
    modifiedSections: d.modifiedSections,
    diffBoxFileId: d.diffBoxFileId ?? null,
    createdAt: d.createdAt,
  }));

  const shapedClaims: ScanDetailClaim[] = claims.map((c) => ({
    id: c.id,
    snapshotId: c.snapshotId,
    claimType: c.claimType,
    statementText: c.statementText,
    evidenceText: c.evidenceText,
    confidence: c.confidence,
    claimStatus: c.claimStatus ?? null,
    riskLevel: c.riskLevel ?? null,
    createdAt: c.createdAt,
  }));

  const shapedVerdict: ScanDetailVerdict | null = verdict
    ? {
        id: verdict.id,
        strategyPrediction: verdict.strategyPrediction,
        confidence: verdict.confidence,
        riskScore: verdict.riskScore,
        recommendedActions: verdict.recommendedActions,
        keyEvidence: verdict.keyEvidence,
        counterEvidence: verdict.counterEvidence,
        isFallback: verdict.isFallback,
        createdAt: verdict.createdAt,
      }
    : null;

  // Flatten per-snapshot + per-diff Box references into a single artifact list
  // for EvidenceArtifactList (one entry per stored artifact).
  const artifacts: EvidenceArtifactSummary[] = [];
  for (const s of shapedSnapshots) {
    if (hasLocation(s.artifacts.raw)) {
      artifacts.push(toArtifactSummary("raw", s.artifacts.raw, s.simulated));
    }
    if (hasLocation(s.artifacts.normalized)) {
      artifacts.push(
        toArtifactSummary("normalized", s.artifacts.normalized, s.simulated),
      );
    }
    if (hasLocation(s.artifacts.screenshot)) {
      artifacts.push(
        toArtifactSummary("screenshot", s.artifacts.screenshot, s.simulated),
      );
    }
  }
  for (const d of shapedDiffs) {
    if (d.diffBoxFileId !== null) {
      artifacts.push(
        toArtifactSummary(
          "diff",
          { url: null, key: null, boxFileId: d.diffBoxFileId },
          boxSimulated,
        ),
      );
    }
  }

  const boxScanFolderId = scan.boxScanFolderId ?? null;
  const evidenceFolder: EvidenceFolderRef | null =
    boxScanFolderId !== null
      ? {
          boxFolderId: boxScanFolderId,
          url: links.folderWebLink
            ? links.folderWebLink(boxScanFolderId)
            : boxScanFolderId,
          simulated: boxSimulated,
        }
      : null;

  return {
    scan: {
      id: scan.id,
      companyId: scan.companyId,
      status: scan.status,
      triggerType: scan.triggerType,
      failureReason: scan.failureReason ?? null,
      boxScanFolderId,
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
    },
    snapshots: shapedSnapshots,
    diffs: shapedDiffs,
    claims: shapedClaims,
    verdict: shapedVerdict,
    artifacts,
    evidenceFolder,
  };
}
