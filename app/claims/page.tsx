import { redirect } from "next/navigation";

import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";
import { ClaimLedger, type ClaimLedgerRow } from "@/components/claim-ledger";

export const dynamic = "force-dynamic";

export default async function ClaimsPage() {
  const resolution = await resolveActiveWorkspace();

  if (resolution.status === "redirect") {
    redirect(`${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/claims")}`);
  }

  const repo = resolution.insforge.scoped(resolution.workspace.id);
  let claims: ClaimLedgerRow[] = [];

  try {
    const companies = await repo.companies.list();
    // Aggregate claims from the latest completed scan of each company
    for (const company of companies.slice(0, 10)) {
      const scans = await repo.scans.listForCompany(company.id);
      const latestCompleted = scans.find((s) => s.status === "completed");
      if (latestCompleted) {
        const scanClaims = await repo.claims.listForScan(latestCompleted.id);
        claims.push(
          ...scanClaims.map((c) => ({
            statementText: c.statementText,
            claimType: c.claimType,
            claimStatus: c.claimStatus ?? undefined,
            confidence: c.confidence,
            evidenceText: c.evidenceText,
          })),
        );
      }
    }
  } catch {
    // If API calls fail, show empty state
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-page-title text-[30px] font-semibold tracking-[-0.04em] text-on-surface">
          Claims
        </h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          All classified claims extracted from competitor web pages across your monitored companies.
        </p>
      </div>

      {claims.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[24px] border border-outline-variant bg-surface-container-lowest px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[24px]">gavel</span>
          </div>
          <h2 className="mt-5 text-lg font-semibold text-on-surface">
            No claims yet
          </h2>
          <p className="mt-2 max-w-md text-sm text-on-surface-variant">
            Claims are extracted from scans. Run a scan on a company to see classified claims here.
          </p>
        </div>
      ) : (
        <div className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-6">
          <ClaimLedger claims={claims} />
        </div>
      )}
    </div>
  );
}
