import { NextResponse, type NextRequest } from "next/server";

const ACCESS_TOKEN_COOKIE = "insforge_access_token";

import {
  LOGIN_PATH,
  REDIRECT_PARAM,
  isProtectedPath,
} from "@/lib/auth/routes";

/**
 * Next.js Edge middleware: the first gate protecting SignalVault's app routes
 * (Requirement 1.1).
 *
 * ## What it protects
 *
 * The protected routes are `/companies`, `/companies/*`, and `/scans/*` (see
 * `lib/auth/routes.ts#PROTECTED_PREFIXES`). The landing page `/`, the auth flow
 * `/login`, and all static assets are NOT protected and pass straight through —
 * the `config.matcher` below already excludes Next internals and asset
 * requests, and `isProtectedPath` narrows to the app routes within that.
 *
 * ## Behavior
 *
 * - UNAUTHENTICATED request to a protected route → 307 redirect to the auth flow
 *   (`/login`) with the originally requested path in `?redirectTo=`. The
 *   protected page never renders and no workspace-scoped data is returned
 *   (Requirement 1.1). "Authenticated" here means the InsForge access-token
 *   cookie is present; the token's validity is verified server-side by
 *   `resolveActiveWorkspace` (the authoritative backstop), so a stale cookie
 *   still cannot surface scoped data.
 *
 * ## Why this is Edge-safe
 *
 * This file runs in the Edge runtime, so it avoids Node-only APIs and the
 * `server-only` env module. It reads only the auth cookie mirrored from the
 * InsForge SDK default (`insforge_access_token`) so the middleware stays
 * Edge-safe. It performs no network or database I/O.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Only the app routes are gated; everything else the matcher let through
  // (and `/`, `/login`) is public.
  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  // Authenticated iff the InsForge access-token cookie is present. Server-side
  // resolution re-validates the token before any scoped data is read.
  const accessTokenCookie = request.cookies.get(ACCESS_TOKEN_COOKIE);
  if (accessTokenCookie?.value) {
    return NextResponse.next();
  }

  // Unauthenticated → redirect to the auth flow, preserving the destination.
  // No protected content is rendered and no scoped data is returned (Req 1.1).
  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set(REDIRECT_PARAM, pathname);
  return NextResponse.redirect(loginUrl);
}

/**
 * Limit middleware to application routes. Excludes Next internals
 * (`/_next/*`), the API namespace (route handlers do their own auth + scope
 * checks), common asset extensions, and `favicon.ico`, so static assets are
 * never gated (Requirement 1.1's "allow static assets through").
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff|woff2|ttf)$).*)",
  ],
};
