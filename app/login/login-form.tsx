"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { getInsForgeClientBrowser } from "@/lib/insforge/client";

interface LoginFormProps {
  redirectTo: string;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const client = getInsForgeClientBrowser();

    if (mode === "signup") {
      const { error: signUpError } = await client.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        setError(signUpError.message ?? "Failed to create account.");
        return;
      }

      setSuccess("Account created! Check your email to verify, then sign in.");
      setMode("signin");
      return;
    }

    // Sign in
    const { data, error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data) {
      setError(signInError?.message ?? "Invalid email or password.");
      return;
    }

    startTransition(() => {
      router.push(redirectTo);
      router.refresh();
    });
  }

  async function handleOAuthSignIn(provider: "google" | "github") {
    setError(null);
    const client = getInsForgeClientBrowser();

    const { data, error: oauthError } = await client.auth.signInWithOAuth({
      provider,
      redirectTo: `${window.location.origin}/api/auth/callback?redirect_to=${encodeURIComponent(redirectTo)}`,
    });

    if (oauthError || !data?.url) {
      setError(oauthError?.message ?? "Failed to start OAuth sign-in.");
      return;
    }

    // Redirect to the OAuth provider
    window.location.href = data.url;
  }

  async function handleDemoSignIn() {
    setError(null);
    const res = await fetch("/api/auth/demo", { method: "POST" });
    if (!res.ok) {
      setError("Demo sign-in failed.");
      return;
    }
    startTransition(() => {
      router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Demo sign-in */}
      <button
        type="button"
        onClick={handleDemoSignIn}
        disabled={isPending}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        Sign in with demo account
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-outline-variant" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-on-surface-variant">
            or use a real account
          </span>
        </div>
      </div>

      {/* OAuth buttons */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => handleOAuthSignIn("google")}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-outline-variant bg-white px-4 py-3 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>

        <button
          type="button"
          onClick={() => handleOAuthSignIn("github")}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-outline-variant bg-white px-4 py-3 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          Continue with GitHub
        </button>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-outline-variant" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-on-surface-variant">
            or continue with email
          </span>
        </div>
      </div>

      {/* Email/Password form */}
      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="text-sm font-medium text-on-surface"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-sm font-medium text-on-surface"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Create a password" : "Enter your password"}
            required
            minLength={6}
            className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {success && (
          <p className="text-sm text-green-600">{success}</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending
            ? "Signing in..."
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      {/* Toggle sign-in / sign-up */}
      <p className="text-center text-sm text-on-surface-variant">
        {mode === "signin" ? (
          <>
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
                setSuccess(null);
              }}
              className="font-medium text-primary hover:underline"
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
                setSuccess(null);
              }}
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
