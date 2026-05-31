import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";

export const dynamic = "force-dynamic";

export default async function ScansListPage() {
  const resolution = await resolveActiveWorkspace();

  if (resolution.status === "redirect") {
    redirect(`${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/scans")}`);
  }

  const repo = resolution.insforge.scoped(resolution.workspace.id);
  let scans: Array<{
    id: string;
    companyId: string;
    status: string;
    createdAt: string;
  }> = [];

  try {
    const companies = await repo.companies.list();
    for (const company of companies) {
      const companyScans = await repo.scans.listForCompany(company.id);
      scans.push(
        ...companyScans.map((s) => ({
          id: s.id,
          companyId: s.companyId,
          status: s.status,
          createdAt: s.createdAt,
        })),
      );
    }
    // Sort newest first
    scans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    // If API calls fail, show empty state
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "check_circle";
      case "failed":
        return "error";
      case "queued":
        return "schedule";
      default:
        return "sync";
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-emerald-600";
      case "failed":
        return "text-rose-600";
      case "queued":
        return "text-amber-600";
      default:
        return "text-blue-600";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-page-title text-[30px] font-semibold tracking-[-0.04em] text-on-surface">
            Scans
          </h1>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            View all scan runs across your monitored companies.
          </p>
        </div>
      </div>

      {scans.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[24px] border border-outline-variant bg-surface-container-lowest px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[24px]">radar</span>
          </div>
          <h2 className="mt-5 text-lg font-semibold text-on-surface">
            No scans yet
          </h2>
          <p className="mt-2 max-w-md text-sm text-on-surface-variant">
            Scans are triggered from the company detail page. Add a company and run your first scan to see results here.
          </p>
          <Link
            href="/companies"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Go to Companies
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low">
                <th className="px-5 py-3 text-left font-medium text-on-surface-variant">Status</th>
                <th className="px-5 py-3 text-left font-medium text-on-surface-variant">Scan ID</th>
                <th className="px-5 py-3 text-left font-medium text-on-surface-variant">Created</th>
                <th className="px-5 py-3 text-right font-medium text-on-surface-variant">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id} className="border-b border-outline-variant last:border-none hover:bg-surface-container-low/50">
                  <td className="px-5 py-3">
                    <span className={`material-symbols-outlined text-[18px] ${statusColor(scan.status)}`}>
                      {statusIcon(scan.status)}
                    </span>
                    <span className="ml-2 capitalize">{scan.status}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-on-surface-variant">
                    {scan.id.slice(0, 8)}…
                  </td>
                  <td className="px-5 py-3 text-on-surface-variant">
                    {new Date(scan.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/scans/${scan.id}`}
                      className="text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
