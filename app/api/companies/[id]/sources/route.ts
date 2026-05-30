import { z } from "zod";

import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/api/errors";
import { requireActiveWorkspace } from "@/lib/api/workspace";
import { isValidHttpUrl, SourceTypeEnum } from "@/lib/schemas";
import type { NewWatchedSource } from "@/lib/adapters/types";

/**
 * `POST /api/companies/:id/sources` — add a Watched_Source to a Company in the
 * active Workspace (Requirements 5.6, 5.7; design "API Routes").
 *
 * Body: a single watched source `{ url, sourceType }`.
 *  - `url` must be a syntactically valid http(s) URL; otherwise the addition is
 *    rejected with `400 VALIDATION` and `field: "url"` (Requirement 5.7).
 *  - `sourceType` must be one of the {@link SourceTypeEnum} categories;
 *    otherwise `400 VALIDATION` with `field: "sourceType"`.
 *
 * On success the source is persisted via `companies.addSources([...])` (array
 * form per InsForge convention) and the created row is returned with `201`
 * (Requirement 5.6).
 *
 * ## Security posture (network-exposed + mutating; Requirements 21.7, 1.5)
 *
 *  - {@link requireActiveWorkspace} enforces auth: no/invalid session → `401
 *    UNAUTHORIZED` and NO scoped data (Requirement 1.1).
 *  - The target company is looked up through the workspace-scoped repository
 *    (`insforge.scoped(workspace.id)`); a company in another tenant resolves to
 *    `null` and we return `404 NOT_FOUND` (never `403`), so cross-tenant
 *    existence is not leaked and NO record is created (Requirement 1.5). The
 *    scope check runs BEFORE body parsing/validation, so a cross-workspace id
 *    cannot probe validation behavior or mutate another tenant. Postgres RLS is
 *    an independent second layer behind this app-level scoping.
 */
export const dynamic = "force-dynamic";

/**
 * Body schema. `url` is validated for http(s) validity in `superRefine` so the
 * issue path is exactly `["url"]`, letting the response name the offending
 * field (Requirement 5.7). `sourceType` validity comes from the enum directly
 * (its invalid-value issue carries path `["sourceType"]`).
 */
const AddSourceBodySchema = z
  .object({
    url: z.string(),
    sourceType: SourceTypeEnum,
  })
  .superRefine((data, ctx) => {
    if (!isValidHttpUrl(data.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Enter a valid http(s) URL.",
      });
    }
  });

export async function POST(
  request: Request,
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
  // 2) Bind every read/write to the active workspace (Requirements 1.4, 21.7).
  const repo = guard.insforge.scoped(guard.workspace.id);

  // 3) Confirm the company is in the active workspace BEFORE validating or
  //    persisting (Requirements 21.7, 1.5). A cross-tenant company resolves to
  //    null → 404, leaking nothing and creating no Watched_Source record.
  let company;
  try {
    company = await repo.companies.get(companyId);
  } catch {
    return errorResponse("INTERNAL", "Failed to load the company.");
  }
  if (!company) {
    return errorResponse("NOT_FOUND", "Company not found.");
  }

  // 4) Parse + validate the body (Req 5.7 + source-type membership). A
  //    malformed body or schema failure becomes a 400 VALIDATION envelope that
  //    names the offending field via `parseJsonBody`'s first-issue path.
  const parsed = await parseJsonBody(request, AddSourceBodySchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  // 5) Persist the new Watched_Source in the active workspace (Requirement 5.6).
  const row: NewWatchedSource = {
    companyId,
    url: parsed.data.url.trim(),
    sourceType: parsed.data.sourceType,
  };

  try {
    const [created] = await repo.companies.addSources([row]);
    return jsonResponse({ source: created }, 201);
  } catch {
    return errorResponse("INTERNAL", "Failed to add the watched source.");
  }
}
