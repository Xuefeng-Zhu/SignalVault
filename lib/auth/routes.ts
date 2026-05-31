/**
 * Pure, runtime-agnostic auth routing helpers.
 *
 * This module is deliberately free of any `server-only` import and of every
 * Node-only API so it can be imported from BOTH the Edge middleware
 * (`middleware.ts`) and server components / route handlers. It only knows which
 * routes are protected and where the auth flow lives — no credentials and no
 * I/O.
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
export const PROTECTED_PREFIXES = [
  "/companies",
  "/scans",
  "/claims",
  "/evidence-vault",
  "/integrations",
  "/settings",
] as const;

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
