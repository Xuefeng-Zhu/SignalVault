/**
 * Pure, runtime-agnostic auth routing helpers.
 *
 * This module is deliberately free of any `server-only` import and of every
 * Node-only API so it can be imported from BOTH the Edge middleware
 * (`middleware.ts`) and server components / route handlers. It only knows which
 * routes are protected, where the auth flow lives, and how to parse the demo
 * flag — no credentials and no I/O.
 */

/**
 * The route the System redirects unauthenticated users to (Requirement 1.1).
 * A minimal placeholder page lives at this path so the redirect target always
 * resolves; the full sign-in UI is out of scope for this task.
 */
export const LOGIN_PATH = "/login";

/**
 * Query-string key carrying the originally requested path, so the auth flow can
 * send the user back after a successful sign-in.
 */
export const REDIRECT_PARAM = "redirectTo";

/**
 * Path prefixes that require authentication. Each protects the prefix itself
 * and everything beneath it:
 *   - `/companies`, `/companies/new`, `/companies/{id}`  (Req 3, 4, 5)
 *   - `/scans/{id}`                                        (Req 7, 17)
 *
 * `/` (landing), `/login` (auth flow), and static assets are intentionally
 * absent so they remain publicly reachable.
 */
export const PROTECTED_PREFIXES = ["/companies", "/scans"] as const;

/**
 * True when `pathname` is a protected app route. Matches a prefix exactly or as
 * a path segment boundary (`/companies` and `/companies/123`, but not a
 * hypothetical `/companies-public`).
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Parse a raw `DEMO_MODE` environment value the same way the server-only
 * `lib/config/env.ts#isDemoMode` does: "true", "1", and "yes" (case-insensitive,
 * surrounding whitespace ignored) are true; everything else — including an unset
 * value — is false.
 *
 * Duplicated here (rather than imported) on purpose: `lib/config/env.ts` is a
 * `server-only` module and must not be pulled into the Edge middleware bundle.
 * The parsing rule is kept identical so the two never diverge.
 */
export function isDemoModeEnabled(rawDemoMode: string | undefined): boolean {
  if (rawDemoMode === undefined) {
    return false;
  }
  return ["true", "1", "yes"].includes(rawDemoMode.trim().toLowerCase());
}
