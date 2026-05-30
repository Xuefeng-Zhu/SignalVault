import { z } from "zod";

import { ScanWorkflowInput, SourceTypeEnum } from "@/lib/schemas";
import type { SourceType } from "@/lib/schemas";
// `import type` keeps this module free of the `server-only` runtime guard that
// the concrete adapter factory (`@/lib/adapters/factory`) and adapter types
// (`@/lib/adapters/types`) pull in. The `AdapterSet` shape lives in
// `factory-core` (which is itself type-only w.r.t. `server-only`) and the
// adapter interface shapes are erased at compile time, so importing them here
// costs nothing at runtime. This is what keeps the workflow step cores
// importable from unit/property tests without dragging server-only code into
// the test (and browser) bundle. Real adapters are INJECTED into the context by
// the server-only assembly (task 18.8) and the API route (20.6).
import type { AdapterSet } from "@/lib/adapters/factory-core";
import type {
  BoxFolderSet,
  CaptureRequest,
  ScanStatus,
  Snapshot,
  WorkspaceRepository,
} from "@/lib/adapters/types";

/**
 * Shared workflow context, state, and boundary schemas for the Mastra
 * `signalVaultScanWorkflow`.
 *
 * This module is the single source of truth for the value that threads through
 * every workflow step (tasks 18.1, 18.2, 18.4, 18.6, 18.7) and the assembly
 * (18.8). Because the step cores landed in parallel against slightly different
 * drafts of this module, it deliberately exposes BOTH:
 *
 *  - the serializable {@link WorkflowContext} / {@link ThreadedContext}
 *    projection + immutable helpers used by the create-scan / plan-targets
 *    steps, and
 *  - the mutable {@link ScanWorkflowContext} runtime context + helper API
 *    (`createScanWorkflowContext`, `scopedRepo`, `setScanStatus`, `addWarning`,
 *    `addSkipped`, `errorMessage`) used by the capture → normalize → upload
 *    steps and the diffing steps.
 *
 * The two context shapes carry the same identity + diagnostics and never
 * collide by name, so the assembly (18.8) can settle on one without touching
 * the step cores. In both shapes the {@link AdapterSet} is INJECTED (never
 * constructed here), keeping the cores testable and `server-only`-free
 * (Requirement 23.1).
 */

/* ========================================================================== */
/* Serializable projection (create-scan / plan-targets steps)                */
/* ========================================================================== */

/**
 * A Watched_Source that was skipped during the scan, with the reason it was
 * skipped (e.g. an SSRF rejection in `planWatchTargetsStep`). Surfaced on the
 * scan detail page so a partial scan is transparent (Requirements 8.3, 8.4).
 */
export const SkippedSourceSchema = z.object({
  url: z.string(),
  reason: z.string().min(1),
});
export type SkippedSource = z.infer<typeof SkippedSourceSchema>;

/**
 * The immutable identity of the scan being executed plus the resolved run
 * `mode`. Mirrors the identity fields of {@link ScanWorkflowInput} and adds the
 * `scanId` of the record the API route created (Requirement 6.1).
 */
export const ScanContextSchema = z.object({
  scanId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  companyId: z.string().uuid(),
  companyName: z.string().min(1).max(200),
  companySlug: z.string().min(1),
  mode: z.enum(["demo", "live"]),
});
export type ScanContext = z.infer<typeof ScanContextSchema>;

/**
 * The serializable projection of {@link WorkflowContext}: the scan identity
 * plus the accumulating diagnostics. Validated at each Mastra step boundary
 * (Requirements 23.5, 23.6). It is exactly {@link WorkflowContext} without its
 * (non-serializable) `adapters`.
 */
export const ThreadedContextSchema = ScanContextSchema.extend({
  warnings: z.array(z.string()),
  skipped: z.array(SkippedSourceSchema),
});
export type ThreadedContext = z.infer<typeof ThreadedContextSchema>;

/**
 * The runtime context threaded through the early workflow steps. It is the
 * {@link ThreadedContext} (identity + diagnostics) plus the injected
 * {@link AdapterSet}.
 */
export interface WorkflowContext extends ThreadedContext {
  /** The four external adapters for this scan — the sole door to the outside. */
  adapters: AdapterSet;
}

/**
 * Dependencies a step core needs beyond its typed input: the adapter set.
 * Step cores written in the serializable style take `(input, deps)`.
 */
export interface StepDeps {
  adapters: AdapterSet;
}

/** A single URL + page role to scrape (one element of the workflow input). */
export const WatchTargetSchema = z.object({
  url: z.string().url(),
  pageRole: SourceTypeEnum,
});
export type WatchTarget = z.infer<typeof WatchTargetSchema>;

/** Maximum capture timeout for a single source (Requirement 8.1: within 60s). */
export const CAPTURE_TIMEOUT_MS = 60_000;

/**
 * A validated capture request for one admissible source. Structurally
 * compatible with the adapter's {@link CaptureRequest} interface; the
 * `_typecheck` assignment below fails the build if the two ever drift.
 */
