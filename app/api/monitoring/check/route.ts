import { NextResponse } from "next/server";

import { requireActiveWorkspace } from "@/lib/api/workspace";
import {
  checkCompanySources,
  inMemoryMonitoringDb,
} from "@/lib/monitoring";

export const dynamic = "force-dynamic";

/**
 * POST /api/monitoring/check
 *
 * Run a lightweight content-hash check for a specific company's watched sources.
 * Requires user auth via requireActiveWorkspace.
 *
 * Body: { companyId: string }
 *
 * Returns a summary of which sources changed and whether a scan was triggered.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireActiveWorkspace();
  if (!guard.ok) return guard.response;

  const repo = guard.insforge.scoped(guard.workspace.id);

  let body: { companyId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { companyId } = body;
  if (!companyId || typeof companyId !== "string") {
    return NextResponse.json(
      { error: "companyId is required" },
      { status: 400 },
    );
  }

  // Verify company exists in this workspace
  const company = await repo.companies.get(companyId);
  if (!company) {
    return NextResponse.json(
      { error: "Company not found in active workspace" },
      { status: 404 },
    );
  }

  // Get watched sources
  const sources = await repo.companies.listSources(companyId);
  if (sources.length === 0) {
    return NextResponse.json({
      companyId,
      companyName: company.name,
      sourcesChecked: 0,
      sourcesChanged: 0,
      sourcesFailed: 0,
      scanTriggered: false,
      results: [],
      message: "No watched sources configured for this company",
    });
  }

  // Run the check
  const result = await checkCompanySources(
    inMemoryMonitoringDb,
    repo,
    guard.workspace.id,
    company,
    sources,
  );

  return NextResponse.json(result);
}
