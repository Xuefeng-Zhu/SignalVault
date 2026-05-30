"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RunScanButtonProps {
  companyId: string;
  label?: string;
  className?: string;
  buttonClassName?: string;
  icon?: string;
}

function extractScanId(body: unknown): string | null {
  if (body == null || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.scanId === "string") {
    return record.scanId;
  }
  if (typeof record.id === "string") {
    return record.id;
  }
  const scan = record.scan;
  if (scan != null && typeof scan === "object") {
    const scanId = (scan as Record<string, unknown>).id;
    if (typeof scanId === "string") {
      return scanId;
    }
  }
  return null;
}

export function RunScanButton({
  companyId,
  label = "Run scan",
  className,
  buttonClassName,
  icon,
}: RunScanButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/companies/${companyId}/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Scan request failed with status ${response.status}`);
      }

      const body: unknown = await response.json().catch(() => null);
      const scanId = extractScanId(body);
      if (scanId == null) {
        throw new Error("Scan response did not include a scan id");
      }

      router.push(`/scans/${scanId}`);
    } catch {
      setError("Could not start the scan. Please try again.");
      setIsRunning(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={isRunning}
        aria-busy={isRunning}
        className={cn(buttonClassName)}
      >
        {icon ? (
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        ) : null}
        {isRunning ? "Starting scan…" : label}
      </Button>
      {error != null && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