export const CaptureRequestSchema = z.object({
  url: z.string().url(),
  pageRole: SourceTypeEnum,
  timeoutMs: z.number().int().positive().max(CAPTURE_TIMEOUT_MS),
});
export type CaptureRequestPlan = z.infer<typeof CaptureRequestSchema>;

// Compile-time guarantee that the Zod-inferred plan entry satisfies the adapter
// interface the Apify capture step consumes.
const _captureRequestTypecheck: CaptureRequest = {} as CaptureRequestPlan;
void _captureRequestTypecheck;

/**
 * Output of `createScanStep` and input of `planWatchTargetsStep`: the threaded
 * context plus the 3–5 watch targets carried forward from the workflow input.
 */
export const BaselineStateSchema = ThreadedContextSchema.extend({
  urls: z.array(WatchTargetSchema).min(3).max(5),
});
export type BaselineState = z.infer<typeof BaselineStateSchema>;

/**
 * Output of `planWatchTargetsStep`: the threaded context (now carrying any
 * SSRF skips + warnings) plus the capture plan for the admissible sources.
 */
export const CapturePlanStateSchema = ThreadedContextSchema.extend({
  capturePlan: z.array(CaptureRequestSchema),
});
export type CapturePlanState = z.infer<typeof CapturePlanStateSchema>;

/** Lifecycle status of a scan (re-exported for step `STATUS` typing). */
export type { ScanStatus };

/** Project the scan identity out of the workflow init data + created scanId. */
export function scanContextOf(input: ScanContext): ScanContext {
  return {
    scanId: input.scanId,
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    companyName: input.companyName,
    companySlug: input.companySlug,
    mode: input.mode,
  };
}

/**
 * Build the initial {@link WorkflowContext}: identity, injected adapters, and
 * empty diagnostics. Called by `createScanStep` at the start of the workflow.
 */
export function initWorkflowContext(
  scan: ScanContext,
  adapters: AdapterSet,
): WorkflowContext {
  return { ...scan, warnings: [], skipped: [], adapters };
}

/** Drop the non-serializable `adapters` to get the serializable projection. */
export function toThreadedContext(context: WorkflowContext): ThreadedContext {
  const { adapters: _adapters, ...threaded } = context;
  return threaded;
}

/** Re-attach injected adapters to a serialized {@link ThreadedContext}. */
export function withAdapters(
  threaded: ThreadedContext,
  adapters: AdapterSet,
): WorkflowContext {
  return { ...threaded, adapters };
}

/** Append a warning to the context immutably, returning a new context. */
export function appendWarning(
  context: WorkflowContext,
  warning: string,
): WorkflowContext {
  return { ...context, warnings: [...context.warnings, warning] };
}

/** Record a skipped source immutably (adds a structured skip + a warning). */
export function appendSkip(
  context: WorkflowContext,
  skip: SkippedSource,
): WorkflowContext {
  return {
    ...context,
    skipped: [...context.skipped, skip],
    warnings: [...context.warnings, `Skipped ${skip.url}: ${skip.reason}`],
  };
}

/** The canonical workflow init schema: {@link ScanWorkflowInput} + `scanId`. */
export const ScanInitInputSchema = ScanWorkflowInput.extend({
  scanId: z.string().uuid(),
});
export type ScanInitInput = z.infer<typeof ScanInitInputSchema>;

/* ========================================================================== */
/* Mutable runtime context (capture → normalize → upload → diff steps)        */
/* ========================================================================== */

/**
 * A Watched_Source skipped by a step, carrying its page role so the scan detail
 * page can identify it (Requirement 8.4). The mutable steps push these onto
 * {@link ScanWorkflowContext.skipped} via {@link addSkipped}.
 */
export interface WorkflowSkip {
  url: string;
  pageRole: SourceType;
  reason: string;
}

/**
 * A current-scan snapshot paired with its normalized content.
 *
 * The normalize step (task 18.2) carries these so later steps (diffing, claim
 * extraction) can reason over the normalized text without re-downloading it.
 * `normalizedContent` is the exact string the normalize step produced
 * (Requirement 9.1).
 */
export interface CurrentSnapshot {
  /** Id of the persisted Snapshot row created during this scan. */
  snapshotId: string;
  /** The Watched_Source this snapshot was captured for. */
  watchedSourceId: string;
  /** Normalized markdown/text content for the snapshot. */
  normalizedContent: string;
}

/**
 * Resolves the normalized content for a (typically prior-scan) snapshot.
 *
 * Diffing the current snapshot against the prior one requires the prior
 * snapshot's normalized text, which lives in the Box `normalized/` subfolder
 * (Requirement 9.3) rather than on the snapshot row. This injected loader is how
 * `computeDiffStep` obtains it: the live wiring downloads the normalized
 * artifact, while the demo/integration wiring serves it from the seed. Returning
 * `null` signals the content is unavailable, which the diff step treats as a
 * recoverable per-source diff failure (Requirement 11.6).
 */
