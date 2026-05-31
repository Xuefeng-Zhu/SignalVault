"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/utils";

interface MonitoringConfigProps {
  companyId: string;
  className?: string;
}

interface ConfigState {
  monitoringEnabled: boolean;
  checkIntervalHours: number;
  lastAutoScanAt: string | null;
}

const INTERVAL_OPTIONS = [
  { value: 1, label: "Every hour" },
  { value: 6, label: "Every 6 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Every 24 hours" },
] as const;

export function MonitoringConfig({ companyId, className }: MonitoringConfigProps) {
  const [config, setConfig] = useState<ConfigState>({
    monitoringEnabled: false,
    checkIntervalHours: 6,
    lastAutoScanAt: null,
  });
  const [isPending, startTransition] = useTransition();
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  // Load current config
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch(`/api/monitoring/config?companyId=${companyId}`);
        if (res.ok) {
          const data = await res.json();
          setConfig({
            monitoringEnabled: data.monitoringEnabled,
            checkIntervalHours: data.checkIntervalHours,
            lastAutoScanAt: data.lastAutoScanAt,
          });
        }
      } catch {
        // Fail silently on load
      }
    }
    loadConfig();
  }, [companyId]);

  const updateConfig = useCallback(
    (enabled: boolean, interval: number) => {
      startTransition(async () => {
        try {
          const res = await fetch("/api/monitoring/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              monitoringEnabled: enabled,
              checkIntervalHours: interval,
            }),
          });
          if (res.ok) {
            setConfig((prev) => ({
              ...prev,
              monitoringEnabled: enabled,
              checkIntervalHours: interval,
            }));
          }
        } catch {
          // Fail silently — UI stays at prior state
        }
      });
    },
    [companyId],
  );

  const runCheck = useCallback(async () => {
    setIsChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/monitoring/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.sourcesChanged > 0) {
          setCheckResult(
            `${data.sourcesChanged} source(s) changed — scan ${data.scanTriggered ? "triggered" : "already running"}`,
          );
        } else if (data.sourcesFailed > 0) {
          setCheckResult(
            `No changes detected (${data.sourcesFailed} source(s) failed to fetch)`,
          );
        } else {
          setCheckResult("No changes detected");
        }
      } else {
        setCheckResult("Check failed");
      }
    } catch {
      setCheckResult("Check failed — network error");
    } finally {
      setIsChecking(false);
    }
  }, [companyId]);

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
        <div>
          <h3 className="text-sm font-semibold text-on-surface">
            Continuous Monitoring
          </h3>
          <p className="text-xs text-on-surface-variant">
            Automatically detect content changes
          </p>
        </div>
      </div>

      {/* Toggle */}
      <div className="mt-5 flex items-center justify-between">
        <label
          htmlFor={`monitoring-toggle-${companyId}`}
          className="text-sm font-medium text-on-surface"
        >
          Enable monitoring
        </label>
        <button
          id={`monitoring-toggle-${companyId}`}
          type="button"
          role="switch"
          aria-checked={config.monitoringEnabled}
          disabled={isPending}
          onClick={() =>
            updateConfig(!config.monitoringEnabled, config.checkIntervalHours)
          }
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            config.monitoringEnabled ? "bg-primary" : "bg-surface-container-high",
          )}
        >
          <span
            className={cn(
              "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
              config.monitoringEnabled ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>

      {/* Interval selector */}
      {config.monitoringEnabled && (
        <div className="mt-4">
          <label
            htmlFor={`monitoring-interval-${companyId}`}
            className="text-xs font-medium text-on-surface-variant"
          >
            Check frequency
          </label>
          <select
            id={`monitoring-interval-${companyId}`}
            value={config.checkIntervalHours}
            onChange={(e) =>
              updateConfig(config.monitoringEnabled, Number(e.target.value))
            }
            disabled={isPending}
            className="mt-1 block w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Status */}
      {config.lastAutoScanAt && (
        <div className="mt-4 flex items-center gap-2 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[14px]">schedule</span>
          <span>
            Last auto-scan:{" "}
            {new Date(config.lastAutoScanAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}

      {/* Manual check button */}
      <div className="mt-4 border-t border-outline-variant pt-4">
        <button
          type="button"
          onClick={runCheck}
          disabled={isChecking}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-sm font-medium text-on-surface transition hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isChecking ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[16px]">
                progress_activity
              </span>
              Checking...
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">
                fact_check
              </span>
              Check now
            </>
          )}
        </button>

        {checkResult && (
          <p
            className={cn(
              "mt-2 text-xs",
              checkResult.includes("changed")
                ? "text-amber-600"
                : checkResult.includes("failed")
                  ? "text-rose-600"
                  : "text-emerald-600",
            )}
          >
            {checkResult}
          </p>
        )}
      </div>
    </div>
  );
}
