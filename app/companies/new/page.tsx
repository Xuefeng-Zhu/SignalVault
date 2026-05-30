import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { AddCompanyClient } from "./add-company-client";

export const dynamic = "force-dynamic";

/**
 * Add Company page (`/companies/new`).
 *
 * Protected route — the middleware redirects unauthenticated requests to the
 * auth flow before this renders, so no server-side workspace load is needed for
 * the form itself (Requirement 1.1). The page is a server component that frames
 * the form with a heading and a back link to the dashboard, then delegates the
 * interactive submit → navigate behavior to {@link AddCompanyClient}, which
 * hosts {@link AddCompanyForm} (Requirement 4.1) and routes to the new Company
 * detail page on success (Requirement 4.9).
 */
export default function NewCompanyPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-6 py-16">
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link
            href="/companies"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to companies
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Add a company</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Company details</CardTitle>
            <CardDescription>
              Add a company with 3&ndash;5 public URLs to monitor. Each URL is
              categorized by source type so SignalVault knows what it&rsquo;s
              watching.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddCompanyClient />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
