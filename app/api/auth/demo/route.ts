import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Demo sign-in route. Sets a synthetic access token cookie so the middleware
 * allows access to protected routes. This enables the app to work without a
 * real InsForge backend configured.
 */
export async function POST() {
  const cookieStore = cookies();

  // Set a demo access token — the middleware only checks for presence, not validity.
  // Server-side `resolveActiveWorkspace` will fall through to the demo workspace.
  cookieStore.set("insforge_access_token", "demo_session_token", {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  cookieStore.set("insforge_refresh_token", "demo_refresh_token", {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({ success: true });
}
