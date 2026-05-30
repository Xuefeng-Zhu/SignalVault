import Link from "next/link";
import { redirect } from "next/navigation";

import { ClaimLedger, type ClaimLedgerRow } from "@/components/claim-ledger";
import { RiskBadge } from "@/components/risk-badge";
import { RunScanButton } from "@/components/run-scan-button";
import { StrategyVerdictCard } from "@/components/strategy-verdict-card";
import { WatchedSourcesTable } from "@/components/watched-sources-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import type {
  ClaimRow,
  Company,
  Scan,
  ScanStatus,
  VerdictRow,
  WatchedSource,
  WorkspaceRepository,
} from "@/lib/adapters/types";

/**
 * Company detail page — `/companies/[id]` (Requirement 5; design "Pages").
 *
 * A protected App Router **server component** that loads everything the page
 * needs server-side (auth + workspace-scoped reads) and composes existing
 * presentational components. It renders:
 *  - the Company header: name + domain (Requirement 5.1),
 *  - a {@link WatchedSourcesTable} of each Watched_Source's URL + type (5.1),
 *  - the Scan history, newest → oldest, with status + creation time (5.2),
 *    and an empty state when the Company has no scans (5.3),
 *  - a {@link RunScanButton} (5.4),
 *  - the Claims + Verdict strategy prediction from the most recent **Complete**
 *    scan, when one exists (5.5).
 *
 * ## Auth / redirect / not-found
 *
 * {@link resolveActiveWorkspace} resolves the single active workspace from the
 * session. On a `redirect` outcome (unauthenticated; the middleware normally
 * catches this first, this is the server-side backstop) we `redirect()` to the
 * auth flow with this page as the return target — no scoped content renders
 * (Requirement 1.1). Reads go through a workspace-scoped repository
 * (`insforge.scoped(workspace.id)`), so a company owned by another tenant
 * resolves to `null` and we render an in-page not-found state (no cross-tenant
 * existence is leaked, Requirement 1.5).
 *
 * ## Load failure + 10s timeout (Requirement 5.8)
 *
 * The scoped reads are wrapped in {@link withTimeout}: if they reject, or do not
 * settle within {@link LOAD_TIMEOUT_MS} (10s), the wrapper throws. The throw
 * propagates out of this async server component to the sibling `error.tsx`
 * boundary, which shows an error message + a retry control (`reset()`). Because
 * the page only renders after the load resolves, no partial or stale content is
 * shown on failure. Auth resolution runs *before* the timeout so the
 * `redirect()` (and its `NEXT_REDIRECT` signal) is never swallowed by the race.
 */
export const dynamic = "force-dynamic";

/** Hard ceiling for the company-detail data load before we surface an error (Req 5.8). */
export const LOAD_TIMEOUT_MS = 10_000;

/** Lifecycle labels for the scan history, mirroring the ScanProgressTimeline (Req 7.1). */
const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "Queued",
  scraping: "Scraping",
  uploading: "Uploading to Box",
  diffing: "Diffing",
  analyzing: "Analyzing",
  completed: "Complete",
  failed: "Failed",
};

/** Badge styling per scan status: completed=green, failed=red, otherwise in-progress. */
function scanStatusVariant(
  status: ScanStatus,
): "default" | "secondary" | "destructive" {
  if (status === "failed") return "destructive";
  if (status === "completed") return "default";
  return "secondary";
}

/** The results carried by the most recent Complete scan (Requirement 5.5). */
interface LatestCompleteResults {
  scan: Scan;
  verdict: VerdictRow | null;
  claims: ClaimRow[];
}

/** Everything the page renders, loaded under one workspace-scoped read pass. */
interface CompanyDetail {
  company: Company | null;
  sources: WatchedSource[];
  scans: Scan[];
  latestComplete?: LatestCompleteResults;
}

/**
 * Resolve a promise, but reject with a timeout error if it does not settle
 * within `ms` (Requirement 5.8). The timer is always cleared so a fast resolve
 * never leaves a dangling handle.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Load the company, its sources, its scan history (newest first), and — when a
 * Complete scan exists — the verdict + claims of the **most recent** Complete
 * scan (Requirement 5.5). Returns `company: null` when the id is absent from the
 * active workspace so the caller can render a not-found state without leaking
 * cross-tenant existence (Requirement 1.5).
 */
async function loadCompanyDetail(
  repo: WorkspaceRepository,
  companyId: string,
): Promise<CompanyDetail> {
  const company = await repo.companies.get(companyId);
  if (!company) {
    return { company: null, sources: [], scans: [] };
  }

  const [sources, scans] = await Promise.all([
    repo.companies.listSources(companyId),
    repo.scans.listForCompany(companyId), // newest first
  ]);

  // The most recent *Complete* scan is the first completed entry in the
  // newest-first history (Requirement 5.5).
  const mostRecentComplete = scans.find((scan) => scan.status === "completed");
  if (!mostRecentComplete) {
    return { company, sources, scans };
  }

  const [verdict, claims] = await Promise.all([
    repo.verdicts.getForScan(mostRecentComplete.id),
    repo.claims.listForScan(mostRecentComplete.id),
  ]);

  return {
    company,
    sources,
    scans,
    latestComplete: { scan: mostRecentComplete, verdict, claims },
  };
}

