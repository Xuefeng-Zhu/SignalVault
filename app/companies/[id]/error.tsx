"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Error boundary for the Company detail page — `/companies/[id]`
 * (Requirement 5.8).
 *
 * The page's server component loads the company under a 10-second timeout
 * ({@link withTimeout} in `page.tsx`). If the load fails or does not complete
 * within 10 seconds, the wrapper throws and Next renders this boundary instead
 * of the page. It surfaces an error message and a **retry** control: `reset()`
 * re-runs the segment's server render, re-attempting the load (Requirement
 * 5.8). Because the boundary fully replaces the page subtree, no partial or
 * stale company content is shown on failure.
 *
 * This is a Client Component (required for `error.tsx`); it renders no
 * workspace-scoped data — only the (non-sensitive) error message and a retry
 * button.
 */
export default function CompanyDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surface the failure for diagnostics without leaking it into the UI.
    console.error("Company detail failed to load:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-6 py-24">
      <Card className="w-full" role="alert">
        <CardHeader>
          <CardTitle>We couldn&rsquo;t load this company</CardTitle>
          <CardDescription>
            The company detail failed to load or took too long to respond.
            Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            If the problem continues, the service may be temporarily
            unavailable.
          </p>
          <div>
            <Button type="button" onClick={() => reset()}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
