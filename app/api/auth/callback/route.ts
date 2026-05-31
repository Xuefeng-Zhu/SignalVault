import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  createServerClient,
  setAuthCookies,
} from "@insforge/sdk/ssr";

/**
 * OAuth callback route (legacy/fallback). The primary OAuth callback is now
 * the client-side page at /auth/callback which handles PKCE exchange.
 *
 * This server route handles two cases:
 * 1. Direct token delivery: ?access_token=...&refresh_token=...
 * 2. PKCE code: ?insforge_code=... → redirects to client-side handler
 */
/**
 * Validate that a redirect target is safe (same-origin relative path).
 * Prevents open redirect attacks via absolute URLs or protocol-relative paths.
 */
function safeRedirectPath(input: string): string {
  if (!input.startsWith("/") || input.startsWith("//")) {
    return "/companies";
  }
  return input;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const redirectTo = safeRedirectPath(searchParams.get("redirect_to") ?? "/companies");

  // PKCE flow: redirect to client-side handler that can access sessionStorage
  const insforgeCode = searchParams.get("insforge_code");
  if (insforgeCode) {
    const clientCallbackUrl = new URL("/auth/callback", request.url);
    clientCallbackUrl.searchParams.set("insforge_code", insforgeCode);
    clientCallbackUrl.searchParams.set("redirect_to", redirectTo);
    return NextResponse.redirect(clientCallbackUrl);
  }

  // Legacy: direct token delivery
  const accessToken = searchParams.get("access_token");
  const refreshToken = searchParams.get("refresh_token");

  if (!accessToken) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  // Verify the token is valid BEFORE setting cookies
  const client = createServerClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_API_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
    accessToken,
  });

  const { error } = await client.auth.getCurrentUser();
  if (error) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
  }

  // Token valid — persist auth cookies
  const cookieStore = cookies();
  setAuthCookies(cookieStore, {
    accessToken,
    refreshToken,
  });

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
