import type { CaptureRequest, CaptureResult, NewSnapshot } from "@/lib/adapters/types";

import {
  addSkipped,
  addWarning,
  errorMessage,
  scopedRepo,
  setScanStatus,
  type ScanWorkflowContext,
} from "../context";

import {
  CapturePlanSchema,
  CapturedSnapshotsSchema,
  parseAtBoundary,
  type CapturedSnapshot,
  type CapturePlan,
} from "./artifacts";

/**
 * Step 3 — `runApifyCaptureStep` (status `scraping`).
 *
 * Captures raw HTML + a screenshot reference for each planned (validated)
 * source via the injected `ApifyClient`, then creates one Snapshot record per
 * successful capture associated with the current scan (Requirements 8.1, 8.5).
 *
 * ## Shared context + injected adapters
 *
 * The step receives everything through {@link ScanWorkflowContext}: the Apify
 * and InsForge adapters are taken from `ctx.adapters` (never constructed here —
 * Requirement 23.1), and the workspace-scoped repository comes from
 * `scopedRepo(ctx)`. It pushes onto the shared `warnings`/`skipped`
 * accumulators rather than returning them, so the workflow can aggregate the
 * final `{ data, warnings[], skipped[] }` (task 18.7).
 *
 * ## Degrade, never crash (Requirements 8.3, 8.4, 8.6, 8.7)
 *
 * - `ApifyClient.capture` returns one {@link CaptureResult} per request and
 *   never throws on a per-source skip; a skipped/failed source (`ok = false`)
 *   is recorded in `ctx.skipped` with its reason and does NOT create a snapshot.
 * - When the adapter substitutes simulated data (`simulated = true`) — because Apify
 *   credentials are missing or the live call failed — a single "results are
 *   simulated" warning is surfaced (Requirement 8.6). The simulated flag is
 *   persisted on each Snapshot.
 * - Should the adapter itself throw unexpectedly, the whole batch is recorded
 *   as skipped and the step returns an empty capture set rather than failing
 *   the scan.
 *
 * The step core takes the context explicitly and uses only injected adapters,
 * so it carries no `server-only` import and is directly testable with fakes.
 */
export async function runApifyCaptureStep(
  ctx: ScanWorkflowContext,
  plan: CapturePlan,
): Promise<CapturedSnapshot[]> {
  // Validate the inbound capture plan at the step boundary (Requirements 23.5, 23.6).
  const validatedPlan = parseAtBoundary(
    CapturePlanSchema,
    plan,
    "runApifyCaptureStep input",
  );

  // Persist the `scraping` status before any progress is emitted (Requirement 7.2).
  await setScanStatus(ctx, "scraping");

  if (validatedPlan.length === 0) {
    return parseAtBoundary(CapturedSnapshotsSchema, [], "runApifyCaptureStep output");
  }

  // Map each request back to the source it targets so a created snapshot can be
  // associated with the correct Watched_Source (Requirement 8.5). Requests are
  // keyed by url+pageRole, which is unique within a single company's plan.
  const sourceByKey = new Map<string, string>();
  for (const planned of validatedPlan) {
    sourceByKey.set(requestKey(planned.request), planned.watchedSourceId);
  }

  const requests: CaptureRequest[] = validatedPlan.map((planned) => planned.request);

  // The adapter is contracted never to throw on per-source skips, but we still
  // guard the whole call so an unexpected adapter error degrades to "all
  // skipped" instead of crashing the scan (Requirement 8.7 / degrade-never-crash).
  let results: CaptureResult[];
  try {
    results = await ctx.adapters.apify.capture(requests);
  } catch (error) {
    const reason = `Apify capture failed: ${errorMessage(error)}`;
    for (const planned of validatedPlan) {
      addSkipped(ctx, {
        url: planned.request.url,
        pageRole: planned.request.pageRole,
        reason,
      });
    }
    addWarning(ctx, reason);
    return parseAtBoundary(CapturedSnapshotsSchema, [], "runApifyCaptureStep output");
  }

  const repo = scopedRepo(ctx);
  const captured: CapturedSnapshot[] = [];
  let anySimulated = false;

  for (const result of results) {
    const watchedSourceId = sourceByKey.get(requestKey(result));

    // A successful capture must carry raw HTML; without it there is nothing to
    // normalize/store, so treat it as a skip (Requirement 8.7).
    if (!result.ok || result.rawHtml === undefined) {
      addSkipped(ctx, {
        url: result.url,
        pageRole: result.pageRole,
        reason: result.skippedReason ?? "capture returned no raw HTML",
      });
      continue;
    }

    if (watchedSourceId === undefined) {
      // Defensive: a result we cannot map to a planned source is skipped rather
      // than attached to an arbitrary snapshot.
      addSkipped(ctx, {
        url: result.url,
        pageRole: result.pageRole,
        reason: "captured source was not part of the capture plan",
      });
      continue;
    }

    if (result.simulated) {
      anySimulated = true;
    }

    // Create the Snapshot record for this successfully scraped source
    // (Requirement 8.5). Raw/normalized/screenshot artifact refs are filled in
    // by the later normalize + upload steps; here we record the source linkage
    // and the simulated flag.
    const newSnapshot: NewSnapshot = {
      scanId: ctx.scanId,
      watchedSourceId,
      simulated: result.simulated,
    };

    try {
      const [snapshot] = await repo.snapshots.create([newSnapshot]);
      if (!snapshot) {
        throw new Error("snapshot create returned no row");
      }
      captured.push({
        snapshotId: snapshot.id,
        watchedSourceId,
        url: result.url,
        pageRole: result.pageRole,
        rawHtml: result.rawHtml,
        ...(result.screenshotRef !== undefined
          ? { screenshotRef: result.screenshotRef }
          : {}),
        simulated: result.simulated,
      });
    } catch (error) {
      // Failing to persist a single snapshot must not crash the scan; record
      // the source as skipped and continue (degrade-never-crash).
      addSkipped(ctx, {
        url: result.url,
        pageRole: result.pageRole,
        reason: `failed to create snapshot record: ${errorMessage(error)}`,
      });
    }
  }

  if (anySimulated) {
    // Requirement 8.6: a single warning that scraped results are simulated.
    addWarning(ctx, "Scraped results are simulated.");
  }

  return parseAtBoundary(
    CapturedSnapshotsSchema,
    captured,
    "runApifyCaptureStep output",
  );
}

/** Stable key identifying a capture request/result by url + page role. */
function requestKey(r: { url: string; pageRole: string }): string {
  return `${r.pageRole}\u0000${r.url}`;
}
