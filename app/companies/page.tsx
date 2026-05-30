import Link from "next/link";
import { redirect } from "next/navigation";

import { CompanyCard } from "@/components/company-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listCompanies, type CompanyListItem } from "@/lib/api/companies";
import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

import { RetryButton } from "./retry-button";

/** This route is the dashboard for the active Workspace. */
const COMPANIES_PATH = "/companies";
const NEW_COMPANY_PATH = "/companies/new";

/**
 * The dashboard reads the session + workspace-scoped data on every request, so
 * it must never be statically cached or shared across users.
 */
export const dynamic = "force-dynamic";

/**
 * Dashboard of monitored Companies for the active Workspace (Requirement 3).
 *
 * This is a Server Component: it resolves the active Workspace server-side and
 * loads the companies through the data layer directly (no client fetch, no
 * credentials in the browser).
 *
 * Behavior:
 *  - Unauthenticated / unresolvable session → redirect to the auth flow without
 *    rendering any protected content or scoped data (Requirement 1.1). The Edge
 *    middleware already gates this route; this server-side check is the
 *    authoritative backstop.
 *  - Otherwise → render every Company of the active Workspace as a
 *    {@link CompanyCard}, alpha-ordered (the data layer guarantees the order),
 *    each linking to its detail page (Requirements 3.1, 3.3).
 *  - Zero companies → an empty-state message plus an Add Company control
 *    (Requirement 3.4), shown regardless of whether companies previously
 *    existed (the active Workspace simply has none right now).
 *  - A persistent navigation control routes to the Add Company page
 *    (Requirement 3.5).
 *  - If loading the companies fails → an error message and a retry control are
 *    shown and NO partial/stale CompanyCards are rendered (Requirement 3.8).
 *    The thrown error is also caught by `app/companies/error.tsx` as a backstop.
 */
export default async function CompaniesDashboardPage() {
  const resolution = await resolveActiveWorkspace();

  // Redirect BEFORE any data load so unauthenticated requests never reach a
  // scoped query (Requirement 1.1). `redirect()` throws NEXT_REDIRECT, so it is
  // intentionally outside the try/catch below.
  if (resolution.status === "redirect") {
    redirect(
      `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(COMPANIES_PATH)}`,
    );
  }

  // Resolved: load the active Workspace's companies through the scoped repo.
  // A failure here is rendered as an error+retry state with no partial cards.
  let companies: CompanyListItem[] | null = null;
  let loadFailed = false;
  try {
    const repo = resolution.insforge.scoped(resolution.workspace.id);
    const result = await listCompanies(repo);
    companies = result.companies;
  } catch {
    // Do not surface internals; the dashboard owns the user-facing message.
    loadFailed = true;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Monitored companies in your workspace.
          </p>
        </div>
        {/* Add Company navigation, always available (Requirement 3.5). */}
        <Link
          href={NEW_COMPANY_PATH}
          className={cn(buttonVariants({ size: "default" }))}
        >
          Add company
        </Link>
      </header>

      {loadFailed ? (
        <DashboardError />
      ) : companies && companies.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => (
            <li key={company.id}>
              <CompanyCard company={company} />
            </li>
          ))}
        </ul>
      ) : (
        <DashboardEmptyState />
      )}
    </main>
  );
}

/**
 * Empty state shown when the active Workspace has zero companies
 * (Requirement 3.4). Provides a control to add the first company.
 */
function DashboardEmptyState() {
  return (
    <Card className="mx-auto w-full max-w-xl text-center">
      <CardHeader>
        <CardTitle>No companies yet</CardTitle>
        <CardDescription>
          Add a company with its public URLs to start turning web changes into
          auditable market intelligence.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Link
          href={NEW_COMPANY_PATH}
          className={cn(buttonVariants({ size: "lg" }))}
        >
          Add your first company
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Error + retry state shown when the companies fail to load (Requirement 3.8).
 * Renders no CompanyCards so no partial or stale data is shown.
 */
function DashboardError() {
  return (
    <Card className="mx-auto w-full max-w-xl text-center">
      <CardHeader>
        <CardTitle>Couldn&rsquo;t load your companies</CardTitle>
        <CardDescription>
          Something went wrong while loading the companies in your workspace.
          Your data is safe &mdash; please try again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <RetryButton />
      </CardContent>
    </Card>
  );
}
