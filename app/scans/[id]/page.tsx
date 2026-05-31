import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BoxEvidenceLink } from "@/components/box-evidence-link";
import { ClaimLedger, type ClaimLedgerRow } from "@/components/claim-ledger";
import { EvidenceArtifactList } from "@/components/evidence-artifact-list";
import { Badge } from "@/components/ui/badge";
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
  WorkspaceRepository,
} from "@/lib/adapters/types";

import { strategyLabel } from "@/components/strategy-verdict-card";
import { ScanDetailClient } from "./scan-detail-client";

export const dynamic = "force-dynamic";

const LOAD_TIMEOUT_MS = 10_000;

const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "Queued",
  scraping: "Scraping",
  uploading: "Uploading to Box",
  diffing: "Diffing",
  analyzing: "Analyzing",
  completed: "Complete",
  failed: "Failed",
};

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
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

async function loadScanData(repo: WorkspaceRepository, scanId: string): Promise<{
  scan: Scan | null;
  company: Company | null;
  claims: ClaimRow[];
  verdict: VerdictRow | null;
}> {
  const scan = await repo.scans.get(scanId);
  if (!scan) {
    return { scan: null, company: null, claims: [], verdict: null };
  }

  const [company, claims, verdict] = await Promise.all([
    repo.companies.get(scan.companyId),
    repo.claims.listForScan(scanId),
    repo.verdicts.getForScan(scanId),
  ]);

  return { scan, company, claims, verdict };
}

function statusTone(status: ScanStatus): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-100 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-100 text-rose-700";
  return "border-amber-200 bg-amber-100 text-amber-700";
}

