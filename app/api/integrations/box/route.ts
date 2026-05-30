import type { NextRequest } from "next/server";

import { handleStoreIntegration } from "@/lib/integrations";

/**
 * `POST /api/integrations/box` — store the Box Integration configuration for
 * the active workspace (Requirements 21.6, 22.2, 22.3, 22.4, 22.5).
 *
 * All credential handling (validation, encrypt-vs-mock, never-leak response
 * shaping) lives in the server-only {@link handleStoreIntegration}; this file
 * is the thin App Router binding. Running on the Node.js runtime is required so
 * the credential vault can use Node `crypto`.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleStoreIntegration(request, "Box");
}
