import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearAuthCookies } from "@insforge/sdk/ssr";

/**
 * Sign-out route. Clears the auth cookies and redirects to login.
 */
export async function POST() {
  const cookieStore = cookies();
  clearAuthCookies(cookieStore);
  return NextResponse.json({ success: true });
}
