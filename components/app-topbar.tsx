"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { RunScanButton } from "@/components/run-scan-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function getSearchPlaceholder(pathname: string): string {
  if (pathname === "/companies") return "Search companies or data...";
  if (pathname.startsWith("/companies/")) return "Search claims, evidence, or scans...";
  if (pathname.startsWith("/scans")) return "Search scans or evidence...";
  if (pathname.startsWith("/claims")) return "Search claims or verdicts...";
  return "Search SignalVault";
}

function getSearchShape(pathname: string): string {
  return pathname === "/companies" ? "rounded-full" : "rounded-lg";
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
  const companyId = getCompanyId(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-8 py-3">
        <label className="relative block w-full max-w-md flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-surface-variant">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </span>
          <input
            type="search"
            placeholder={getSearchPlaceholder(pathname)}
            className={cn(
              "h-10 w-full border border-outline-variant bg-surface-container-low pl-10 pr-4 text-sm text-on-surface outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/10",
              getSearchShape(pathname),
            )}
          />
        </label>

        <div className="flex items-center gap-3">
          <Link
            href="/companies/new"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-10 rounded-full border-outline-variant bg-surface-container-lowest px-4 text-sm font-medium text-on-surface shadow-none",
            )}
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add company
          </Link>

          {companyId ? (
            <RunScanButton
              companyId={companyId}
              label="Run scan"
              icon="bolt"
              buttonClassName="h-10 rounded-full bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-container"
            />
          ) : (
            <Link
              href="/companies/new"
              className={cn(
                buttonVariants({ variant: "default" }),
                "h-10 rounded-full px-4 text-sm font-medium",
              )}
            >
              <span className="material-symbols-outlined text-[18px]">bolt</span>
              Run scan
            </Link>
          )}

          <div className="hidden h-7 w-px bg-outline-variant md:block" />

          <button
            type="button"
            aria-label="Notifications"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[20px]">notifications</span>
          </button>

          <button
            type="button"
            aria-label="User menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary transition hover:bg-primary/15"
          >
            AM
          </button>
        </div>
      </div>
    </header>
  );
}
