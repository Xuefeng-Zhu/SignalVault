"use client";

import { createBrowserClient } from "@insforge/sdk/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Returns a singleton InsForge browser client for client-side auth operations.
 * Reads NEXT_PUBLIC_* env vars at runtime. Automatically manages auth cookies.
 */
export function getInsForgeClientBrowser() {
  if (browserClient) return browserClient;

  browserClient = createBrowserClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_API_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
    refreshUrl: "/api/auth/refresh",
  });

  return browserClient;
}
