import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Strategy } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Lifecycle status of a Scan, mirroring the `scans.status` CHECK constraint
 * and the workflow's ordered statuses (design: Scan Lifecycle).
 */
export type ScanStatus =
  | "queued"
  | "scraping"
  | "uploading"
  | "diffing"
  | "analyzing"
  | "completed"
  | "failed";

/** Human-readable label for each Scan status (Requirement 7.1 labels). */
const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "Queued",
  scraping: "Scraping",
  uploading: "Uploading to Box",
  diffing: "Diffing",
  analyzing: "Analyzing",
  completed: "Complete",
  failed: "Failed",
};

/** Readable label for each strategy prediction enum value. */
const STRATEGY_LABELS: Record<Strategy, string> = {
  moving_upmarket: "Moving upmarket",
  enterprise_readiness: "Enterprise readiness",
  pricing_tightening: "Pricing tightening",
  security_posture_change: "Security posture change",
  messaging_pivot: "Messaging pivot",
  self_serve_push: "Self-serve push",
  insufficient_evidence: "Insufficient evidence",
};

/** The most recent Scan summary shown on the card. */
export interface CompanyCardLatestScan {
  status: ScanStatus;
  /** Scan start time as an ISO string, epoch millis, or Date. */
  createdAt: string | number | Date;
}

/** Verdict summary shown when the most recent Scan has a Verdict. */
export interface CompanyCardVerdict {
  strategyPrediction: Strategy;
  /** Optional pre-formatted label that overrides the enum-derived label. */
  strategyLabel?: string;
  /** Risk score, an integer in [0, 100]. */
  riskScore: number;
}

/** Well-typed input describing a single monitored Company. */
export interface CompanyCardCompany {
  id: string;
  name: string;
  domain: string;
  /** Count of Watched_Sources for the Company. */
  sourceCount: number;
  /** Most recent Scan, or null/undefined when the Company has no Scan. */
  latestScan?: CompanyCardLatestScan | null;
  /** Verdict of the most recent Scan, when one exists. */
  verdict?: CompanyCardVerdict | null;
}

export interface CompanyCardProps {
  company: CompanyCardCompany;
  /** Detail-page href. Defaults to `/companies/{id}`. */
  href?: string;
  className?: string;
}

const NOT_YET_SCANNED = "Not yet scanned";

/** Format a Scan start time deterministically for display. */
function formatScanTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Dashboard card for a single monitored Company.
 *
 * Shows the Company name, domain, Watched_Source count, and the status and
 * start time of the most recent Scan. When that Scan has a Verdict, the
 * Verdict's strategy prediction and risk score are also shown
 * (Requirements 3.2, 3.6). When the Company has no Scan, a single
 * "Not yet scanned" indicator is shown in place of the scan status, last
 * scan time, strategy prediction, and risk score (Requirement 3.7).
 *
 * The whole card links to the Company detail page so selecting it navigates
 * to `/companies/{id}` (supports Requirement 3.3).
 */
export function CompanyCard({ company, href, className }: CompanyCardProps) {
  const { id, name, domain, sourceCount, latestScan, verdict } = company;
  const detailHref = href ?? `/companies/${id}`;
  const hasScan = latestScan != null;
  const strategyLabel =
    verdict != null
      ? verdict.strategyLabel ?? STRATEGY_LABELS[verdict.strategyPrediction]
      : null;

  return (
    <Link
      href={detailHref}
      aria-label={`View details for ${name}`}
      className={cn(
        "block rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
    >
      <Card className="h-full hover:border-primary/50 hover:shadow-md">
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-xl">{name}</CardTitle>
          <p className="text-sm text-muted-foreground">{domain}</p>
          <p className="text-sm text-muted-foreground">
            {sourceCount} {sourceCount === 1 ? "source" : "sources"} watched
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {hasScan ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Last scan
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {SCAN_STATUS_LABELS[latestScan.status]}
                  </Badge>
                  <time
                    className="text-sm text-muted-foreground"
                    dateTime={new Date(latestScan.createdAt).toISOString()}
                  >
                    {formatScanTime(latestScan.createdAt)}
                  </time>
                </div>
              </div>
              {verdict != null && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{strategyLabel}</span>
                  <Badge variant="outline">Risk {verdict.riskScore}</Badge>
                </div>
              )}
            </>
          ) : (
            <Badge variant="outline">{NOT_YET_SCANNED}</Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
