import { LoginForm } from "./login-form";

/**
 * Login page. Renders email/password + OAuth sign-in.
 * The middleware redirects unauthenticated requests here with ?redirectTo=...
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { redirectTo?: string; error?: string };
}) {
  const redirectTo = searchParams?.redirectTo ?? "/companies";
  const error = searchParams?.error;

  return (
    <main className="flex min-h-screen">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-[#020617] p-12 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <span className="material-symbols-outlined text-xl text-white">
              shield
            </span>
          </div>
          <span className="text-xl font-semibold tracking-tight">
            SignalVault
          </span>
        </div>

        <div className="space-y-6">
          <h1 className="text-4xl font-bold leading-tight">
            Turn public web changes into{" "}
            <span className="text-primary-container">auditable</span> market
            intelligence.
          </h1>
          <p className="text-lg text-white/70">
            SignalVault monitors competitor websites, captures changes as
            court-ready evidence, and surfaces actionable claims.
          </p>
        </div>

        <p className="text-sm text-white/40">
          © {new Date().getFullYear()} SignalVault. All rights reserved.
        </p>
      </div>

      {/* Right panel — auth form */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2 bg-background">
        <div className="w-full max-w-[400px] space-y-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <span className="material-symbols-outlined text-xl text-white">
                shield
              </span>
            </div>
            <span className="text-xl font-semibold tracking-tight">
              SignalVault
            </span>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-on-surface-variant">
              Sign in to your account to continue
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error === "missing_token" && "Sign-in failed: no token received."}
              {error === "invalid_token" && "Sign-in failed: invalid token."}
              {!["missing_token", "invalid_token"].includes(error) &&
                "An error occurred during sign-in."}
            </div>
          )}

          <LoginForm redirectTo={redirectTo} />
        </div>
      </div>
    </main>
  );
}
