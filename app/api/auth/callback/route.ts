import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  createServerClient,
  setAuthCookies,
} from "@insforge/sdk/ssr";

/**
 * OAuth callback route. After a successful OAuth sign-in, InsForge redirects
 * back to this URL with `?access_token=...&refresh_token=...`. We persist the
 * tokens as httpOnly cookies and redirect to the requested page.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accessToken = searchParams.get("access_token");
  const refreshToken = searchParams.get("refresh_token");
  const redirectTo = searchParams.get("redirect_to") ?? "/companies";

  if (!accessToken) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  // Write auth cookies
  const cookieStore = cookies();
  setAuthCookies(cookieStore, {
    accessToken,
    refreshToken,
  });

  // Verify the token is valid
  const client = createServerClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_API_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
    accessToken,
  });

  const { error } = await client.auth.getCurrentUser();
  if (error) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
