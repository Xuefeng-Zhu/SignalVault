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
 * Error boundary for the Scan detail page — `/scans/[id]`
 * (Requirement 7.8).
 *
 * The page's server component loads scan data under a 10-second timeout. If
 * the load fails or times out, Next.js renders this boundary. It surfaces an
 * error message and a **retry** control that re-runs the server render.
 */
export default function ScanDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Scan detail failed to load:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-6 py-24">
      <Card className="w-full" role="alert">
        <CardHeader>
          <CardTitle>We couldn&rsquo;t load this scan</CardTitle>
          <CardDescription>
            The scan detail failed to load or took too long to respond. Please
            try again.
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
