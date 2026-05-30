// Pure row mappers between SignalVault's camelCase adapter types and the
// snake_case InsForge Postgres columns. This module is the single translation
// layer the live repository uses for every read and write.
//
// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the mapping logic stays unit-testable
// while the live *client entry* (`./live`) remains server-only — mirroring the
// apify adapter's `live` / `live-capture` split.
//
// Two directions are provided:
//   * `from*Row(row)`  — DB row (snake_case, JSON-ish values) -> adapter type.
//   * `to*Insert(...)` — adapter insert shape -> snake_case insert object that
//                        InsForge persists. Inserts are always issued in array
//                        form by the repository (InsForge convention, Req 20.1).
//
// Mapping notes (design "InsForge Postgres Schema"):
//   * `workspace_id` is supplied by the repository (it is bound to a workspace),
//     so workspace-owned insert builders take the id as an explicit argument.
//   * Child tables (watched_sources / snapshots / diffs / claims) carry no
//     `workspace_id`; their scoping is enforced via their parent in the
//     repository (Requirements 1.4, 21.7).
//   * jsonb columns (modified_sections, recommended_actions, key_evidence,
//     counter_evidence) round-trip as arrays.
import type {
  Company,
  DiffRow,
  ClaimRow,
  Integration,
  IntegrationProvider,
  ModifiedSection,
  NewClaim,
  NewCompany,
  NewDiff,
  NewIntegration,
  NewScan,
  NewSnapshot,
  NewVerdict,
  NewWatchedSource,
  Scan,
  Snapshot,
  VerdictRow,
  WatchedSource,
  Workspace,
} from "@/lib/adapters/types";
import type { ClaimStatus, ClaimType, SourceType, Strategy } from "@/lib/schemas";

/** A raw row returned by the InsForge database client (PostgREST JSON). */
export type DbRow = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Coercion helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Coerce a present DB value to string. */
function str(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** Coerce a DB value to `string`, mapping SQL NULL / missing to `null`. */
function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}

/**
 * Coerce a DB value to a number. PostgREST may serialize `numeric` columns
 * (e.g. claims.confidence) as strings to preserve precision, so non-number
 * values are parsed with `Number`.
 */
function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** Coerce a DB value to boolean. */
function bool(value: unknown): boolean {
  return value === true || value === "true" || value === "t";
}

/** Coerce a jsonb array column to `string[]`; non-arrays become `[]`. */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str) : [];
}

/** Coerce a jsonb array column to {@link ModifiedSection}[]; non-arrays -> `[]`. */
function modifiedSections(value: unknown): ModifiedSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const section = (entry ?? {}) as Record<string, unknown>;
    return {
      heading: str(section.heading),
      before: str(section.before),
      after: str(section.after),
    };
  });
}

/** Drop keys whose value is `undefined` so they fall back to column defaults. */
function compact(object: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(object)) {
    if (object[key] === undefined) {
      delete object[key];
    }
  }
  return object;
}

/* -------------------------------------------------------------------------- */
/* Row -> adapter type                                                        */
/* -------------------------------------------------------------------------- */

export function fromWorkspaceRow(row: DbRow): Workspace {
  return {
    id: str(row.id),
    name: str(row.name),
    isDemo: bool(row.is_demo),
    createdAt: str(row.created_at),
  };
}

export function fromCompanyRow(row: DbRow): Company {
  return {
    id: str(row.id),
    workspaceId: str(row.workspace_id),
    name: str(row.name),
    domain: str(row.domain),
    slug: str(row.slug),
    createdAt: str(row.created_at),
  };
}

export function fromWatchedSourceRow(row: DbRow): WatchedSource {
  return {
    id: str(row.id),
    companyId: str(row.company_id),
    url: str(row.url),
    sourceType: str(row.source_type) as SourceType,
    createdAt: str(row.created_at),
  };
}

