/**
 * Pure, framework-free core for the `/api/companies` collection endpoints
 * (task 20.1; Requirements 21.1, 4.1–4.8, 3.1).
 *
 * No `server-only`, no `next/*` imports: this module contains the validation,
 * atomic create, and list-shaping logic, parameterised over an injected
 * {@link WorkspaceRepository}. The route handler (`app/api/companies/route.ts`)
 * supplies a workspace-scoped repository (after auth) and adapts the
 * discriminated results below to HTTP responses; the property tests (20.2 /
 * 20.3 / 20.4) import these functions directly and drive them with an in-memory
 * repository, with no HTTP or auth in the loop.
 *
 * `import type` for the adapter surface keeps this module out of the
 * `server-only` runtime guard that `@/lib/adapters/types` pulls in — mirroring
 * the live/demo repository cores — so it stays importable from plain test
 * runtimes.
 */

import {
  AddCompanyFormSchema,
  type SourceType,
  type Strategy,
} from "@/lib/schemas";
import type { ApiErrorCode } from "@/lib/api/errors";
import type {
  Company,
  ScanStatus,
  WatchedSource,
  WorkspaceRepository,
} from "@/lib/adapters/types";

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

/** A field-level error describing why an Add Company request was rejected. */
export interface CompanyError {
  /** Maps to an {@link ApiErrorCode}: `VALIDATION` (4.3–4.6) or `INTERNAL` (4.8). */
  code: Extract<ApiErrorCode, "VALIDATION" | "INTERNAL">;
  /** Human-readable message; for validation, the schema's field message. */
  message: string;
  /**
   * Dotted path identifying the offending field/URL when known, e.g. `name`,
   * `domain`, `urls` (count), or `urls.0.url` (a specific row). Absent for
   * `INTERNAL` failures.
   */
  field?: string;
}

/** Discriminated result of {@link createCompany}. */
export type CreateCompanyResult =
  | { ok: true; company: Company; sources: WatchedSource[] }
  | { ok: false; error: CompanyError };

/** Generic message surfaced when persistence fails partway (Requirement 4.8). */
const CREATE_FAILED_MESSAGE = "The company could not be created.";

/**
 * Derive a path-safe slug from a company name. Deterministic: lowercases,
 * replaces any run of non-alphanumeric characters with a single hyphen, and
 * trims leading/trailing hyphens. Falls back to `company` when the name has no
 * usable characters (the schema still requires a non-empty name, so this only
 * guards exotic inputs like a name of all punctuation). The DB does not require
 * slug uniqueness, so collisions across companies are acceptable.
 */
export function slugifyCompanyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "company";
}

/**
 * Validate an Add Company request body and, when valid, create exactly one
 * Company plus one Watched_Source per URL in the bound workspace, atomically.
 *
 * Validation (server-side, reusing {@link AddCompanyFormSchema}):
 *  - name 1–200 chars (4.5), domain a syntactically valid hostname (4.5),
 *  - 3–5 URLs (4.3), each a valid http(s) URL (4.4) with a source type drawn
 *    from `SourceTypeEnum` (4.2), and no duplicate URLs (4.6).
 * On any validation failure NOTHING is created and a `VALIDATION` error is
 * returned naming the offending field/URL.
 *
 * Atomic create (Requirements 4.1, 4.7, 4.8): the Company row is created first,
 * then its Watched_Sources (one per URL). Watched_Sources are therefore created
 * only when the Company was created successfully (4.7). InsForge does not expose
 * a multi-statement transaction here, so atomicity is **best-effort**: if source
 * creation fails after the company row exists, the now-orphaned company is
 * deleted (cascading to any partially-written sources) so no records persist on
 * partial failure (4.8). If that compensating delete itself fails, the error is
 * swallowed — the request still reports failure and never reports success for a
 * half-created company.
 *
 * The repository is already workspace-scoped, so every write lands in — and is
 * constrained to — the active workspace (Requirements 1.4, 21.7).
 */
