/**
 * Barrel for SignalVault's shared API-route helpers.
 *
 * - `./errors` — the canonical {@link ApiError} envelope + JSON response
 *   builders. Two flavours: Web `Response` (`errorResponse` / `jsonResponse`)
 *   and `NextResponse` (`jsonError` / `jsonOk` / `parseJsonBody`).
 * - `./scan-detail` — pure response shaping for `GET /api/scans/:id`.
 *
 * The `server-only` workspace guard (`./workspace`) is intentionally NOT
 * re-exported here so this barrel stays free of the `server-only` runtime
 * guard; import it directly from route handlers.
 */
export {
  type ApiError,
  type ApiErrorCode,
  type ParsedBody,
  API_ERROR_STATUS,
  apiErrorBody,
  apiError,
  apiOk,
  errorResponse,
  jsonResponse,
  jsonError,
  jsonOk,
  parseJsonBody,
} from "./errors";

export {
  type ScanDetailResponse,
  type ScanDetailRows,
  type ScanDetailBoxLinks,
  type ScanDetailScan,
  type ScanDetailSnapshot,
  type ScanDetailDiff,
  type ScanDetailClaim,
  type ScanDetailVerdict,
  type EvidenceArtifactSummary,
  type EvidenceFolderRef,
  type BoxArtifactRef,
  shapeScanDetail,
} from "./scan-detail";
