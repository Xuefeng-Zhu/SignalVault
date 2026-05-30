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

export default function NewCompanyPage() {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <nav className="flex items-center gap-2 text-body-sm text-on-surface-variant">
        <Link href="/companies" className="hover:text-on-surface">
          Companies
        </Link>
        <span>›</span>
        <span className="text-on-surface">Add company</span>
      </nav>

      <div className="glass-card overflow-hidden bg-[linear-gradient(135deg,rgba(91,61,245,0.08),rgba(234,237,255,0.65)_45%,rgba(255,255,255,0.95))] px-8 py-8">
        <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
          Company onboarding
        </p>
        <h1 className="mt-3 font-page-title text-page-title text-on-surface">
          Add a company
        </h1>
        <p className="mt-3 max-w-2xl text-body-md text-on-surface-variant">
          Add a company with 3–5 public URLs to monitor. SignalVault will categorize each source, preserve evidence, and prepare the company for future scans.
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Company details</CardTitle>
          <CardDescription>
            Provide the company domain and the high-signal URLs you want monitored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddCompanyClient />
        </CardContent>
      </Card>
    </section>
  );
}