export async function createCompany(
  repo: WorkspaceRepository,
  body: unknown,
): Promise<CreateCompanyResult> {
  const parsed = AddCompanyFormSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field =
      issue && issue.path.length > 0 ? issue.path.join(".") : undefined;
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: issue?.message ?? "Invalid company.",
        ...(field !== undefined ? { field } : {}),
      },
    };
  }

  const { name, domain, urls } = parsed.data;
  const trimmedName = name.trim();
  const trimmedDomain = domain.trim();

  // Step 1: create the Company row. A throw here means nothing was persisted.
  let company: Company;
  try {
    const created = await repo.companies.create([
      {
        name: trimmedName,
        domain: trimmedDomain,
        slug: slugifyCompanyName(trimmedName),
      },
    ]);
    const first = created[0];
    if (!first) {
      return { ok: false, error: { code: "INTERNAL", message: CREATE_FAILED_MESSAGE } };
    }
    company = first;
  } catch {
    return { ok: false, error: { code: "INTERNAL", message: CREATE_FAILED_MESSAGE } };
  }

  // Step 2: create one Watched_Source per URL (4.1). Only reached because the
  // Company was created successfully (4.7).
  try {
    const sources = await repo.companies.addSources(
      urls.map((row) => ({
        companyId: company.id,
        url: row.url.trim(),
        sourceType: row.sourceType,
      })),
    );
    return { ok: true, company, sources };
  } catch {
    // Best-effort rollback so a partial failure persists no records (4.8).
    await rollbackCompany(repo, company.id);
    return { ok: false, error: { code: "INTERNAL", message: CREATE_FAILED_MESSAGE } };
  }
}

/** Delete an orphaned company, swallowing any error from the compensating delete. */
async function rollbackCompany(
  repo: WorkspaceRepository,
  companyId: string,
): Promise<void> {
  try {
    await repo.companies.delete(companyId);
  } catch {
    // The rollback itself failed; we still report the create as failed and
    // never report success. Surfacing this secondary failure would not help
    // the caller and risks leaking internals.
  }
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

/** Most-recent-scan summary shown on a dashboard CompanyCard (Req 3.2). */
export interface CompanyListLatestScan {
  status: ScanStatus;
  createdAt: string;
}

/** Verdict summary shown on a CompanyCard when the latest scan has one (Req 3.6). */
export interface CompanyListVerdict {
  strategyPrediction: Strategy;
  riskScore: number;
}

/** One company entry shaped for the dashboard (aligns with `CompanyCard`). */
export interface CompanyListItem {
  id: string;
  name: string;
  domain: string;
  /** Count of Watched_Sources (Req 3.2). */
  sourceCount: number;
  /** Most recent scan, or null when the company has never been scanned (Req 3.7). */
  latestScan: CompanyListLatestScan | null;
  /** Verdict of the most recent scan when it has completed (Req 3.6). */
  verdict: CompanyListVerdict | null;
}

/** Response body for `GET /api/companies`. */
export interface ListCompaniesResult {
  companies: CompanyListItem[];
}

/**
 * Case-insensitive ascending comparison by name, with a stable tiebreak on id
 * so equal names keep a deterministic order (Requirement 3.1).
 */
function byNameCaseInsensitive(a: Company, b: Company): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * List the bound workspace's companies for the dashboard, ordered
 * alphabetically by name (case-insensitive, ascending) and losslessly — every
 * company in the workspace appears exactly once (Requirement 3.1).
 *
 * For each company it derives the Watched_Source count and a summary of the
 * most recent scan (status + start time), enriching that summary with the
 * scan's verdict (strategy prediction + risk score) when the scan has completed
 * (Requirements 3.2, 3.6, 3.7). Per-company reads run concurrently.
 */
export async function listCompanies(
  repo: WorkspaceRepository,
): Promise<ListCompaniesResult> {
  const companies = [...(await repo.companies.list())].sort(byNameCaseInsensitive);

  const items = await Promise.all(
    companies.map(async (company): Promise<CompanyListItem> => {
      const [sources, scans] = await Promise.all([
        repo.companies.listSources(company.id),
        repo.scans.listForCompany(company.id), // newest first
      ]);

      const latest = scans[0] ?? null;
      let verdict: CompanyListVerdict | null = null;
      if (latest && latest.status === "completed") {
        const row = await repo.verdicts.getForScan(latest.id);
        if (row) {
          verdict = {
            strategyPrediction: row.strategyPrediction,
            riskScore: row.riskScore,
          };
        }
      }

      return {
        id: company.id,
        name: company.name,
        domain: company.domain,
        sourceCount: sources.length,
        latestScan: latest
          ? { status: latest.status, createdAt: latest.createdAt }
          : null,
        verdict,
      };
    }),
  );

  return { companies: items };
}

export type { SourceType };
