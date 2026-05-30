"use client";

import * as React from "react";

import { ScanProgressTimeline } from "@/components/scan-progress-timeline";
import type { ScanStatus } from "@/components/company-card";

/**
 * Client component wrapper for ScanProgressTimeline that re-triggers
 * a server refresh when the scan completes (Requirement 7.5).
 */
export function ScanDetailClient({
  scanId,
  initialStatus,
  onComplete,
}: {
  scanId: string;
  initialStatus: ScanStatus;
  onComplete?: () => void;
}) {
  const [triggered, setTriggered] = React.useState(false);

  const handleStatusChange = React.useCallback(
    (status: ScanStatus) => {
      if ((status === "completed" || status === "failed") && !triggered) {
        setTriggered(true);
        onComplete?.();
      }
    },
    [triggered, onComplete],
  );

  return (
    <ScanProgressTimeline
      scanId={scanId}
      initialStatus={initialStatus}
      onStatusChange={handleStatusChange}
    />
  );
}
