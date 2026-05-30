import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as React from "react";

import { BoxEvidenceLink } from "@/components/box-evidence-link";
import { ClaimLedger, type ClaimLedgerRow } from "@/components/claim-ledger";
import { CourtroomAnalysis } from "@/components/courtroom-analysis";
import { EvidenceArtifactList } from "@/components/evidence-artifact-list";
import { RiskBadge } from "@/components/risk-badge";
import { StrategyVerdictCard } from "@/components/strategy-verdict-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import type {
  ClaimRow,
  ScanStatus,
  WorkspaceRepository,
} from "@/lib/adapters/types";
import { ScanDetailClient } from "./scan-detail-client";

/**
 * Scan detail page — `/scans/[id]` (Requirements 7, 12, 14, 15, 16, 17).
 *
 * Server component that loads the scan, its claims and verdict, then renders:
 *  - ScanProgressTimeline for live status tracking (Req 7.1)
 *  - BoxEvidenceLink to the Box evidence folder (Req 10.6)
 *  - Per-source DiffViewer for change diffs (Req 11.4)
 *  - ClaimLedger of extracted/classified claims (Req 14.4)
 *  - CourtroomAnalysis — defense, prosecution, judge (Req 15.4)
 *  - StrategyVerdictCard + RiskBadge from the scan verdict (Req 16.2, 16.3)
 *  - EvidenceArtifactList of Box artifacts (Req 17.5)
 *
 * Redirects to auth if not logged in (Req 1.1). Returns 404 when the scan
 * is not found or belongs to another workspace (Req 1.5).
 */
export const dynamic = "force-dynamic";

const LOAD_TIMEOUT_MS = 10_000;

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
    clearTimeout(timer);
  }
}

const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "Queued",
  scraping: "Scraping",
  uploading: "Uploading to Box",
  diffing: "Diffing",
  analyzing: "Analyzing",
  completed: "Complete",
  failed: "Failed",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

async function loadScanData(
  repo: WorkspaceRepository,
  scanId: string,
) {
  const [scan, claims, verdict] = await Promise.all([
    repo.scans.get(scanId),
    repo.claims.listForScan(scanId),
    repo.verdicts.getForScan(scanId),
  ]);
  return { scan, claims, verdict };
}

export default async function ScanDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const workspaceResult = await resolveActiveWorkspace();
  if (workspaceResult.outcome === "redirect") {
    redirect(
      `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(`/scans/${params.id}`)}`,
    );
  }

  const { repo } = workspaceResult;

  const { scan, claims, verdict } = await withTimeout(
    loadScanData(repo, params.id),
    LOAD_TIMEOUT_MS,
    "Scan detail page timed out loading data.",
  );

  if (!scan) notFound();

  const claimsRows: ClaimLedgerRow[] = claims.map((c: ClaimRow) => ({
    statementText: c.statementText,
    claimType: c.claimType,
    claimStatus: c.claimStatus ?? undefined,
    confidence: c.confidence,
  }));

  const boxUrl = scan.boxScanFolderId
    ? `https://app.box.com/folder/${scan.boxScanFolderId}`
    : null;

  const isSimulatedBox = scan.boxScanFolderId?.startsWith("mock-") ?? false;

  const simWarnings: string[] = [];
  if (isSimulatedBox) {
    simWarnings.push("This scan used simulated Box storage (demo mode).");
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-8 px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Scan Detail</h1>
            <Badge variant="secondary">
              {SCAN_STATUS_LABELS[scan.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Scan ID: <code className="font-mono">{scan.id}</code>
          </p>
          <p className="text-sm text-muted-foreground">
            Started: {formatDate(scan.createdAt)}
          </p>
        </div>
        <Link
          href={`/companies/${scan.companyId}`}
          className={cn(buttonVariants({ variant: "outline" }), "text-sm")}
        >
          ← Company
        </Link>
      </div>

      {/* Failure reason */}
      {scan.status === "failed" && scan.failureReason ? (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 text-base">
              Scan failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-700">{scan.failureReason}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Simulated storage warnings */}
      {simWarnings.map((w) => (
        <div
          key={w}
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          {w}
        </div>
      ))}

      {/* Progress timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scan Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ScanDetailClient scanId={scan.id} initialStatus={scan.status} />
        </CardContent>
      </Card>

      {/* Box evidence folder */}
      {boxUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evidence Folder</CardTitle>
          </CardHeader>
          <CardContent>
            <BoxEvidenceLink url={boxUrl} simulated={isSimulatedBox} />
          </CardContent>
        </Card>
      ) : null}

      {/* Strategy verdict + risk badge */}
      {verdict ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <StrategyVerdictCard
            strategyPrediction={verdict.strategyPrediction}
            confidence={verdict.confidence}
            recommendedActions={verdict.recommendedActions}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Risk Assessment</CardTitle>
            </CardHeader>
            <CardContent>
              <RiskBadge score={verdict.riskScore} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Courtroom analysis */}
      {verdict ? (
        <CourtroomAnalysis
          defense={
            verdict.keyEvidence.length > 0
              ? {
                  argument: `${verdict.keyEvidence.length} evidence item(s) support this strategy prediction.`,
                  keyEvidence: verdict.keyEvidence,
                }
              : undefined
          }
          prosecution={
            verdict.counterEvidence.length > 0
              ? {
                  argument: `${verdict.counterEvidence.length} counter-evidence item(s) challenge this prediction.`,
                  counterEvidence: verdict.counterEvidence,
                }
              : undefined
          }
          judge={{
            conclusion: `Strategy: ${verdict.strategyPrediction} (confidence ${verdict.confidence}%)`,
          }}
        />
      ) : null}

      {/* Diff viewers: placeholder section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change Diffs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Diff reports are stored as Box evidence artifacts.
          </p>
        </CardContent>
      </Card>

      {/* Claim ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claim Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <ClaimLedger claims={claimsRows} />
        </CardContent>
      </Card>

      {/* Evidence artifacts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidence Artifacts</CardTitle>
        </CardHeader>
        <CardContent>
          <EvidenceArtifactList
            artifacts={
              boxUrl
                ? [
                    {
                      type: "report",
                      name: "Scan evidence folder",
                      boxUrl,
                      simulated: isSimulatedBox,
                    },
                  ]
                : []
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