/** Map a persisted {@link ClaimRow} to the shape the {@link ClaimLedger} renders. */
function toClaimLedgerRow(claim: ClaimRow): ClaimLedgerRow {
  return {
    statementText: claim.statementText,
    claimType: claim.claimType,
    claimStatus: claim.claimStatus ?? undefined,
    riskLevel: claim.riskLevel ?? undefined,
    confidence: claim.confidence,
    evidenceText: claim.evidenceText,
  };
}

/** Deterministic, locale-stable timestamp for the scan history (Req 5.2). */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const companyId = params.id;

  // 1) Auth + active-workspace resolution. Runs BEFORE the timeout so the
  //    redirect signal is never caught by the race (Requirement 1.1).
  const resolution = await resolveActiveWorkspace();
  if (resolution.status === "redirect") {
    redirect(
      `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(
        `/companies/${companyId}`,
      )}`,
    );
  }

  // 2) Workspace-scoped reads, bounded by a 10s timeout. A rejection/timeout
  //    throws to the sibling error.tsx boundary (Requirement 5.8).
  const repo = resolution.insforge.scoped(resolution.workspace.id);
  const { company, sources, scans, latestComplete } = await withTimeout(
    loadCompanyDetail(repo, companyId),
    LOAD_TIMEOUT_MS,
    "The company detail did not load within 10 seconds.",
  );

  // 3) Not found within the active workspace → in-page not-found (no leak).
  if (!company) {
    return <CompanyNotFound />;
  }

  const ledgerRows = (latestComplete?.claims ?? []).map(toClaimLedgerRow);
  const verdict = latestComplete?.verdict ?? null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      {/* Back navigation to the dashboard (coordinates with 23.3/23.4). */}
      <nav>
        <Link
          href="/companies"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to companies
        </Link>
      </nav>

      {/* Company header: name + domain (Requirement 5.1) + RunScanButton (5.4). */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">{company.name}</h1>
          <p className="text-muted-foreground">{company.domain}</p>
        </div>
        <RunScanButton companyId={company.id} />
      </header>

      {/* Watched sources (Requirement 5.1). */}
      <section aria-labelledby="watched-sources-heading">
        <Card>
          <CardHeader>
            <CardTitle id="watched-sources-heading" className="text-xl">
              Watched sources
            </CardTitle>
            <CardDescription>
              The public URLs monitored for this company.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WatchedSourcesTable
              sources={sources.map((source) => ({
                url: source.url,
                sourceType: source.sourceType,
              }))}
            />
          </CardContent>
        </Card>
      </section>

      {/* Latest complete results: claims + verdict strategy prediction (Req 5.5).
          Rendered only when a Complete scan exists. */}
      {latestComplete ? (
        <section
          aria-labelledby="latest-results-heading"
          className="flex flex-col gap-4"
        >
          <h2 id="latest-results-heading" className="text-xl font-semibold">
            Latest results
          </h2>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex flex-col gap-3">
              {verdict ? (
                <>
                  <StrategyVerdictCard
                    strategyPrediction={verdict.strategyPrediction}
                    confidence={verdict.confidence}
                  />
                  <div>
                    <RiskBadge score={verdict.riskScore} />
                  </div>
                </>
              ) : (
                <Card>
                  <CardHeader>
                    <CardDescription>Strategy prediction</CardDescription>
                    <CardTitle className="text-lg">
                      No verdict recorded
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      The most recent complete scan did not produce a verdict.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Claims</CardTitle>
                <CardDescription>
                  Extracted from the most recent complete scan.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ClaimLedger claims={ledgerRows} />
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      {/* Scan history, newest → oldest (Requirement 5.2) with empty state (5.3). */}
      <section aria-labelledby="scan-history-heading">
        <Card>
          <CardHeader>
            <CardTitle id="scan-history-heading" className="text-xl">
              Scan history
            </CardTitle>
            <CardDescription>
              Most recent scans first, with status and start time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scans.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                No scans yet for this company. Run a scan to capture evidence.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {scans.map((scan) => (
                  <li key={scan.id}>
                    <Link
                      href={`/scans/${scan.id}`}
                      className="flex items-center justify-between gap-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex items-center gap-3">
                        <Badge variant={scanStatusVariant(scan.status)}>
                          {SCAN_STATUS_LABELS[scan.status]}
                        </Badge>
                        {scan.status === "failed" && scan.failureReason ? (
                          <span className="text-sm text-muted-foreground">
                            {scan.failureReason}
                          </span>
                        ) : null}
                      </span>
                      <time
                        dateTime={scan.createdAt}
                        className="text-sm text-muted-foreground"
                      >
                        {formatTimestamp(scan.createdAt)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

/**
 * In-page not-found state for a company id that is absent from the active
 * workspace (Requirement 1.5). Distinct from the load-failure boundary
 * (`error.tsx`): this is an expected, non-error outcome, so it offers a path
 * back to the dashboard rather than a retry.
 */
function CompanyNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-6 py-24 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Company not found</h1>
        <p className="text-muted-foreground">
          We couldn&rsquo;t find this company in your workspace. It may have been
          removed, or the link may be incorrect.
        </p>
      </div>
      <Link
        href="/companies"
        className={cn(buttonVariants({ variant: "outline" }))}
      >
        Back to companies
      </Link>
    </main>
  );
}
