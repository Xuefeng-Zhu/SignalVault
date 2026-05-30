"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Error boundary backstop for the dashboard route (Requirement 3.8).
 *
 * The dashboard page already catches a failed company load and renders an
 * inline error+retry state. This boundary is the safety net for any *other*
 * error thrown while rendering `/companies` (e.g. an unexpected throw outside
 * the page's try/catch). Like the inline state, it shows an error message and a
 * retry control and renders NO CompanyCards, so no partial or stale data is
 * shown.
 *
 * Next.js requires route error boundaries to be Client Components and passes a
 * `reset()` callback that re-attempts rendering the segment.
 */
export default function CompaniesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for diagnostics without leaking it to the UI.
    console.error("Dashboard render error", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Companies</h1>
      </header>
      <Card className="mx-auto w-full max-w-xl text-center">
        <CardHeader>
          <CardTitle>Couldn&rsquo;t load your companies</CardTitle>
          <CardDescription>
            Something went wrong while loading this page. Your data is safe
            &mdash; please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button type="button" onClick={() => reset()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
