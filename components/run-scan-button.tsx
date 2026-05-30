"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RunScanButtonProps {
  /** Target Company id; used to build the scan-creation endpoint. */
  companyId: string;
  /** Optional label override for the idle state. */
  label?: string;
  className?: string;
}

/** Read a scan id from a few likely API response shapes. */
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

/**
 * Starts a Scan for a Company and navigates to its Scan detail page.
 *
 * On click it POSTs to `/api/companies/{companyId}/scans`
 * (Requirements 5.4, 6.1). While the request is in flight the button shows a
 * loading state and is disabled to prevent duplicate submissions. On success
 * it reads the returned scan id and routes to `/scans/{scanId}`
 * (Requirement 6.7). If the request fails — a network error, a non-OK
 * response, or a response without a scan id — it shows an inline error and
 * re-enables the button so the User can retry.
 */
export function RunScanButton({
  companyId,
  label = "Run scan",
  className,
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
      >
        {isRunning ? "Starting scan…" : label}
      </Button>
      {error != null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