export default async function ScanDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const resolution = await resolveActiveWorkspace();
  if (resolution.status === "redirect") {
    redirect(
      `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(`/scans/${params.id}`)}`,
    );
  }

  const repo = resolution.insforge.scoped(resolution.workspace.id);
  const { scan, company, claims, verdict } = await withTimeout(
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
    evidenceText: c.evidenceText,
  }));

  const evidenceUrl = scan.boxScanFolderId
    ? `${process.env.NEXT_PUBLIC_INSFORGE_API_URL ?? ""}/api/storage/buckets/evidence/objects?prefix=${encodeURIComponent(scan.boxScanFolderId + "/")}`
    : null;
  const isSimulatedBox = scan.boxScanFolderId?.startsWith("mock-") ?? false;

  const simWarnings: string[] = [];
  if (isSimulatedBox) {
    simWarnings.push("This scan used simulated Box storage (demo mode).");
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
        <Link href="/companies" className="hover:text-on-surface">
          Companies
        </Link>
        <span>›</span>
        <Link href={`/companies/${scan.companyId}`} className="hover:text-on-surface">
          {company?.name ?? "Company"}
        </Link>
        <span>›</span>
        <span>Scans</span>
        <span>›</span>
        <span className="text-on-surface">{scan.id.slice(0, 8)}</span>
      </nav>

      <section className="glass-card overflow-hidden bg-[linear-gradient(135deg,rgba(49,107,243,0.08),rgba(234,237,255,0.65)_45%,rgba(255,255,255,0.95))] px-8 py-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <Badge className={cn("border", statusTone(scan.status))}>
              {SCAN_STATUS_LABELS[scan.status]}
            </Badge>
            <div>
              <h1 className="font-page-title text-page-title text-on-surface">
                Scan {scan.id.slice(0, 8)}
              </h1>
              <p className="mt-1 text-body-md text-on-surface-variant">
                {company?.name ?? "Unknown company"} · Started {formatDate(scan.createdAt)}
              </p>
            </div>
          </div>

          <Link
            href={`/companies/${scan.companyId}`}
            className={cn(buttonVariants({ variant: "outline" }), "rounded-lg px-4")}
          >
            Back to company
          </Link>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-outline-variant/80 bg-white/85 p-5">
            <p className="text-body-sm text-on-surface-variant">Trigger type</p>
            <p className="mt-2 font-section-title text-section-title text-on-surface">
              {scan.triggerType}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/80 bg-white/85 p-5">
            <p className="text-body-sm text-on-surface-variant">Confidence</p>
            <p className="mt-2 font-section-title text-section-title text-on-surface">
              {verdict ? `${verdict.confidence}%` : "Pending"}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/80 bg-white/85 p-5">
            <p className="text-body-sm text-on-surface-variant">Risk score</p>
            <p className="mt-2 font-section-title text-section-title text-on-surface">
              {verdict ? verdict.riskScore : "—"}
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {[
          "Intelligence Brief",
          "Evidence",
          "Sources",
          "Activity Log",
        ].map((tab, index) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "rounded-full px-4 py-2 text-body-sm transition",
              index === 0
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {scan.status === "failed" && scan.failureReason ? (
        <div className="glass-card border-rose-200 bg-rose-50 px-6 py-5">
          <h2 className="font-section-title text-section-title text-rose-700">
            Scan failed
          </h2>
          <p className="mt-2 text-body-md text-rose-700">{scan.failureReason}</p>
        </div>
      ) : null}

      {simWarnings.map((warning) => (
        <div
          key={warning}
          className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-body-md text-amber-800"
        >
          {warning}
        </div>
      ))}

      <section className="grid gap-6 lg:grid-cols-3">
        <article className="glass-card p-6">
          <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-rose-600">
            Prosecution
          </p>
          <h2 className="mt-3 font-section-title text-section-title text-on-surface">
            Signals that increase concern
          </h2>
          <ul className="mt-4 space-y-3 text-body-md text-on-surface">
            {(verdict?.keyEvidence ?? []).slice(0, 4).map((item) => (
              <li key={item} className="flex gap-3">
                <span className="material-symbols-outlined mt-0.5 text-[18px] text-rose-500">
                  gavel
                </span>
                <span>{item}</span>
              </li>
            ))}
            {verdict?.keyEvidence.length ? null : (
              <li className="text-body-md text-on-surface-variant">
                No prosecution evidence has been recorded yet.
              </li>
            )}
          </ul>
        </article>

        <article className="glass-card p-6">
          <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-amber-600">
            Defense
          </p>
          <h2 className="mt-3 font-section-title text-section-title text-on-surface">
            Counter-evidence and mitigating context
          </h2>
          <ul className="mt-4 space-y-3 text-body-md text-on-surface">
            {(verdict?.counterEvidence ?? []).slice(0, 4).map((item) => (
              <li key={item} className="flex gap-3">
                <span className="material-symbols-outlined mt-0.5 text-[18px] text-amber-500">
                  balance
                </span>
                <span>{item}</span>
              </li>
            ))}
            {verdict?.counterEvidence.length ? null : (
              <li className="text-body-md text-on-surface-variant">
                No counter-evidence was recorded for this scan.
              </li>
            )}
          </ul>
        </article>

        <article className="glass-card p-6">
          <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
            Judge ruling
          </p>
          <h2 className="mt-3 font-section-title text-section-title text-on-surface">
            {verdict ? strategyLabel(verdict.strategyPrediction) : "Awaiting verdict"}
          </h2>
          <p className="mt-4 text-body-md text-on-surface-variant">
            {verdict
              ? `SignalVault classified this scan with ${verdict.confidence}% confidence and a risk score of ${verdict.riskScore}.`
              : "The scan has not produced a final verdict yet."}
          </p>
          {verdict?.recommendedActions?.length ? (
            <ul className="mt-4 space-y-3 text-body-md text-on-surface">
              {verdict.recommendedActions.slice(0, 3).map((action) => (
                <li key={action} className="flex gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-[18px] text-primary">
                    task_alt
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.9fr)]">
        <div className="space-y-6">
          <section className="glass-card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                  Scan progress
                </p>
                <h2 className="mt-2 font-section-title text-section-title text-on-surface">
                  Activity log
                </h2>
              </div>
            </div>
            <div className="mt-6">
              <ScanDetailClient scanId={scan.id} initialStatus={scan.status} />
            </div>
          </section>

          <section className="glass-card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                  Claim ledger
                </p>
                <h2 className="mt-2 font-section-title text-section-title text-on-surface">
                  Extracted claims
                </h2>
              </div>
              <span className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-body-sm text-on-surface-variant">
                {claims.length} claim{claims.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-6">
              <ClaimLedger claims={claimsRows} />
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          {evidenceUrl ? (
            <section className="glass-card p-6">
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                Evidence folder
              </p>
              <h2 className="mt-2 font-section-title text-section-title text-on-surface">
                Evidence storage
              </h2>
              <div className="mt-6">
                <BoxEvidenceLink url={evidenceUrl} simulated={isSimulatedBox} />
              </div>
            </section>
          ) : null}

          <section className="glass-card p-6">
            <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
              Evidence artifacts
            </p>
            <h2 className="mt-2 font-section-title text-section-title text-on-surface">
              Stored outputs
            </h2>
            <div className="mt-6">
              <EvidenceArtifactList
                artifacts={
                  evidenceUrl
                    ? [
                        {
                          type: "report",
                          name: "Scan evidence folder",
                          boxUrl: evidenceUrl,
                          simulated: isSimulatedBox,
                        },
                      ]
                    : []
                }
              />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
