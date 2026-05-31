"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getInsForgeClientBrowser } from "@/lib/insforge/client";

/**
 * Client-side OAuth callback page.
 *
 * After PKCE-based OAuth, the InsForge backend redirects here with
 * ?insforge_code=... The browser SDK exchanges this code for tokens using
 * the code_verifier stored in sessionStorage (set during signInWithOAuth).
 *
 * Once the exchange completes, we call the refresh endpoint to establish
 * the httpOnly insforge_access_token cookie, then redirect to the target page.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-on-surface-variant">Loading...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        const client = getInsForgeClientBrowser();

        // The SDK's constructor calls detectAuthCallback() which auto-detects
        // ?insforge_code=... and exchanges it. Any subsequent SDK HTTP call
        // awaits that internal promise. We use getCurrentUser() to both wait
        // for the exchange to complete AND verify we have a valid session.
        const { error: userError } = await client.auth.getCurrentUser();

        if (userError) {
          setError(
            userError.message ?? "Could not verify session after OAuth."
          );
          return;
        }

        // Establish the insforge_access_token cookie via the refresh endpoint
        // so the Edge middleware recognizes the session on navigation.
        const refreshRes = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });

        if (!refreshRes.ok) {
          const body = await refreshRes.json().catch(() => null);
          setError(
            body?.message ?? "Failed to establish session. Please try again."
          );
          return;
        }

        const rawRedirect = searchParams.get("redirect_to") ?? "/companies";
        // Prevent open redirect: only allow relative paths
        const redirectTo =
          rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
            ? rawRedirect
            : "/companies";
        router.replace(redirectTo);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Authentication failed."
        );
      }
    }

    handleCallback();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-white p-8 text-center">
          <h2 className="mb-2 text-lg font-semibold text-on-surface">
            Authentication Failed
          </h2>
          <p className="mb-6 text-sm text-on-surface-variant">{error}</p>
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-on-surface-variant">
          Completing sign-in...
        </p>
      </div>
    </div>
  );
}
