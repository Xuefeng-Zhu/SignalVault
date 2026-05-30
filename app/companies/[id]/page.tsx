import Link from "next/link";
import { redirect } from "next/navigation";

import { AiChatBubble } from "@/components/ai-chat-bubble";
import { RunScanButton } from "@/components/run-scan-button";
import { strategyLabel } from "@/components/strategy-verdict-card";
import { buttonVariants } from "@/components/ui/button";
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
  uploading: "Uploading",
  diffing: "Diffing",
  analyzing: "Analyzing",
  completed: "Complete",
  failed: "Failed",
};

const TABS = ["Overview", "Sources", "Scans", "Claims", "Evidence", "Settings"] as const;

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

function parseTimestamp(iso: string): number {
  const timestamp = new Date(iso).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
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

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function statusBadge(status: ScanStatus): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function verdictBadge(verdict: VerdictRow | null): { label: string; className: string } {
  if (!verdict) {
    return {
      label: "Awaiting verdict",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (
    verdict.strategyPrediction === "moving_upmarket" ||
    verdict.strategyPrediction === "enterprise_readiness"
  ) {
    return {
      label: strategyLabel(verdict.strategyPrediction),
      className: "border-violet-200 bg-violet-50 text-violet-700",
    };
  }

  if (verdict.riskScore >= 70) {
    return {
      label: strategyLabel(verdict.strategyPrediction),
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  if (verdict.strategyPrediction === "self_serve_push") {
    return {
      label: strategyLabel(verdict.strategyPrediction),
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: strategyLabel(verdict.strategyPrediction),
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

function riskLevelLabel(score: number): string {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function sourceTypeIcon(sourceType: WatchedSource["sourceType"]): string {
  if (sourceType === "pricing") return "sell";
  if (sourceType === "docs") return "description";
  if (sourceType === "trust") return "verified_user";
  if (sourceType === "careers") return "work";
  if (sourceType === "blog") return "article";
  return "language";
}

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const companyId = params.id;
  const resolution = await resolveActiveWorkspace();

  if (resolution.status === "redirect") {
    redirect(`${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(`/companies/${companyId}`)}`);
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
  const signals = latestComplete?.claims ?? [];
  const orderedScans = [...scans].sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt));
  const timelineScans = orderedScans.slice(0, 5);

  const confidence = verdict?.confidence ?? 0;
  const riskScore = verdict?.riskScore ?? 0;
  const summary = verdict?.keyEvidence[0] ?? signals[0]?.evidenceText ?? "Run a completed scan to generate a verdict summary.";
  const removedCount = signals.filter((signal) => signal.claimStatus === "removed").length;
  const underReviewCount = signals.filter((signal) => signal.claimStatus === "needs_review").length;
  const unchangedCount = 0;
  const highRiskCount = signals.filter((signal) => {
    const level = signal.riskLevel?.toLowerCase() ?? "";
    return level.includes("high") || level.includes("critical");
  }).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-[30px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.3)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-on-surface-variant">
              <Link href="/companies" className="transition hover:text-on-surface">
                Companies
              </Link>{" "}
              / {company.name}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="font-page-title text-[42px] font-semibold tracking-[-0.04em] text-on-surface">
                {company.name}
              </h1>
              <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
                Enterprise
              </span>
            </div>
            <p className="mt-3 text-sm text-on-surface-variant">{company.domain}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-sm font-medium text-on-surface transition hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              Edit
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-sm font-medium text-on-surface transition hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export
            </button>
            <RunScanButton
              companyId={company.id}
              label="Run scan"
              icon="bolt"
              buttonClassName="h-10 rounded-full bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-container"
            />
          </div>
        </div>

        <div className="mt-6 grid gap-px overflow-hidden rounded-[24px] border border-outline-variant bg-outline-variant md:grid-cols-3">
          <article className="bg-surface-container-lowest p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">Verdict</p>
            <div className="mt-3 flex items-center gap-3">
              <span className={cn("inline-flex rounded-full border px-3 py-1 text-sm font-medium", verdictTone.className)}>
                {verdictTone.label}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-on-surface-variant">{summary}</p>
          </article>

          <article className="bg-surface-container-lowest p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">Confidence</p>
            <p className="mt-3 font-page-title text-[34px] font-semibold leading-none tracking-[-0.04em] text-on-surface">
              {confidence}%
            </p>
            <div className="mt-4 h-2 rounded-full bg-surface-container-low">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(confidence, verdict ? 12 : 4)}%` }} />
            </div>
          </article>

          <article className="bg-surface-container-lowest p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">Risk Level</p>
            <div className="mt-3 flex items-center gap-3">
              <p className="font-page-title text-[34px] font-semibold leading-none tracking-[-0.04em] text-on-surface">
                {riskLevelLabel(riskScore)}
              </p>
              <span className={cn("inline-flex rounded-full border px-3 py-1 text-sm font-medium", statusBadge(riskScore >= 70 ? "failed" : riskScore >= 40 ? "analyzing" : "completed"))}>
                {riskScore}/100
              </span>
            </div>
            <p className="mt-3 text-sm text-on-surface-variant">
              Last completed verdict updated {latestComplete ? formatShortDate(latestComplete.scan.createdAt) : "after the next scan"}.
            </p>
          </article>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition",
              index === 0
                ? "bg-primary text-white"
                : "border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
        <section className="rounded-[28px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">Current Verdict</p>
              <h2 className="mt-3 font-page-title text-[30px] font-semibold tracking-[-0.04em] text-on-surface">
                {verdict ? strategyLabel(verdict.strategyPrediction) : "Awaiting first complete verdict"}
              </h2>
            </div>
            {latestComplete ? (
              <span className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-sm text-on-surface-variant">
                Updated {formatShortDate(latestComplete.scan.createdAt)}
              </span>
            ) : null}
          </div>

          <p className="mt-4 max-w-3xl text-sm leading-7 text-on-surface-variant">{summary}</p>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-outline-variant bg-surface-container-low p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">Key Evidence</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-on-surface">
                {(verdict?.keyEvidence.length ? verdict.keyEvidence : signals.map((signal) => signal.statementText)).slice(0, 4).map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="material-symbols-outlined mt-0.5 text-[18px] text-primary">check_circle</span>
                    <span>{item}</span>
                  </li>
                ))}
                {!verdict?.keyEvidence.length && signals.length === 0 ? (
                  <li className="text-on-surface-variant">No evidence has been published for this company yet.</li>
                ) : null}
              </ul>
            </div>

            <div className="rounded-[24px] border border-outline-variant bg-surface-container-low p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">Watched Sources</p>
              <div className="mt-4 space-y-3">
                {sources.slice(0, 4).map((source) => (
                  <div key={source.id} className="flex items-start gap-3 rounded-2xl bg-surface-container-lowest px-4 py-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <span className="material-symbols-outlined text-[18px]">{sourceTypeIcon(source.sourceType)}</span>
                    </span>
                    <div>
                      <p className="text-sm font-medium text-on-surface">{source.sourceType}</p>
                      <p className="mt-1 break-all text-sm text-on-surface-variant">{source.url}</p>
                    </div>
                  </div>
                ))}
                {sources.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No watched sources have been configured yet.</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-outline-variant bg-surface-container-low p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">Recommended Actions</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(verdict?.recommendedActions ?? []).slice(0, 4).map((action) => (
                <div key={action} className="flex gap-3 rounded-2xl bg-surface-container-lowest px-4 py-3 text-sm leading-6 text-on-surface">
                  <span className="material-symbols-outlined mt-0.5 text-[18px] text-primary">task_alt</span>
                  <span>{action}</span>
                </div>
              ))}
              {!verdict?.recommendedActions.length ? (
                <div className="rounded-2xl bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant md:col-span-2">
                  Recommended actions will appear after a completed verdict is stored.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">Intelligence Timeline</p>
          <h2 className="mt-3 font-page-title text-[30px] font-semibold tracking-[-0.04em] text-on-surface">
            Scan activity
          </h2>
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">
            Follow each scan, verdict, and evidence change in the order your team experienced it.
          </p>

          <div className="mt-6 space-y-4">
            {timelineScans.map((scan, index) => (
              <div key={scan.id} className="relative rounded-[24px] border border-outline-variant bg-surface-container-low p-5">
                {index < timelineScans.length - 1 ? (
                  <span className="absolute left-[25px] top-[68px] h-10 w-px bg-outline-variant" aria-hidden="true" />
                ) : null}
                <div className="flex items-start gap-4">
                  <span className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-on-surface">{SCAN_STATUS_LABELS[scan.status]}</p>
                        <p className="mt-1 text-sm text-on-surface-variant">{formatTimestamp(scan.createdAt)}</p>
                      </div>
                      <span className={cn("inline-flex rounded-full border px-3 py-1 text-sm font-medium", statusBadge(scan.status))}>
                        {SCAN_STATUS_LABELS[scan.status]}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                      {scan.status === "completed"
                        ? "Evidence archived and verdict refreshed for the latest public changes."
                        : scan.failureReason || "This scan is still moving through the SignalVault workflow."}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {timelineScans.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-outline-variant bg-surface-container-low px-5 py-10 text-center text-sm text-on-surface-variant">
                No scans yet. Start a scan to create the first timeline entry.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="grid gap-px overflow-hidden rounded-[24px] border border-outline-variant bg-outline-variant md:grid-cols-5">
        {[
          { label: "Total Claims", value: String(signals.length) },
          { label: "Removed", value: String(removedCount) },
          { label: "Unchanged", value: String(unchangedCount) },
          { label: "Under Review", value: String(underReviewCount) },
          { label: "High Risk", value: String(highRiskCount) },
        ].map((stat) => (
          <article key={stat.label} className="bg-surface-container-lowest p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">{stat.label}</p>
            <p className="mt-3 font-page-title text-[28px] font-semibold tracking-[-0.03em] text-on-surface">
              {stat.value}
            </p>
          </article>
        ))}
      </section>

      <AiChatBubble companyName={company.name} companyDomain={company.domain} />
    </div>
  );
}

function CompanyNotFound() {
  return (
    <div className="rounded-[28px] border border-outline-variant bg-surface-container-lowest px-8 py-12 text-center shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-low text-primary">
        <span className="material-symbols-outlined text-[28px]">search_off</span>
      </div>
      <h1 className="mt-5 font-page-title text-[30px] font-semibold tracking-[-0.03em] text-on-surface">
        Company not found
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-on-surface-variant">
        The company may have been removed from this workspace, or the link is no longer valid.
      </p>
      <Link href="/companies" className={cn(buttonVariants(), "mt-6 inline-flex h-10 rounded-full px-5 text-sm font-medium")}>
        Back to dashboard
      </Link>
    </div>
  );
}
