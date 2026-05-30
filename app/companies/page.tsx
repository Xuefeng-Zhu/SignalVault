import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { listCompanies, type CompanyListItem } from "@/lib/api/companies";
import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";
import { strategyLabel } from "@/components/strategy-verdict-card";
import { cn } from "@/lib/utils";

import { RetryButton } from "./retry-button";

const COMPANIES_PATH = "/companies";
const NEW_COMPANY_PATH = "/companies/new";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "SV";
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "Not scanned";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function verdictStyles(company: CompanyListItem): { label: string; className: string } {
  const prediction = company.verdict?.strategyPrediction;
  const riskScore = company.verdict?.riskScore ?? 0;

  if (!prediction) {
    return {
      label: company.latestScan ? "Pending review" : "Awaiting first scan",
      className: "border-amber-200 bg-amber-100 text-amber-700",
    };
  }

  if (prediction === "moving_upmarket" || prediction === "enterprise_readiness") {
    return {
      label: strategyLabel(prediction),
      className: "border-violet-200 bg-violet-100 text-violet-700",
    };
  }

  if (riskScore >= 70) {
    return {
      label: strategyLabel(prediction),
      className: "border-rose-200 bg-rose-100 text-rose-700",
    };
  }

  if (prediction === "self_serve_push") {
    return {
      label: strategyLabel(prediction),
      className: "border-emerald-200 bg-emerald-100 text-emerald-700",
    };
  }

  return {
    label: strategyLabel(prediction),
    className: "border-amber-200 bg-amber-100 text-amber-700",
  };
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
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-body-sm",
        active
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-outline-variant bg-surface-container-lowest text-on-surface-variant",
      )}
    >
      <span>{label}</span>
      {typeof count === "number" ? (
        <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono-data text-mono-data text-on-surface">
          {count}
        </span>
      ) : null}
    </div>
  );
}

export default async function CompaniesDashboardPage() {
  const resolution = await resolveActiveWorkspace();

  if (resolution.status === "redirect") {
    redirect(
      `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(COMPANIES_PATH)}`,
    );
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

  const highRiskCount = companies.filter(
    (company) => (company.verdict?.riskScore ?? 0) >= 70,
  ).length;
  const verifiedCount = companies.filter((company) => company.verdict !== null).length;
  const pendingScanCount = companies.filter(
    (company) => company.latestScan == null || company.latestScan.status !== "completed",
  ).length;

  return (
    <section className="flex flex-col gap-6">
      <header className="sr-only">
        <h1>Companies</h1>
        <p>Monitored companies in your workspace.</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <FilterChip label="All Companies" count={companies.length} active />
        <FilterChip label="High Risk" count={highRiskCount} />
        <FilterChip label="Verified" count={verifiedCount} />
        <FilterChip label="Pending Scan" count={pendingScanCount} />
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 py-2 text-body-sm text-on-surface-variant transition hover:bg-surface-container-low"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          More filters
        </button>
      </div>

      {loadFailed ? (
        <DashboardError />
      ) : companies.length > 0 ? (
        <div className="glass-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="px-6 py-4 text-left font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                    Company
                  </th>
                  <th className="px-6 py-4 text-left font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                    Domain
                  </th>
                  <th className="px-6 py-4 text-left font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                    Watched Sources
                  </th>
                  <th className="px-6 py-4 text-left font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                    Latest Verdict
                  </th>
                  <th className="px-6 py-4 text-left font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                    Risk Score
                  </th>
                  <th className="px-6 py-4 text-left font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                    Last Scan
                  </th>
                  <th className="px-6 py-4 text-left font-label-caps text-label-caps uppercase tracking-[0.08em] text-on-surface-variant">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => {
                  const verdict = verdictStyles(company);
                  const riskScore = company.verdict?.riskScore ?? 0;

                  return (
                    <tr key={company.id} className="border-t border-outline-variant/60 hover:bg-surface-container-low/60">
                      <td className="px-6 py-5">
                        <Link
                          href={`/companies/${company.id}`}
                          className="flex items-center gap-3"
                        >
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container text-body-md font-semibold text-primary">
                            {getInitials(company.name)}
                          </div>
                          <div>
                            <p className="font-section-title text-body-md font-semibold text-on-surface">
                              {company.name}
                            </p>
                            <p className="text-body-sm text-on-surface-variant">
                              Workspace monitored
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-5 text-body-md text-on-surface-variant">
                        {company.domain}
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-wrap items-center gap-2">
                          {sourceIconSet(company.sourceCount).map((source) => (
                            <span
                              key={`${company.id}-${source.label}`}
                              title={source.label}
                              className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-body-sm text-on-surface-variant"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {source.icon}
                              </span>
                              <span>{source.label}</span>
                            </span>
                          ))}
                          {company.sourceCount > 4 ? (
                            <span className="inline-flex items-center rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-body-sm text-on-surface-variant">
                              +{company.sourceCount - 4}
                            </span>
                          ) : null}
                          {company.sourceCount === 0 ? (
                            <span className="text-body-sm text-on-surface-variant">No sources</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <Badge className={cn("border", verdict.className)}>
                          {verdict.label}
                        </Badge>
                      </td>
                      <td className="px-6 py-5">
                        <div className="max-w-[160px] space-y-2">
                          <div className="flex items-center justify-between text-body-sm text-on-surface-variant">
                            <span>Risk</span>
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
                              style={{ width: `${Math.max(riskScore, company.verdict ? 12 : 6)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-body-md text-on-surface-variant">
                        {formatTimestamp(company.latestScan?.createdAt)}
                      </td>
                      <td className="px-6 py-5">
                        <Link
                          href={`/companies/${company.id}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-sm font-medium text-on-surface transition hover:bg-surface-container-low"
                        >
                          Open
                          <span className="material-symbols-outlined text-[18px]">
                            arrow_forward
                          </span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <DashboardEmptyState />
      )}
    </section>
  );
}

function DashboardEmptyState() {
  return (
    <div className="glass-card mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-8 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-primary">
        <span className="material-symbols-outlined text-[28px]">business</span>
      </div>
      <div className="space-y-2">
        <h2 className="font-section-title text-[24px] font-semibold text-on-surface">
          No companies yet
        </h2>
        <p className="max-w-lg text-body-md text-on-surface-variant">
          Start monitoring your first company to build an auditable timeline of pricing, product, and trust signals.
        </p>
      </div>
      <Link href={NEW_COMPANY_PATH} className={cn(buttonVariants(), "rounded-lg px-5")}> 
        Add your first company
      </Link>
    </div>
  );
}

function DashboardError() {
  return (
    <div className="glass-card mx-auto flex w-full max-w-2xl flex-col gap-4 px-8 py-12 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-error-container text-error">
        <span className="material-symbols-outlined text-[28px]">error</span>
      </div>
      <div className="space-y-2">
        <h2 className="font-section-title text-[24px] font-semibold text-on-surface">
          We couldn&apos;t load your companies
        </h2>
        <p className="text-body-md text-on-surface-variant">
          Refresh the dashboard and try again. No partial results were shown.
        </p>
      </div>
      <div className="flex items-center justify-center gap-3">
        <RetryButton />
        <Link
          href={NEW_COMPANY_PATH}
          className={cn(buttonVariants({ variant: "outline" }), "rounded-lg px-5")}
        >
          Add company
        </Link>
      </div>
    </div>
  );
}