export function fromScanRow(row: DbRow): Scan {
  return {
    id: str(row.id),
    workspaceId: str(row.workspace_id),
    companyId: str(row.company_id),
    status: str(row.status) as Scan["status"],
    triggerType: str(row.trigger_type),
    failureReason: strOrNull(row.failure_reason),
    boxScanFolderId: strOrNull(row.box_scan_folder_id),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function fromSnapshotRow(row: DbRow): Snapshot {
  return {
    id: str(row.id),
    scanId: str(row.scan_id),
    watchedSourceId: str(row.watched_source_id),
    rawArtifactUrl: strOrNull(row.raw_artifact_url),
    rawArtifactKey: strOrNull(row.raw_artifact_key),
    rawBoxFileId: strOrNull(row.raw_box_file_id),
    normalizedArtifactUrl: strOrNull(row.normalized_artifact_url),
    normalizedArtifactKey: strOrNull(row.normalized_artifact_key),
    normalizedBoxFileId: strOrNull(row.normalized_box_file_id),
    screenshotArtifactUrl: strOrNull(row.screenshot_artifact_url),
    screenshotArtifactKey: strOrNull(row.screenshot_artifact_key),
    screenshotBoxFileId: strOrNull(row.screenshot_box_file_id),
    contentHash: strOrNull(row.content_hash),
    normalizedTextHash: strOrNull(row.normalized_text_hash),
    simulated: bool(row.simulated),
    createdAt: str(row.created_at),
  };
}

export function fromDiffRow(row: DbRow): DiffRow {
  return {
    id: str(row.id),
    scanId: str(row.scan_id),
    priorSnapshotId: strOrNull(row.prior_snapshot_id),
    currentSnapshotId: str(row.current_snapshot_id),
    changeScore: num(row.change_score),
    changeSummary: str(row.change_summary),
    addedText: str(row.added_text),
    removedText: str(row.removed_text),
    modifiedSections: modifiedSections(row.modified_sections),
    diffBoxFileId: strOrNull(row.diff_box_file_id),
    createdAt: str(row.created_at),
  };
}

export function fromClaimRow(row: DbRow): ClaimRow {
  return {
    id: str(row.id),
    scanId: str(row.scan_id),
    snapshotId: str(row.snapshot_id),
    claimType: str(row.claim_type) as ClaimType,
    statementText: str(row.statement_text),
    evidenceText: str(row.evidence_text),
    confidence: num(row.confidence),
    claimStatus: (strOrNull(row.claim_status) as ClaimStatus | null) ?? null,
    riskLevel: strOrNull(row.risk_level),
    createdAt: str(row.created_at),
  };
}

export function fromVerdictRow(row: DbRow): VerdictRow {
  return {
    id: str(row.id),
    scanId: str(row.scan_id),
    workspaceId: str(row.workspace_id),
    strategyPrediction: str(row.strategy_prediction) as Strategy,
    confidence: num(row.confidence),
    riskScore: num(row.risk_score),
    recommendedActions: strArray(row.recommended_actions),
    keyEvidence: strArray(row.key_evidence),
    counterEvidence: strArray(row.counter_evidence),
    isFallback: bool(row.is_fallback),
    createdAt: str(row.created_at),
  };
}

export function fromIntegrationRow(row: DbRow): Integration {
  return {
    id: str(row.id),
    workspaceId: str(row.workspace_id),
    provider: str(row.provider) as IntegrationProvider,
    credentialCiphertext: strOrNull(row.credential_ciphertext),
    isMock: bool(row.is_mock),
    createdAt: str(row.created_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Adapter insert shape -> snake_case insert row                              */
/* -------------------------------------------------------------------------- */

export function toCompanyInsert(workspaceId: string, row: NewCompany): DbRow {
  return {
    workspace_id: workspaceId,
    name: row.name,
    domain: row.domain,
    slug: row.slug,
  };
}

export function toCompanyUpdate(patch: Partial<NewCompany>): DbRow {
  return compact({
    name: patch.name,
    domain: patch.domain,
    slug: patch.slug,
  });
}

export function toWatchedSourceInsert(row: NewWatchedSource): DbRow {
  return {
    company_id: row.companyId,
    url: row.url,
    source_type: row.sourceType,
  };
}

export function toScanInsert(workspaceId: string, row: NewScan): DbRow {
  return {
    workspace_id: workspaceId,
    company_id: row.companyId,
    status: row.status ?? "queued",
    trigger_type: row.triggerType,
    failure_reason: row.failureReason ?? null,
    box_scan_folder_id: row.boxScanFolderId ?? null,
  };
}

export function toSnapshotInsert(row: NewSnapshot): DbRow {
  return {
    scan_id: row.scanId,
    watched_source_id: row.watchedSourceId,
    raw_artifact_url: row.rawArtifactUrl ?? null,
    raw_artifact_key: row.rawArtifactKey ?? null,
    raw_box_file_id: row.rawBoxFileId ?? null,
    normalized_artifact_url: row.normalizedArtifactUrl ?? null,
    normalized_artifact_key: row.normalizedArtifactKey ?? null,
    normalized_box_file_id: row.normalizedBoxFileId ?? null,
    screenshot_artifact_url: row.screenshotArtifactUrl ?? null,
    screenshot_artifact_key: row.screenshotArtifactKey ?? null,
    screenshot_box_file_id: row.screenshotBoxFileId ?? null,
    content_hash: row.contentHash ?? null,
    normalized_text_hash: row.normalizedTextHash ?? null,
    simulated: row.simulated,
  };
}

/**
 * Partial snapshot update (after upload + normalization). Only keys present in
 * `patch` are written; an explicit `null` clears the column, `undefined` keys
 * are dropped so the existing value is preserved. Both `url` and `key` evidence
 * refs are persisted together per the InsForge storage convention (AGENTS.md).
 */
export function toSnapshotUpdate(patch: Partial<NewSnapshot>): DbRow {
  return compact({
    scan_id: patch.scanId,
    watched_source_id: patch.watchedSourceId,
    raw_artifact_url: patch.rawArtifactUrl,
    raw_artifact_key: patch.rawArtifactKey,
    raw_box_file_id: patch.rawBoxFileId,
    normalized_artifact_url: patch.normalizedArtifactUrl,
    normalized_artifact_key: patch.normalizedArtifactKey,
    normalized_box_file_id: patch.normalizedBoxFileId,
    screenshot_artifact_url: patch.screenshotArtifactUrl,
    screenshot_artifact_key: patch.screenshotArtifactKey,
    screenshot_box_file_id: patch.screenshotBoxFileId,
    content_hash: patch.contentHash,
    normalized_text_hash: patch.normalizedTextHash,
    simulated: patch.simulated,
  });
}

export function toDiffInsert(row: NewDiff): DbRow {
  return {
    scan_id: row.scanId,
    prior_snapshot_id: row.priorSnapshotId,
    current_snapshot_id: row.currentSnapshotId,
    change_score: row.changeScore,
    change_summary: row.changeSummary,
    added_text: row.addedText,
    removed_text: row.removedText,
    modified_sections: row.modifiedSections,
    diff_box_file_id: row.diffBoxFileId ?? null,
  };
}

export function toClaimInsert(row: NewClaim): DbRow {
  return {
    scan_id: row.scanId,
    snapshot_id: row.snapshotId,
    claim_type: row.claimType,
    statement_text: row.statementText,
    evidence_text: row.evidenceText,
    confidence: row.confidence,
    claim_status: row.claimStatus ?? null,
    risk_level: row.riskLevel ?? null,
  };
}

export function toVerdictInsert(workspaceId: string, row: NewVerdict): DbRow {
  return {
    scan_id: row.scanId,
    workspace_id: workspaceId,
    strategy_prediction: row.strategyPrediction,
    confidence: row.confidence,
    risk_score: row.riskScore,
    recommended_actions: row.recommendedActions,
    key_evidence: row.keyEvidence,
    counter_evidence: row.counterEvidence,
    is_fallback: row.isFallback,
  };
}

export function toIntegrationInsert(workspaceId: string, row: NewIntegration): DbRow {
  return {
    workspace_id: workspaceId,
    provider: row.provider,
    credential_ciphertext: row.credentialCiphertext ?? null,
    is_mock: row.isMock,
  };
}
