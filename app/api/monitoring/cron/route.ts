import { NextResponse } from "next/server";

import {
  checkCompanySources,
  inMemoryMonitoringDb,
} from "@/lib/monitoring";
import type { CronRunResult } from "@/lib/monitoring";
import { getInsForgeClient } from "@/lib/adapters/factory";

export const dynamic = "force-dynamic";

/**
 * POST /api/monitoring/cron
 *
 * Called by an external cron service (Vercel Cron, InsForge schedule, etc.)
 * to run monitoring checks for all companies with monitoring enabled whose
 * last check is older than their configured interval.
 *
 * Security: Protected by CRON_SECRET header check (not user auth).
 *
 * Headers required:
 *   x-cron-secret: <CRON_SECRET env var>
 */
export async function POST(request: Request): Promise<Response> {
  // Verify cron secret
  const cronSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error("[Monitoring Cron] CRON_SECRET env var is not configured");
    return NextResponse.json(
      { error: "Cron endpoint is not configured" },
      { status: 503 },
    );
  }

  if (!cronSecret || cronSecret !== expectedSecret) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const db = inMemoryMonitoringDb;
  const insforge = getInsForgeClient();

  // Find all companies with monitoring enabled that are due for a check
  const monitoredCompanies = await db.listMonitoredCompanies();
  const now = Date.now();

  const dueCompanies = monitoredCompanies.filter((mc) => {
    if (!mc.lastCheckedAt) return true; // Never checked → due
    const lastChecked = new Date(mc.lastCheckedAt).getTime();
    const intervalMs = mc.checkIntervalHours * 60 * 60 * 1000;
    return now - lastChecked >= intervalMs;
  });

  const result: CronRunResult = {
    companiesChecked: 0,
    companiesWithChanges: 0,
    scansTriggered: 0,
    errors: [],
    results: [],
  };

  // Process each due company
  for (const mc of dueCompanies) {
    try {
      const repo = insforge.scoped(mc.workspaceId);
      const company = await repo.companies.get(mc.companyId);
      if (!company) {
        result.errors.push(
          `Company ${mc.companyId} not found in workspace ${mc.workspaceId}`,
        );
        continue;
      }

      const sources = await repo.companies.listSources(mc.companyId);
      if (sources.length === 0) continue;

      const checkResult = await checkCompanySources(
        db,
        repo,
        mc.workspaceId,
        company,
        sources,
      );

      result.companiesChecked++;
      result.results.push(checkResult);

      if (checkResult.sourcesChanged > 0) {
        result.companiesWithChanges++;
      }
      if (checkResult.scanTriggered) {
        result.scansTriggered++;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      result.errors.push(
        `Error checking company ${mc.companyId}: ${message}`,
      );
    }
  }

  return NextResponse.json(result);
}
