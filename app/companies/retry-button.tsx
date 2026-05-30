"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Client-side "Try again" control for the dashboard error state
 * (Requirement 3.8).
 *
 * The dashboard page is a Server Component that re-runs its data load on a
 * fresh request, so retrying means re-fetching the route's server data.
 * `router.refresh()` re-invokes the server render (which re-attempts
 * {@link listCompanies}) without a full reload, and `useTransition` keeps the
 * button responsive and disabled while the refresh is in flight.
 *
 * Defined as its own client module so the dashboard page itself stays a Server
 * Component (it loads scoped data and must not become a client component).
 */
export function RetryButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {isPending ? "Retrying\u2026" : "Try again"}
    </Button>
  );
}
