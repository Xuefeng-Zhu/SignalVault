import Link from "next/link";
import { redirect } from "next/navigation";

import { RetryButton } from "@/app/companies/retry-button";
import { RunScanButton } from "@/components/run-scan-button";
import { strategyLabel } from "@/components/strategy-verdict-card";
import { buttonVariants } from "@/components/ui/button";
import { listCompanies, type CompanyListItem } from "@/lib/api/companies";
import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

const COMPANIES_PATH = "/companies";
const NEW_COMPANY_PATH = "/companies/new";
const PAGE_SIZE = 8;

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "SV"
  );
}

function parseTimestamp(iso: string | null | undefined): number {
  if (!iso) return 0;
  const timestamp = new Date(iso).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "Not scanned yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Awaiting first scan";
  const timestamp = parseTimestamp(iso);
  if (!timestamp) return "Awaiting first scan";

  const diffHours = Math.round((Date.now() - timestamp) / (1000 * 60 * 60));
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatTimestamp(iso);
}

function formatDateRange(): string {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });

  return `${formatter.format(start)} — ${formatter.format(end)}`;
}

function verdictStyles(company: CompanyListItem): { label: string; className: string } {
  const prediction = company.verdict?.strategyPrediction;
  const riskScore = company.verdict?.riskScore ?? 0;

  if (!prediction) {
    return {
      label: company.latestScan ? "Pending review" : "Awaiting first scan",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (prediction === "moving_upmarket" || prediction === "enterprise_readiness") {
    return {
      label: strategyLabel(prediction),
      className: "border-violet-200 bg-violet-50 text-violet-700",
    };
  }

  if (riskScore >= 70) {
    return {
      label: strategyLabel(prediction),
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  if (prediction === "self_serve_push") {
    return {
      label: strategyLabel(prediction),
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: strategyLabel(prediction),
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

function riskTone(riskScore: number): string {
  if (riskScore >= 70) return "border-rose-200 bg-rose-50 text-rose-700";
  if (riskScore >= 40) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function sourceIconSet(count: number) {
  const labels = [
    { icon: "language", label: "Homepage" },
    { icon: "sell", label: "Pricing" },
    { icon: "description", label: "Docs" },
    { icon: "verified_user", label: "Trust" },
  ];

  return labels.slice(0, Math.min(count, labels.length));
}

function FilterChip({
  label,
  count,
  active = false,
}: {
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium",
        active
          ? "border-primary/20 bg-primary text-white shadow-[0_18px_30px_-24px_rgba(66,18,222,0.8)]"
          : "border-outline-variant bg-surface-container-lowest text-on-surface",
      )}
    >
      <span>{label}</span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
            active ? "bg-white/20 text-white" : "bg-surface-container-low text-on-surface-variant",
          )}
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <article className="rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5 shadow-[0_24px_44px_-34px_rgba(21,27,45,0.28)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-on-surface-variant">{label}</p>
          <p className="mt-3 font-page-title text-[34px] font-semibold leading-none tracking-[-0.04em] text-on-surface">
            {value}
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
      </div>
      <p className="mt-4 text-sm text-on-surface-variant">{detail}</p>
    </article>
  );
}

export default async function CompaniesDashboardPage() {
  const resolution = await resolveActiveWorkspace();

  if (resolution.status === "redirect") {
    redirect(`${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(COMPANIES_PATH)}`);
  }

  let companies: CompanyListItem[] = [];
  let loadFailed = false;

  try {
    const repo = resolution.insforge.scoped(resolution.workspace.id);
    const result = await listCompanies(repo);
    companies = result.companies;
  } catch {
    loadFailed = true;
  }

  const orderedCompanies = [...companies].sort(
    (a, b) => parseTimestamp(b.latestScan?.createdAt) - parseTimestamp(a.latestScan?.createdAt),
  );
  const latestSignals = orderedCompanies.slice(0, PAGE_SIZE);

  const monitoredCompanies = companies.length;
  const highRiskCount = companies.filter((company) => (company.verdict?.riskScore ?? 0) >= 70).length;
  const mediumRiskCount = companies.filter((company) => {
    const score = company.verdict?.riskScore ?? 0;
    return score >= 40 && score < 70;
  }).length;
  const verifiedCount = companies.filter((company) => company.verdict !== null).length;
  const pendingScanCount = companies.filter(
    (company) => company.latestScan == null || company.latestScan.status !== "completed",
  ).length;
  const scansThisWeek = companies.filter(
    (company) => parseTimestamp(company.latestScan?.createdAt) >= Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).length;
  const scansLast24h = companies.filter(
    (company) => parseTimestamp(company.latestScan?.createdAt) >= Date.now() - 24 * 60 * 60 * 1000,
  ).length;
  const activeMonitoring = companies.filter((company) => company.sourceCount > 0).length;
  const claimsChanged = companies.reduce((sum, company) => {
    if (company.verdict == null) return sum;
    if ((company.verdict.riskScore ?? 0) >= 70) return sum + 3;
    if ((company.verdict.riskScore ?? 0) >= 40) return sum + 2;
    return sum + 1;
  }, 0);
  const pageCount = Math.max(1, Math.ceil(companies.length / PAGE_SIZE));

  const recentScans = orderedCompanies.filter((company) => company.latestScan).slice(0, 5);
  const integrationHealth = [
    {
      name: "Apify capture",
      detail: `${activeMonitoring || 0} monitored sources online`,
      status: loadFailed ? "Delayed" : "Healthy",
      tone: loadFailed ? "bg-amber-500" : "bg-emerald-500",
    },
    {
      name: "Box archive",
      detail: loadFailed ? "Waiting on dashboard refresh" : "Snapshots syncing normally",
      status: loadFailed ? "Review" : "Healthy",
      tone: loadFailed ? "bg-amber-500" : "bg-emerald-500",
    },
    {
      name: "Mastra reasoning",
      detail: `${verifiedCount} verdict${verifiedCount === 1 ? "" : "s"} available`,
      status: loadFailed ? "Review" : "Healthy",
      tone: loadFailed ? "bg-amber-500" : "bg-emerald-500",
    },
    {
      name: "InsForge data",
      detail: loadFailed ? "Connection needs retry" : "Workspace store operational",
      status: loadFailed ? "Check" : "Healthy",
      tone: loadFailed ? "bg-amber-500" : "bg-emerald-500",
    },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-[28px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.3)] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-on-surface-variant">
            Market intelligence overview
          </p>
          <h1 className="mt-3 font-page-title text-[40px] font-semibold tracking-[-0.04em] text-on-surface">
            Dashboard
          </h1>
          <p className="mt-2 text-sm text-on-surface-variant">{formatDateRange()} · Rolling 30-day view</p>
        </div>

        {companies[0] ? (
          <RunScanButton
            companyId={companies[0].id}
            label="Run demo scan"
            icon="bolt"
            buttonClassName="h-10 rounded-full bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-container"
          />
        ) : (
          <Link href={NEW_COMPANY_PATH} className={cn(buttonVariants(), "h-10 rounded-full px-4 text-sm font-medium")}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add company
          </Link>
        )}
      </header>

      <div className="grid gap-4 xl:grid-cols-4">
        <StatCard
          label="Monitored Companies"
          value={String(monitoredCompanies)}
          detail={`${activeMonitoring} companies actively watched right now`}
          icon="domain"
        />
        <StatCard
          label="Scans This Week"
          value={String(scansThisWeek)}
          detail="Latest company scans completed in the last 7 days"
          icon="radar"
        />
        <StatCard
          label="High-Risk Changes"
          value={String(highRiskCount)}
          detail="Companies flagged at 70+ risk in the latest verdict"
          icon="warning"
        />
        <StatCard
          label="Claims Changed"
          value={String(claimsChanged)}
          detail="Weighted signal volume across current verdicts"
          icon="timeline"
        />
      </div>

      {loadFailed ? (
        <DashboardError />
      ) : companies.length === 0 ? (
        <DashboardEmptyState />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,0.95fr)]">
          <section id="latest-signals" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <FilterChip label="All Companies" count={companies.length} active />
              <FilterChip label="High Risk" count={highRiskCount} />
              <FilterChip label="Verified" count={verifiedCount} />
              <FilterChip label="Pending Scan" count={pendingScanCount} />
            </div>

            <div className="overflow-hidden rounded-[28px] border border-outline-variant bg-surface-container-lowest shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
              <div className="flex items-center justify-between gap-3 border-b border-outline-variant px-6 py-5">
                <div>
                  <h2 className="font-page-title text-[24px] font-semibold tracking-[-0.03em] text-on-surface">
                    Latest Signals
                  </h2>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Monitor verdict shifts, source coverage, and recent scan activity.
                  </p>
                </div>
                <Link
                  href={NEW_COMPANY_PATH}
                  className="hidden rounded-full border border-outline-variant bg-surface-container-low px-4 py-2 text-sm font-medium text-on-surface transition hover:bg-surface-container md:inline-flex"
                >
                  Add company
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-surface-container-low text-left text-[11px] font-medium uppercase tracking-[0.22em] text-on-surface-variant">
                      <th className="px-6 py-4">Company</th>
                      <th className="px-6 py-4">Domain</th>
                      <th className="px-6 py-4">Watched Sources</th>
                      <th className="px-6 py-4">Latest Verdict</th>
                      <th className="px-6 py-4">Risk Score</th>
                      <th className="px-6 py-4">Last Scan</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestSignals.map((company, index) => {
                      const verdict = verdictStyles(company);
                      const riskScore = company.verdict?.riskScore ?? 0;

                      return (
                        <tr
                          key={company.id}
                          className={cn(
                            "group border-t border-outline-variant/70 transition hover:bg-surface-container-low/60",
                            index % 2 === 0 ? "bg-surface-container-lowest" : "bg-surface-container-lowest/70",
                          )}
                        >
                          <td className="px-6 py-4">
                            <Link href={`/companies/${company.id}`} className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                                {getInitials(company.name)}
                              </div>
                              <div>
                                <p className="font-page-title text-sm font-medium text-on-surface">
                                  {company.name}
                                </p>
                                <p className="mt-1 text-sm text-on-surface-variant">Workspace monitored</p>
                              </div>
                            </Link>
                          </td>
                          <td className="px-6 py-4 text-sm text-on-surface-variant">{company.domain}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {sourceIconSet(company.sourceCount).map((source) => (
                                <span
                                  key={`${company.id}-${source.label}`}
                                  title={source.label}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant bg-surface-container-low text-on-surface-variant"
                                >
                                  <span className="material-symbols-outlined text-[16px]">{source.icon}</span>
                                </span>
                              ))}
                              {company.sourceCount > 4 ? (
                                <span className="inline-flex h-8 min-w-[32px] items-center justify-center rounded-full border border-outline-variant bg-surface-container-low px-2 text-xs font-medium text-on-surface-variant">
                                  +{company.sourceCount - 4}
                                </span>
                              ) : null}
                              {company.sourceCount === 0 ? (
                                <span className="text-sm text-on-surface-variant">No sources</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("inline-flex rounded-full border px-3 py-1 text-sm font-medium", verdict.className)}>
                              {verdict.label}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("inline-flex rounded-full border px-3 py-1 text-sm font-medium", riskTone(riskScore))}>
                              {riskScore}/100
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-on-surface">{formatTimestamp(company.latestScan?.createdAt)}</p>
                            <p className="mt-1 text-sm text-on-surface-variant">
                              {formatRelativeTime(company.latestScan?.createdAt)}
                            </p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              aria-label={`More actions for ${company.name}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant opacity-0 transition hover:bg-surface-container-low hover:text-on-surface group-hover:opacity-100"
                            >
                              <span className="material-symbols-outlined text-[18px]">more_vert</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-outline-variant px-6 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm text-on-surface-variant">
                    Showing <span className="font-medium text-on-surface">1-{latestSignals.length}</span> of{" "}
                    <span className="font-medium text-on-surface">{companies.length}</span> companies
                  </p>

                  <div className="flex items-center gap-2">
                    {Array.from({ length: Math.min(pageCount, 4) }, (_value, index) => (
                      <button
                        key={index}
                        type="button"
                        className={cn(
                          "inline-flex h-9 min-w-[36px] items-center justify-center rounded-full px-3 text-sm font-medium transition",
                          index === 0
                            ? "bg-primary text-white"
                            : "border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low",
                        )}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <article className="rounded-[22px] border border-outline-variant bg-surface-container-low p-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-on-surface-variant">
                      Risk Distribution
                    </p>
                    <p className="mt-3 font-page-title text-[24px] font-semibold tracking-[-0.03em] text-on-surface">
                      {highRiskCount} high · {mediumRiskCount} medium
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                      <div className="flex h-full">
                        <div
                          className="bg-rose-500"
                          style={{ width: `${companies.length ? (highRiskCount / companies.length) * 100 : 0}%` }}
                        />
                        <div
                          className="bg-amber-400"
                          style={{ width: `${companies.length ? (mediumRiskCount / companies.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </article>

                  <article className="rounded-[22px] border border-outline-variant bg-surface-container-low p-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-on-surface-variant">
                      Total Scans (24h)
                    </p>
                    <p className="mt-3 font-page-title text-[24px] font-semibold tracking-[-0.03em] text-on-surface">
                      {scansLast24h}
                    </p>
                    <p className="mt-2 text-sm text-on-surface-variant">Most recent scan activity across monitored companies.</p>
                  </article>

                  <article className="rounded-[22px] border border-outline-variant bg-surface-container-low p-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-on-surface-variant">
                      Active Monitoring
                    </p>
                    <p className="mt-3 font-page-title text-[24px] font-semibold tracking-[-0.03em] text-on-surface">
                      {activeMonitoring}/{monitoredCompanies || 0}
                    </p>
                    <p className="mt-2 text-sm text-on-surface-variant">Companies with live source coverage feeding the dashboard.</p>
                  </article>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[28px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-page-title text-[22px] font-semibold tracking-[-0.03em] text-on-surface">
                    Integration Health
                  </h2>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Signals pipeline status across capture, storage, and reasoning.
                  </p>
                </div>
                <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                  Live
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {integrationHealth.map((integration) => (
                  <div
                    key={integration.name}
                    className="flex items-start justify-between gap-3 rounded-[20px] border border-outline-variant bg-surface-container-low p-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-on-surface">{integration.name}</p>
                      <p className="mt-1 text-sm text-on-surface-variant">{integration.detail}</p>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium text-on-surface">
                      <span className={cn("h-2.5 w-2.5 rounded-full", integration.tone)} />
                      {integration.status}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
              <div>
                <h2 className="font-page-title text-[22px] font-semibold tracking-[-0.03em] text-on-surface">
                  Recent Scans
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  The latest scan activity and review posture across companies.
                </p>
              </div>

              <div className="mt-5 space-y-3">
                {recentScans.map((company) => {
                  const latestScan = company.latestScan;
                  const tone = latestScan?.status === "completed"
                    ? "bg-emerald-500"
                    : latestScan?.status === "failed"
                      ? "bg-rose-500"
                      : "bg-amber-500";

                  return (
                    <Link
                      key={company.id}
                      href={`/companies/${company.id}`}
                      className="block rounded-[20px] border border-outline-variant bg-surface-container-low p-4 transition hover:bg-surface-container"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-on-surface">{company.name}</p>
                          <p className="mt-1 text-sm text-on-surface-variant">
                            {formatTimestamp(latestScan?.createdAt)}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium text-on-surface">
                          <span className={cn("h-2.5 w-2.5 rounded-full", tone)} />
                          {latestScan?.status ?? "pending"}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-on-surface-variant">
                        {company.verdict ? strategyLabel(company.verdict.strategyPrediction) : "Awaiting completed verdict"}
                      </p>
                    </Link>
                  );
                })}

                {recentScans.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-outline-variant bg-surface-container-low p-4 text-sm text-on-surface-variant">
                    Run your first company scan to populate this activity feed.
                  </div>
                ) : null}
              </div>
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

function DashboardEmptyState() {
  return (
    <div className="rounded-[28px] border border-outline-variant bg-surface-container-lowest px-8 py-12 text-center shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-[28px]">business</span>
      </div>
      <h2 className="mt-5 font-page-title text-[28px] font-semibold tracking-[-0.03em] text-on-surface">
        No companies yet
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-on-surface-variant">
        Start monitoring your first company to build a dashboard of verdict shifts, watched sources, and auditable evidence.
      </p>
      <Link href={NEW_COMPANY_PATH} className={cn(buttonVariants(), "mt-6 h-10 rounded-full px-5 text-sm font-medium")}>
        Add your first company
      </Link>
    </div>
  );
}

function DashboardError() {
  return (
    <div className="rounded-[28px] border border-outline-variant bg-surface-container-lowest px-8 py-12 text-center shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-error-container text-error">
        <span className="material-symbols-outlined text-[28px]">error</span>
      </div>
      <h2 className="mt-5 font-page-title text-[28px] font-semibold tracking-[-0.03em] text-on-surface">
        We couldn&apos;t load your dashboard
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-on-surface-variant">
        Refresh the workspace and try again. No partial data was shown.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <RetryButton />
        <Link
          href={NEW_COMPANY_PATH}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-full px-5 text-sm font-medium")}
        >
          Add company
        </Link>
      </div>
    </div>
  );
}
