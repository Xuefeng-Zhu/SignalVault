import { errorResponse, jsonResponse } from "@/lib/api/errors";
import { requireActiveWorkspace } from "@/lib/api/workspace";
import { createCompany, listCompanies } from "@/lib/api/companies";

/**
 * `/api/companies` collection endpoints (task 20.1).
 *
 *  - `POST` creates one Company + one Watched_Source per URL in the active
 *    workspace, atomically (Requirements 21.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6,
 *    4.7, 4.8).
 *  - `GET` lists the active workspace's companies for the dashboard, ordered
 *    alphabetically (Requirements 21.1, 3.1).
 *
 * ## Security posture (network-exposed)
 *
 * Both handlers are reachable from the network and MUST enforce auth +
 * workspace scoping before touching any tenant data. They resolve the active
 * workspace via {@link requireActiveWorkspace} (which reads the InsForge session
 * from an httpOnly cookie) and then operate ONLY through a workspace-scoped
 * repository (`insforge.scoped(workspace.id)`):
 *  - Unauthenticated / unresolvable session → `401 UNAUTHORIZED` and NO scoped
 *    data (the API equivalent of the page redirect; Requirement 1.1). A scoped
 *    listing or create is never performed for an unauthenticated caller.
 *  - Creates land only in the caller's workspace and the listing excludes every
 *    other tenant (Requirements 1.4, 21.7). The live client is token-bound, so
 *    Postgres RLS independently enforces the same boundary.
 *
 * The validate/create/list logic lives in the pure, importable core
 * `@/lib/api/companies` (no HTTP/auth), which the property tests drive
 * directly; these handlers only adapt the core's discriminated results to the
 * standard {@link ApiError} envelope and HTTP status codes.
 *
 * Responses are dynamic (session- and data-dependent), never cached.
 */
export const dynamic = "force-dynamic";

/**
 * `POST /api/companies` — validate the body server-side (reusing the company
 * schema) and atomically create the Company + Watched_Sources. Returns `201`
 * with `{ company, sources }` on success; `400 VALIDATION` (with the offending
 * `field`) on invalid input (Req 4.3–4.6); `500 INTERNAL` when persistence
 * fails partway and no records remain (Req 4.8).
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireActiveWorkspace();
  if (!guard.ok) {
    // Unauthenticated — never create or return scoped data (Req 1.1, 21.7).
    return guard.response;
  }
  const repo = guard.insforge.scoped(guard.workspace.id);

  // Parse the JSON body defensively; a malformed/empty body is a validation
  // error rather than a 500. The core performs the schema validation.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION", "Request body must be valid JSON.");
  }

  const result = await createCompany(repo, body);
  if (!result.ok) {
    return errorResponse(
      result.error.code,
      result.error.message,
      result.error.field,
    );
  }

  // 201 Created with the new company and its watched sources.
  return jsonResponse(
    { company: result.company, sources: result.sources },
    201,
  );
}

/**
 * `GET /api/companies` — list the active workspace's companies for the
 * dashboard, alphabetically by name (case-insensitive ascending), each with its
 * Watched_Source count and a most-recent-scan summary (+ verdict when complete)
 * for the CompanyCard (Requirements 21.1, 3.1, 3.2, 3.6, 3.7).
 */
export async function GET(): Promise<Response> {
  const guard = await requireActiveWorkspace();
  if (!guard.ok) {
    return guard.response;
  }
  const repo = guard.insforge.scoped(guard.workspace.id);

  try {
    const result = await listCompanies(repo);
    return jsonResponse(result);
  } catch {
    // Never surface internals (or other-tenant data) to the browser. The
    // dashboard renders its error+retry state on a non-OK response (Req 3.8).
    return errorResponse("INTERNAL", "Failed to load companies.");
  }
}
