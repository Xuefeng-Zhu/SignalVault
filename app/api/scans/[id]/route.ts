import { getBoxClient as getStorageClient } from "@/lib/adapters/factory";
import { errorResponse, jsonResponse } from "@/lib/api/errors";
import { requireActiveWorkspace } from "@/lib/api/workspace";
import { shapeScanDetail } from "@/lib/api/scan-detail";

/**
 * `GET /api/scans/:id` — Scan status + snapshots + diffs + claims + verdict +
 * Box evidence artifacts, all scoped to the active Workspace (Requirement 21.5;
 * design "API Routes").
 *
 * ## Security posture (network-exposed + polled)
 *
 * This route is reachable from the network and is polled frequently by the
 * Scan detail client (the ScanProgressTimeline falls back to polling this
 * endpoint at an interval ≤ 5s when realtime is unavailable — design "Realtime
 * With Polling Fallback", Req 7.3/7.4). It therefore enforces auth + tenancy on
 * EVERY call:
 *
 *  1. {@link requireActiveWorkspace} resolves the active workspace from the
 *     InsForge session (httpOnly cookie). No/invalid session → `401
 *     UNAUTHORIZED` (the API equivalent of the page redirect).
 *  2. It returns a repository ALREADY bound to that workspace, so `scans.get`
 *     and every `*.listForScan` are constrained to the caller's tenant. A scan
 *     in another workspace — even one the user belongs to but has not made
 *     active — resolves to `null`, which we surface as `404 NOT_FOUND` with no
 *     other-tenant data in the body (Requirements 21.7, 1.5). Postgres RLS
 *     (the user's token is threaded into the live client) is an independent
 *     second layer behind this app-level scoping.
 *
 * ## Efficiency
 *
 * After confirming the scan is in-workspace we read snapshots/diffs/claims/
 * verdict CONCURRENTLY (`Promise.all`), keeping the polled path to two
 * round-trip waves. The Box folder web link is derived purely (no network).
 *
 * The response is `dynamic` (never cached): it depends on the session cookie
 * and on live scan progress, so each poll must reflect the current status.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const scanId = params.id;
  if (!scanId) {
    return errorResponse("VALIDATION", "A scan id is required.", "id");
  }

  // 1) Auth + active-workspace resolution (401 on no session; nothing scoped).
  const guard = await requireActiveWorkspace();
  if (!guard.ok) {
    return guard.response;
  }
  // 2) Bind every read to the active workspace (Requirements 1.4, 21.7).
  const repo = guard.insforge.scoped(guard.workspace.id);

  try {
    // 3) Confirm the scan is in the active workspace. A scan in another
    //    workspace resolves to null here → 404 with no leakage.
    const scan = await repo.scans.get(scanId);
    if (!scan) {
      return errorResponse("NOT_FOUND", "Scan not found.");
    }

    // 4) Read the rest of the scan's evidence concurrently. Each call is
    //    workspace-scoped and returns [] / null for anything out of scope.
    const [snapshots, diffs, claims, verdict] = await Promise.all([
      repo.snapshots.listForScan(scanId),
      repo.diffs.listForScan(scanId),
      repo.claims.listForScan(scanId),
      repo.verdicts.getForScan(scanId),
    ]);

    // 5) Derive the Box evidence-folder link purely (folderWebLink makes no
    //    network call). Construction is cheap and reads no secrets at call time.
    const storage = getStorageClient();
    const payload = shapeScanDetail(
      { scan, snapshots, diffs, claims, verdict },
      {
        folderWebLink: (folderId) => storage.folderWebLink(folderId),
        boxSimulated: storage.mode === "demo",
      },
    );

    return jsonResponse(payload);
  } catch {
    // Never surface internals (or other-tenant data) to the browser.
    return errorResponse("INTERNAL", "Failed to load the scan.");
  }
}
