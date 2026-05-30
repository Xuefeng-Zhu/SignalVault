"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { RunScanButton } from "@/components/run-scan-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function getPageTitle(pathname: string): string {
  if (pathname === "/companies") return "Companies";
  if (pathname === "/companies/new") return "Add company";
  if (pathname.startsWith("/companies/")) return "Company intelligence";
  if (pathname.startsWith("/scans/")) return "Scan detail";
  if (pathname === "/scans") return "Scans";
  if (pathname === "/claims") return "Claims";
  if (pathname === "/evidence-vault") return "Evidence Vault";
  if (pathname === "/integrations") return "Integrations";
  if (pathname === "/settings") return "Settings";
  return "SignalVault";
}

function getSearchPlaceholder(pathname: string): string {
  if (pathname.startsWith("/companies")) return "Search companies, domains, or verdicts";
  if (pathname.startsWith("/scans")) return "Search scans, evidence, or rulings";
  return "Search SignalVault";
}

function getCompanyId(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "companies") return null;

  const companyId = segments[1];
  if (!companyId || companyId === "new") return null;
  return companyId;
}

export function AppTopbar() {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);
  const companyId = getCompanyId(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant bg-background/95 backdrop-blur">
      <div className="flex flex-col gap-4 px-container-margin py-lg xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-4 xl:flex-row xl:items-center">
          <div className="min-w-0 xl:min-w-[240px]">
            <h1 className="truncate font-page-title text-page-title text-on-surface">
              {pageTitle}
            </h1>
          </div>

          <label className="relative block w-full max-w-2xl">
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-on-surface-variant">
              <span className="material-symbols-outlined text-[20px]">search</span>
            </span>
            <input
              type="search"
              placeholder={getSearchPlaceholder(pathname)}
              className="h-11 w-full rounded-lg border border-transparent bg-surface-container-low pl-11 pr-4 text-body-md text-on-surface outline-none transition focus:border-outline-variant focus:bg-surface-container-lowest"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
          <Link
            href="/companies/new"
            className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-lg px-4")}
          >
            Add company
          </Link>

          {companyId ? (
            <RunScanButton
              companyId={companyId}
              label="Run scan"
              icon="bolt"
              buttonClassName="h-11 rounded-lg bg-primary px-4 text-on-primary hover:bg-primary-container"
            />
          ) : (
            <Link
              href="/companies"
              className={cn(
                buttonVariants({ variant: "default" }),
                "h-11 rounded-lg px-4",
              )}
            >
              <span className="material-symbols-outlined text-[18px]">bolt</span>
              Run scan
            </Link>
          )}

          <div className="hidden h-8 w-px bg-outline-variant xl:block" />

          <button
            type="button"
            aria-label="Notifications"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[20px]">notifications</span>
          </button>
          <button
            type="button"
            aria-label="Help"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[20px]">help</span>
          </button>
        </div>
      </div>
    </header>
  );
}