export type NormalizedContentLoader = (
  snapshot: Snapshot,
) => Promise<string | null>;

/**
 * Mutable state threaded through the capture → normalize → upload → diff steps.
 *
 * Carries the scan's identity, the resolved run `mode`, the injected
 * {@link AdapterSet} (the sole door to external services — Requirement 23.1),
 * the evidence collected so far (Box folders, current snapshots), an optional
 * prior-content loader, and the accumulating `warnings`/`skipped`. Steps read
 * what they need, persist through the workspace-scoped repository
 * ({@link scopedRepo}), and push onto the accumulators via
 * {@link addWarning}/{@link addSkipped}; they never construct adapters
 * themselves.
 */
export interface ScanWorkflowContext {
  /* Identity */
  scanId: string;
  workspaceId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  /** Value that uniquely identifies the scan in the Box folder path (Req 10.1). */
  scanTimestamp: string;
  /** The current scan's `createdAt` — the cutoff for "earlier" prior scans (Req 11.1). */
  scanCreatedAt: string;
  /** Overall resolved run mode for the scan (per-adapter modes live on adapters). */
  mode: "demo" | "live";

  /* Adapters (sole door to external services — Requirement 23.1) */
  adapters: AdapterSet;

  /* Evidence collected so far */
  boxFolders?: BoxFolderSet;
  /** Current-scan snapshots + their normalized content (set by the normalize step). */
  currentSnapshots: CurrentSnapshot[];
  /** Optional prior-snapshot normalized-content loader (see the type doc). */
  loadNormalizedContent?: NormalizedContentLoader;

  /* Accumulated step results (design "Result Aggregation") */
  warnings: string[];
  skipped: WorkflowSkip[];
}

/** Parameters for {@link createScanWorkflowContext}. */
export interface CreateScanWorkflowContextParams {
  scanId: string;
  workspaceId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  scanTimestamp: string;
  mode: "demo" | "live";
  adapters: AdapterSet;
  /** Defaults to `scanTimestamp` when omitted. */
  scanCreatedAt?: string;
  /** Pre-seeded current snapshots (defaults to empty). */
  currentSnapshots?: CurrentSnapshot[];
  /** Optional Box folder set (set by the upload step). */
  boxFolders?: BoxFolderSet;
  /** Optional prior-content loader (set by the assembly for the diff step). */
  loadNormalizedContent?: NormalizedContentLoader;
}

/**
 * Build the initial {@link ScanWorkflowContext}: identity + injected adapters +
 * empty diagnostics/evidence. `scanCreatedAt` defaults to `scanTimestamp` when
 * the caller does not supply the scan record's real `createdAt`.
 */
export function createScanWorkflowContext(
  params: CreateScanWorkflowContextParams,
): ScanWorkflowContext {
  return {
    scanId: params.scanId,
    workspaceId: params.workspaceId,
    companyId: params.companyId,
    companyName: params.companyName,
    companySlug: params.companySlug,
    scanTimestamp: params.scanTimestamp,
    scanCreatedAt: params.scanCreatedAt ?? params.scanTimestamp,
    mode: params.mode,
    adapters: params.adapters,
    ...(params.boxFolders !== undefined ? { boxFolders: params.boxFolders } : {}),
    currentSnapshots: params.currentSnapshots ?? [],
    ...(params.loadNormalizedContent !== undefined
      ? { loadNormalizedContent: params.loadNormalizedContent }
      : {}),
    warnings: [],
    skipped: [],
  };
}

/** Append a human-readable warning to the shared accumulator (in place). */
export function addWarning(ctx: ScanWorkflowContext, message: string): void {
  ctx.warnings.push(message);
}

/** Append a skipped-source record to the shared accumulator (in place). */
export function addSkipped(ctx: ScanWorkflowContext, skip: WorkflowSkip): void {
  ctx.skipped.push(skip);
}

/**
 * The workspace-scoped {@link WorkspaceRepository} for the scan. Every query is
 * constrained to `ctx.workspaceId`, so steps cannot accidentally read or write
 * another tenant's rows (Requirements 1.4, 21.7). Obtained through the InsForge
 * adapter — never by constructing a client directly (Requirement 23.1).
 */
export function scopedRepo(ctx: ScanWorkflowContext): WorkspaceRepository {
  return ctx.adapters.insforge.scoped(ctx.workspaceId);
}

/**
 * Persist the scan's lifecycle status (Requirement 7.2: status is persisted
 * BEFORE any progress is emitted; the DB-side realtime trigger publishes the
 * change once it is written). Routed through the workspace-scoped repository.
 */
export async function setScanStatus(
  ctx: ScanWorkflowContext,
  status: ScanStatus,
  patch?: { failureReason?: string | null; boxScanFolderId?: string | null },
): Promise<void> {
  await scopedRepo(ctx).scans.updateStatus(ctx.scanId, status, patch);
}

/** Extract a human-readable cause string from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
