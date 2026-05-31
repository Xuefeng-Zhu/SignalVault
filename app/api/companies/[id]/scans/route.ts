import "server-only";

import { createAdapters } from "@/lib/adapters/factory";
import { errorResponse, jsonResponse } from "@/lib/api/errors";
import { requireActiveWorkspace } from "@/lib/api/workspace";
import { withRetry, PERSISTENCE_MAX_ATTEMPTS } from "@/lib/workflow/retry";
import { runSignalVaultScanWorkflow } from "@/lib/workflow/workflow";
import type { WatchTarget } from "@/lib/workflow/context";

/**
 * `POST /api/companies/:id/scans` — create a scan and start the workflow
 * (Requirement 21.4; design "API Routes").
 *
 * ## Security / scoping (Requirements 21.7, 1.5)
 * Auth + workspace scoping is resolved before touching any tenant data.
 * A company absent from the active workspace returns 404 — no cross-tenant
 * existence is leaked.
 *
 * ## Scan creation (Requirement 6.1–6.6)
 * Creates the Scan row with status `queued` and trigger `manual`, retrying up
 * to 4 total attempts (initial + 3 retries, Requirement 6.2/6.3). On
 * exhaustion: 503 SERVICE_UNAVAILABLE.
 *
 * ## Workflow start (fire-and-forget)
 * Once the Scan row is created, the workflow is started asynchronously (not
 * awaited) so the API responds immediately with 201 + the queued scan.
 * If the async workflow later fails, it sets the scan to `failed` itself.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const companyId = params.id;
  if (!companyId) {
    return errorResponse("VALIDATION", "A company id is required.", "id");
  }

  // 1) Auth + active-workspace resolution.
  const guard = await requireActiveWorkspace();
  if (!guard.ok) {
    return guard.response;
  }

  const repo = guard.insforge.scoped(guard.workspace.id);

  // 2) Validate the company exists in the active workspace.
  let company;
  try {
    company = await repo.companies.get(companyId);
  } catch {
    return errorResponse("INTERNAL", "Failed to validate the company.");
  }
  if (!company) {
    return errorResponse("NOT_FOUND", "Company not found.");
  }

  // 3) Load the watched sources to build the capture plan.
  let sources;
  try {
    sources = await repo.companies.listSources(companyId);
  } catch {
    return errorResponse("INTERNAL", "Failed to load company sources.");
  }

  if (sources.length < 3 || sources.length > 5) {
    return errorResponse(
      "VALIDATION",
      "A company must have 3–5 watched sources to start a scan.",
    );
  }

  // 4) Create the scan record with retry (Req 6.2/6.3).
  const createScanResult = await withRetry(async () => {
    const rows = await repo.scans.create([
      {
        companyId,
        triggerType: "manual",
        status: "queued",
      },
    ]);
    if (!rows[0]) {
      throw new Error("Scan creation returned no row.");
    }
    return rows[0];
  }, PERSISTENCE_MAX_ATTEMPTS);

  if (!createScanResult.ok) {
    return errorResponse(
      "INTERNAL",
      `Failed to create the scan after ${createScanResult.attempts} attempts.`,
    );
  }

  const scan = createScanResult.value;

  // 5) Fire-and-forget: start the workflow asynchronously (Req 6.4/6.5).
  const urls: WatchTarget[] = sources.map((src) => ({
    url: src.url,
    pageRole: src.sourceType,
  }));

  const workflowInput = {
    scanId: scan.id,
    companyId,
    companyName: company.name,
    companySlug: company.domain.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase(),
    workspaceId: guard.workspace.id,
    urls,
    mode: "live" as const,
  };

  // Build adapters for the workflow. Thread the user's access token so the
  // live InsForge client runs under the correct RLS identity (Requirements
  // 1.4, 21.7). Captured here before the request context is torn down.
  const accessToken = guard.accessToken;
  void (async () => {
    try {
      const adapters = createAdapters({ accessToken });
      const result = await runSignalVaultScanWorkflow(workflowInput, adapters);
      if (!result.ok) {
        // Early-step failure (input validation, createScan, or planTargets):
        // the workflow returned ok:false without setting the scan status itself,
        // so we must mark it failed here to avoid leaving it stuck in `queued`.
        try {
          await repo.scans.updateStatus(scan.id, "failed", {
            failureReason: result.error,
          });
        } catch (secondaryErr) {
          console.error(
            `[SignalVault] Failed to mark scan ${scan.id} as failed after early workflow error:`,
            secondaryErr,
          );
        }
      }
    } catch (err) {
      // Unrecoverable workflow start error: best-effort set scan to failed.
      console.error(`[SignalVault] Scan ${scan.id} workflow threw unexpectedly:`, err);
      try {
        await repo.scans.updateStatus(scan.id, "failed", {
          failureReason: err instanceof Error ? err.message : String(err),
        });
      } catch (secondaryErr) {
        console.error(
          `[SignalVault] Failed to mark scan ${scan.id} as failed after workflow throw:`,
          secondaryErr,
        );
      }
    }
  })();

  // 6) Return 201 immediately with the queued scan.
  return jsonResponse({ scan: { id: scan.id, status: scan.status } }, 201);
}
