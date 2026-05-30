import { errorResponse, jsonResponse } from "@/lib/api/errors";
import { requireActiveWorkspace } from "@/lib/api/workspace";
import type {
  ClaimRow,
  Company,
  Scan,
  VerdictRow,
  WatchedSource,
} from "@/lib/adapters/types";

/**
 * `GET /api/companies/:id` — retrieve a single Company within the active
 * Workspace, returning the Company with its Watched_Sources, its most recent
 * Scan, and (when that scan has completed) the scan's Verdict and Claims
 * (Requirement 21.2; design "API Routes").
 *
 * ## Security posture (network-exposed; Requirements 21.7, 1.5)
 *
 * This route is reachable from the network, so it enforces auth + workspace
 * scoping before reading any tenant data:
 *  - {@link requireActiveWorkspace} resolves the active workspace from the
 *    InsForge session (httpOnly cookie). No/invalid session → `401
 *    UNAUTHORIZED` and NO scoped data (the API equivalent of the page redirect,
 *    Requirement 1.1).
 *  - We derive a repository bound to that workspace
 *    (`insforge.scoped(workspace.id)`), so `companies.get` and every
 *    `*.listForCompany`/`*.listForScan` read is constrained to the caller's
 *    tenant. A company owned by another workspace — even one the user belongs
 *    to but has not made active — resolves to `null`, which we surface as `404
 *    NOT_FOUND` (not `403`) so the response never reveals that the id exists in
 *    a different tenant; no attributes leak (Requirement 1.5). Postgres RLS
 *    (the user's token is threaded into the live client) is an independent
 *    second layer behind this app-level scoping.
 *  - The handler is read-only: it leaves the resource and all workspace data
 *    unchanged (Requirement 1.5).
 *
 * The response depends on the session cookie and live scan progress, so it is
 * never cached.
 */
export const dynamic = "force-dynamic";

/** The most recent Scan, enriched with verdict + claims once it has completed. */
type LatestScan = Scan & {
  verdict?: VerdictRow;
  claims?: ClaimRow[];
};

/** Successful `GET /api/companies/:id` body. */
interface CompanyDetailResponse {
  company: Company;
  sources: WatchedSource[];
  /**
   * The Company's most recent Scan (by creation time), if any. When that scan
   * has reached `completed`, its `verdict` and `claims` are included so the
   * company detail page can render the latest results (Requirement 21.2).
   */
  latestScan?: LatestScan;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const companyId = params.id;
  if (!companyId) {
    return errorResponse("VALIDATION", "A company id is required.", "id");
  }

  // 1) Auth + active-workspace resolution (401 on no session; nothing scoped).
  const guard = await requireActiveWorkspace();
  if (!guard.ok) {
    return guard.response;
  }
  // 2) Bind every read to the active workspace (Requirements 1.4, 21.7).
  const repo = guard.insforge.scoped(guard.workspace.id);

  try {
    // 3) Workspace-scoped read: a company in another tenant resolves to null.
    //    We do not distinguish "absent" from "belongs to another workspace" —
    //    both return 404 so cross-tenant existence is never leaked (Req 1.5).
    const company = await repo.companies.get(companyId);
    if (!company) {
      return errorResponse("NOT_FOUND", "Company not found.");
    }

    // 4) Sources + scan history, read through the same scoped repo.
    const [sources, scans] = await Promise.all([
      repo.companies.listSources(companyId),
      repo.scans.listForCompany(companyId), // newest first
    ]);

    const response: CompanyDetailResponse = { company, sources };

    const latestScan = scans[0];
    if (latestScan) {
      if (latestScan.status === "completed") {
        // 5) Enrich the most recent scan with its verdict + claims (scoped).
        const [verdict, claims] = await Promise.all([
          repo.verdicts.getForScan(latestScan.id),
          repo.claims.listForScan(latestScan.id),
        ]);
        response.latestScan = {
          ...latestScan,
          ...(verdict ? { verdict } : {}),
          claims,
        };
      } else {
        response.latestScan = latestScan;
      }
    }

    return jsonResponse(response);
  } catch {
    // Never surface internals (or other-tenant data) to the browser.
    return errorResponse("INTERNAL", "Failed to load the company.");
  }
}
