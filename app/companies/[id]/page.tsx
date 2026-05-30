import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RunScanButton } from "@/components/run-scan-button";
import { strategyLabel } from "@/components/strategy-verdict-card";
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

export const dynamic = "force-dynamic";
const LOAD_TIMEOUT_MS = 10_000;

const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "Queued",
  scraping: "Scraping",
  uploading: "Uploading to Box",
  diffing: "Diffing",
  analyzing: "Analyzing",
  completed: "Complete",
  failed: "Failed",
};

interface LatestCompleteResults {
  scan: Scan;
  verdict: VerdictRow | null;
  claims: ClaimRow[];
}

interface CompanyDetail {
  company: Company | null;
  sources: WatchedSource[];
  scans: Scan[];
  latestComplete?: LatestCompleteResults;
}

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
    repo.scans.listForCompany(companyId),
  ]);

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

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function statusBadge(status: ScanStatus): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-100 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-100 text-rose-700";
  return "border-amber-200 bg-amber-100 text-amber-700";
}

function verdictBadge(verdict: VerdictRow | null): { label: string; className: string } {
  if (!verdict) {
    return {
      label: "Awaiting verdict",
      className: "border-amber-200 bg-amber-100 text-amber-700",
    };
  }

  if (
    verdict.strategyPrediction === "moving_upmarket" ||
    verdict.strategyPrediction === "enterprise_readiness"
  ) {
    return {
      label: strategyLabel(verdict.strategyPrediction),
      className: "border-violet-200 bg-violet-100 text-violet-700",
    };
  }

  if (verdict.riskScore >= 70) {
    return {
      label: strategyLabel(verdict.strategyPrediction),
      className: "border-rose-200 bg-rose-100 text-rose-700",
    };
  }

  if (verdict.strategyPrediction === "self_serve_push") {
    return {
      label: strategyLabel(verdict.strategyPrediction),
      className: "border-emerald-200 bg-emerald-100 text-emerald-700",
    };
  }

  return {
    label: strategyLabel(verdict.strategyPrediction),
    className: "border-amber-200 bg-amber-100 text-amber-700",
  };
}

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const companyId = params.id;
  const resolution = await resolveActiveWorkspace();
  if (resolution.status === "redirect") {
    redirect(
      `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(`/companies/${companyId}`)}`,
    );
  }

  const repo = resolution.insforge.scoped(resolution.workspace.id);
  const { company, sources, scans, latestComplete } = await withTimeout(
    loadCompanyDetail(repo, companyId),
    LOAD_TIMEOUT_MS,
    "The company detail did not load within 10 seconds.",
  );

  if (!company) {
    return <CompanyNotFound />;
  }

  const verdict = latestComplete?.verdict ?? null;
  const verdictTone = verdictBadge(verdict);
  const confidence = verdict?.confidence ?? 0;
  const riskScore = verdict?.riskScore ?? 0;
  const signals = latestComplete?.claims ?? [];

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex items-center gap-2 text-body-sm text-on-surface-variant">
        <Link href="/companies" className="hover:text-on-surface">
          Companies
        </Link>
        <span>›</span>
        <span className="text-on-surface">{company.name}</span>
      </nav>

      <section className="glass-card overflow-hidden bg-[linear-gradient(135deg,rgba(91,61,245,0.08),rgba(234,237,255,0.6)_45%,rgba(255,255,255,0.95))] px-8 py-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <Badge className={cn("border", verdictTone.className)}>
              {verdictTone.label}
            </Badge>
            <div>
              <h1 className="font-page-title text-page-title text-on-surface">
                {company.name}
              </h1>
              <p className="mt-1 text-body-md text-on-surface-variant">
                {company.domain}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-body-sm text-on-surface-variant">
              <span className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-white/80 px-3 py-1">
                <span className="material-symbols-outlined text-[16px]">language</span>
                {sources.length} watched source{sources.length === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-white/80 px-3 py-1">
                <span className="material-symbols-outlined text-[16px]">radar</span>
                {scans.length} scan{scans.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <RunScanButton
            companyId={company.id}
            label="Run scan"
            icon="bolt"
            buttonClassName="h-11 rounded-lg bg-primary px-5 text-on-primary hover:bg-primary-container"
          />
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-outline-variant/80 bg-white/85 p-5">
            <div className="mb-2 flex items-center justify-between text-body-sm text-on-surface-variant">
              <span>Confidence</span>
              <span className="font-mono-data text-mono-data text-on-surface">
                {confidence}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-variant">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(confidence, verdict ? 12 : 4)}%` }}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-outline-variant/80 bg-white/85 p-5">
            <div className="mb-2 flex items-center justify-between text-body-sm text-on-surface-variant">
              <span>Risk score</span>
              <span className="font-mono-data text-mono-data text-on-surface">
                {riskScore}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-variant">
              <div
                className={cn(
                  "h-full rounded-full",
                  riskScore >= 70
                    ? "bg-rose-500"
                    : riskScore >= 40
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
                style={{ width: `${Math.max(riskScore, verdict ? 12 : 4)}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {[
          "Overview",
          "Sources",
          "Scans",
          "Claims",
          "Evidence",
          "Settings",
        ].map((tab, index) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "rounded-full px-4 py-2 text-body-sm transition",
              index === 0
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
        <section className="glass-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                Current verdict
              </p>
              <h2 className="mt-2 font-section-title text-[24px] font-semibold text-on-surface">
                {verdict ? strategyLabel(verdict.strategyPrediction) : "No completed verdict yet"}
              </h2>
            </div>
            {latestComplete ? (
              <span className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-body-sm text-on-surface-variant">
                Updated {formatTimestamp(latestComplete.scan.createdAt)}
              </span>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low p-4">
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                Supporting evidence
              </p>
              <ul className="mt-3 space-y-3 text-body-md text-on-surface">
                {(verdict?.keyEvidence ?? []).slice(0, 4).map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="material-symbols-outlined mt-0.5 text-[18px] text-primary">
                      check_circle
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
                {verdict?.keyEvidence.length ? null : (
                  <li className="text-body-md text-on-surface-variant">
                    Run a completed scan to populate supporting evidence.
                  </li>
                )}
              </ul>
            </div>
            <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low p-4">
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                Counterpoints
              </p>
              <ul className="mt-3 space-y-3 text-body-md text-on-surface">
                {(verdict?.counterEvidence ?? []).slice(0, 4).map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="material-symbols-outlined mt-0.5 text-[18px] text-amber-600">
                      warning
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
                {verdict?.counterEvidence.length ? null : (
                  <li className="text-body-md text-on-surface-variant">
                    No counter-evidence was recorded for the latest complete scan.
                  </li>
                )}
              </ul>
            </div>
          </div>

          {verdict?.recommendedActions?.length ? (
            <div className="mt-6 rounded-2xl border border-outline-variant/70 bg-white/80 p-4">
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                Recommended next steps
              </p>
              <ul className="mt-3 grid gap-3 text-body-md text-on-surface md:grid-cols-2">
                {verdict.recommendedActions.map((action) => (
                  <li key={action} className="flex gap-3 rounded-xl bg-surface-container-low px-3 py-3">
                    <span className="material-symbols-outlined mt-0.5 text-[18px] text-primary">
                      task_alt
                    </span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="glass-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                Intelligence timeline
              </p>
              <h2 className="mt-2 font-section-title text-section-title text-on-surface">
                Recent scan activity
              </h2>
            </div>
          </div>

          {scans.length === 0 ? (
            <p className="mt-6 text-body-md text-on-surface-variant">
              No scans yet. Trigger a scan to start building an evidence timeline.
            </p>
          ) : (
            <ol className="mt-6 space-y-4">
              {scans.slice(0, 6).map((scan) => (
                <li key={scan.id} className="flex gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-primary" />
                  <div className="min-w-0 flex-1 rounded-2xl border border-outline-variant/70 bg-surface-container-low p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge className={cn("border", statusBadge(scan.status))}>
                        {SCAN_STATUS_LABELS[scan.status]}
                      </Badge>
                      <span className="text-body-sm text-on-surface-variant">
                        {formatTimestamp(scan.createdAt)}
                      </span>
                    </div>
                    <p className="mt-3 text-body-md text-on-surface">
                      Scan <span className="font-mono-data">{scan.id.slice(0, 8)}</span>
                    </p>
                    {scan.failureReason ? (
                      <p className="mt-2 text-body-sm text-error">{scan.failureReason}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      <section className="glass-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
              Strategy signals
            </p>
            <h2 className="mt-2 font-section-title text-section-title text-on-surface">
              Extracted changes from the latest completed scan
            </h2>
          </div>
          {latestComplete ? (
            <span className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-body-sm text-on-surface-variant">
              {signals.length} claims captured
            </span>
          ) : null}
        </div>

        {signals.length === 0 ? (
          <p className="mt-6 text-body-md text-on-surface-variant">
            No claim signals yet. Once a scan completes, SignalVault will surface classified evidence here.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {signals.slice(0, 6).map((claim) => (
              <article
                key={claim.id}
                className="rounded-2xl border border-outline-variant/70 bg-surface-container-low p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
                  <span className="rounded-full bg-white px-3 py-1 font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                    {claim.claimType}
                  </span>
                  {claim.claimStatus ? (
                    <span className="rounded-full bg-white px-3 py-1 text-body-sm text-on-surface-variant">
                      {claim.claimStatus}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-white px-3 py-1 font-mono-data text-mono-data text-on-surface">
                    {claim.confidence}% confidence
                  </span>
                </div>
                <h3 className="mt-4 font-section-title text-body-md font-semibold text-on-surface">
                  {claim.statementText}
                </h3>
                {claim.evidenceText ? (
                  <p className="mt-3 text-body-sm text-on-surface-variant">
                    {claim.evidenceText}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="glass-card p-6">
          <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
            Watched sources
          </p>
          <div className="mt-4 space-y-3">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/70 bg-surface-container-low p-4"
              >
                <div>
                  <p className="text-body-md font-medium text-on-surface">{source.url}</p>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    {source.sourceType}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-body-sm text-on-surface-variant">
                  Watching
                </span>
              </div>
            ))}
            {sources.length === 0 ? (
              <p className="text-body-md text-on-surface-variant">
                No watched sources have been configured for this company.
              </p>
            ) : null}
          </div>
        </section>

        <section className="glass-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                Scan history
              </p>
              <h2 className="mt-2 font-section-title text-section-title text-on-surface">
                Latest runs
              </h2>
            </div>
            <Link
              href="/companies"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-lg")}
            >
              All companies
            </Link>
          </div>
          {scans.length === 0 ? (
            <p className="mt-6 text-body-md text-on-surface-variant">
              No scans yet for this company. Run a scan to capture evidence.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {scans.map((scan) => (
                <li key={scan.id}>
                  <Link
                    href={`/scans/${scan.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/70 bg-surface-container-low p-4 transition hover:bg-surface-container"
                  >
                    <div className="flex items-center gap-3">
                      <Badge className={cn("border", statusBadge(scan.status))}>
                        {SCAN_STATUS_LABELS[scan.status]}
                      </Badge>
                      <span className="text-body-md text-on-surface">
                        {scan.id.slice(0, 8)}
                      </span>
                    </div>
                    <span className="text-body-sm text-on-surface-variant">
                      {formatTimestamp(scan.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function CompanyNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 rounded-[28px] border border-outline-variant bg-surface-container-lowest px-8 py-14 text-center shadow-[0_24px_60px_-34px_rgba(35,28,95,0.28)]">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-primary">
        <span className="material-symbols-outlined text-[28px]">domain_disabled</span>
      </div>
      <div className="space-y-2">
        <h1 className="font-section-title text-[24px] font-semibold text-on-surface">
          Company not found
        </h1>
        <p className="text-body-md text-on-surface-variant">
          We couldn&apos;t find this company in your workspace. It may have been removed, or the link may be incorrect.
        </p>
      </div>
      <Link
        href="/companies"
        className={cn(buttonVariants({ variant: "outline" }), "rounded-lg px-5")}
      >
        Back to companies
      </Link>
    </div>
  );
}
