"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface CompanyStatus {
  companyId: string;
  companyName: string;
  monitoringEnabled: boolean;
  lastCheckedAt: string | null;
  healthStatus: "healthy" | "stale" | "changed";
}

interface MonitoringStatusProps {
  companies: Array<{ id: string; name: string }>;
  className?: string;
}

function healthIndicator(status: CompanyStatus["healthStatus"]): {
  color: string;
  label: string;
  icon: string;
} {
  switch (status) {
    case "healthy":
      return { color: "bg-emerald-500", label: "No changes", icon: "check_circle" };
    case "stale":
      return { color: "bg-amber-500", label: "Check overdue", icon: "schedule" };
    case "changed":
      return { color: "bg-rose-500", label: "Changes detected", icon: "change_circle" };
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function MonitoringStatus({ companies, className }: MonitoringStatusProps) {
  const [statuses, setStatuses] = useState<CompanyStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStatuses() {
      const results: CompanyStatus[] = [];

      for (const company of companies) {
        try {
          const res = await fetch(
            `/api/monitoring/config?companyId=${company.id}`,
          );
          if (res.ok) {
            const data = await res.json();
            if (data.monitoringEnabled) {
              // Determine health status based on last check time and interval
              let healthStatus: CompanyStatus["healthStatus"] = "healthy";
              if (!data.lastAutoScanAt) {
                healthStatus = "stale";
              } else {
                const lastCheck = new Date(data.lastAutoScanAt).getTime();
                const intervalMs = (data.checkIntervalHours ?? 6) * 60 * 60 * 1000;
                if (Date.now() - lastCheck > intervalMs * 1.5) {
                  healthStatus = "stale";
                }
              }

              results.push({
                companyId: company.id,
                companyName: company.name,
                monitoringEnabled: true,
                lastCheckedAt: data.lastAutoScanAt,
                healthStatus,
              });
            }
          }
        } catch {
          // Skip companies that fail to load
        }
      }

      setStatuses(results);
      setLoading(false);
    }

    if (companies.length > 0) {
      loadStatuses();
    } else {
      setLoading(false);
    }
  }, [companies]);

  if (loading) {
    return (
      <div
        className={cn(
          "rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5",
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">monitoring</span>
          </div>
          <h3 className="text-sm font-semibold text-on-surface">
            Monitoring Status
          </h3>
        </div>
        <div className="mt-4 flex items-center justify-center py-6">
          <span className="material-symbols-outlined animate-spin text-on-surface-variant">
            progress_activity
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">monitoring</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">
              Monitoring Status
            </h3>
            <p className="text-xs text-on-surface-variant">
              {statuses.length} company{statuses.length !== 1 ? "ies" : ""} monitored
            </p>
          </div>
        </div>
      </div>

      {statuses.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-outline-variant p-4 text-center">
          <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
            radar
          </span>
          <p className="mt-2 text-sm text-on-surface-variant">
            No companies have monitoring enabled yet.
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Enable monitoring on a company detail page to start tracking changes.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-outline-variant" role="list">
          {statuses.map((status) => {
            const indicator = healthIndicator(status.healthStatus);
            return (
              <li
                key={status.companyId}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      indicator.color,
                    )}
                    title={indicator.label}
                    aria-label={indicator.label}
                  />
                  <div>
                    <p className="text-sm font-medium text-on-surface">
                      {status.companyName}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {status.lastCheckedAt
                        ? `Checked ${formatRelativeTime(status.lastCheckedAt)}`
                        : "Not yet checked"}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                    status.healthStatus === "healthy" &&
                      "bg-emerald-50 text-emerald-700",
                    status.healthStatus === "stale" &&
                      "bg-amber-50 text-amber-700",
                    status.healthStatus === "changed" &&
                      "bg-rose-50 text-rose-700",
                  )}
                >
                  <span className="material-symbols-outlined text-[12px]">
                    {indicator.icon}
                  </span>
                  {indicator.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
