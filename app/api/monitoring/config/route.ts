import { NextResponse } from "next/server";

import { requireActiveWorkspace } from "@/lib/api/workspace";
import {
  setMonitoringConfig,
  getMonitoringConfig,
} from "@/lib/monitoring";
import type { CheckIntervalHours } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

const VALID_INTERVALS: CheckIntervalHours[] = [1, 6, 12, 24];

/**
 * GET /api/monitoring/config?companyId=xxx
 *
 * Get the monitoring configuration for a company.
 */
export async function GET(request: Request): Promise<Response> {
  const guard = await requireActiveWorkspace();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId query param is required" },
      { status: 400 },
    );
  }

  // Verify company exists in workspace
  const repo = guard.insforge.scoped(guard.workspace.id);
  const company = await repo.companies.get(companyId);
  if (!company) {
    return NextResponse.json(
      { error: "Company not found in active workspace" },
      { status: 404 },
    );
  }

  const config = getMonitoringConfig(guard.workspace.id, companyId);

  return NextResponse.json({
    companyId,
    monitoringEnabled: config?.monitoringEnabled ?? false,
    checkIntervalHours: config?.checkIntervalHours ?? 6,
    lastAutoScanAt: config?.lastAutoScanAt ?? null,
  });
}

/**
 * PUT /api/monitoring/config
 *
 * Update monitoring configuration for a company.
 *
 * Body: { companyId: string, monitoringEnabled: boolean, checkIntervalHours: 1|6|12|24 }
 */
export async function PUT(request: Request): Promise<Response> {
  const guard = await requireActiveWorkspace();
  if (!guard.ok) return guard.response;

  let body: {
    companyId?: string;
    monitoringEnabled?: boolean;
    checkIntervalHours?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { companyId, monitoringEnabled, checkIntervalHours } = body;

  if (!companyId || typeof companyId !== "string") {
    return NextResponse.json(
      { error: "companyId is required" },
      { status: 400 },
    );
  }

  if (typeof monitoringEnabled !== "boolean") {
    return NextResponse.json(
      { error: "monitoringEnabled must be a boolean" },
      { status: 400 },
    );
  }

  if (
    checkIntervalHours !== undefined &&
    !VALID_INTERVALS.includes(checkIntervalHours as CheckIntervalHours)
  ) {
    return NextResponse.json(
      { error: `checkIntervalHours must be one of: ${VALID_INTERVALS.join(", ")}` },
      { status: 400 },
    );
  }

  // Verify company exists in workspace
  const repo = guard.insforge.scoped(guard.workspace.id);
  const company = await repo.companies.get(companyId);
  if (!company) {
    return NextResponse.json(
      { error: "Company not found in active workspace" },
      { status: 404 },
    );
  }

  const interval = (checkIntervalHours ?? 6) as CheckIntervalHours;
  setMonitoringConfig(guard.workspace.id, companyId, monitoringEnabled, interval);

  return NextResponse.json({
    companyId,
    monitoringEnabled,
    checkIntervalHours: interval,
    message: monitoringEnabled
      ? `Monitoring enabled — checking every ${interval}h`
      : "Monitoring disabled",
  });
}
