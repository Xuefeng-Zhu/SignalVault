import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Minimal placeholder for the authentication flow (Requirement 1.1).
 *
 * The middleware redirects unauthenticated requests for protected routes here
 * (`/login?redirectTo=...`), so this route must always resolve. The full
 * InsForge sign-in UI (email/password + OAuth via `@insforge/sdk`) is out of
 * scope for task 8.1; this page exists so the redirect target is reachable and
 * communicates the demo path. It renders no workspace-scoped data.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { redirectTo?: string };
}) {
  const redirectTo = searchParams?.redirectTo ?? "/companies";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to SignalVault</CardTitle>
          <CardDescription>
            Authentication is required to view companies, scans, and evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The sign-in experience is coming soon. To explore SignalVault now,
            run it in Demo Mode with the seeded &ldquo;Acme AI&rdquo; workspace.
          </p>
          <p className="break-all text-xs text-muted-foreground">
            You&rsquo;ll be returned to{" "}
            <span className="font-medium">{redirectTo}</span> after signing in.
          </p>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
            Back to home
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
