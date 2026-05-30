"use client";

import * as React from "react";

import type { ScanStatus } from "@/components/company-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Human-readable label for every Scan status (Requirement 7.1). This is the
 * single source of truth for the status → label mapping and is exported so the
 * component test (task 22.6) can assert the mapping without re-deriving it.
 */
export const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "Queued",
  scraping: "Scraping",
  uploading: "Uploading to Box",
  diffing: "Diffing",
  analyzing: "Analyzing",
  completed: "Complete",
  failed: "Failed",
};

/**
 * The ordered, in-progress Scan lifecycle (Requirement 7.1). `failed` is a
 * terminal status that sits OUTSIDE this progression and is rendered as a
 * separate terminal marker. Exported so the test can assert lifecycle ordering.
 */
export const SCAN_TIMELINE_ORDER: readonly ScanStatus[] = [
  "queued",
  "scraping",
  "uploading",
  "diffing",
  "analyzing",
  "completed",
] as const;

/** The two terminal statuses that stop realtime + polling. */
const TERMINAL_STATUSES: ReadonlySet<ScanStatus> = new Set<ScanStatus>([
  "completed",
  "failed",
]);

/** The set of all valid statuses, for narrowing untrusted realtime/poll input. */
const VALID_STATUSES: ReadonlySet<string> = new Set<string>(
  Object.keys(SCAN_STATUS_LABELS),
);

/** Per-step render state used for styling + data attributes. */
type StepState = "done" | "current" | "upcoming";

/**
 * Polling interval for the fallback (Requirement 7.4: not exceeding 5s). Kept
 * comfortably under the 5s ceiling so progress keeps moving without a reload.
 */
const DEFAULT_POLL_INTERVAL_MS = 4000;

/**
 * How long to wait for a realtime event after a successful subscribe before
 * ALSO starting the polling fallback. If realtime is healthy this just adds a
 * silent backstop; if the channel is silent/broken it guarantees progress
 * continues (Requirement 7.4). Kept under the poll interval ceiling.
 */
const DEFAULT_REALTIME_GRACE_MS = 4000;

/** True when `value` is one of the seven known Scan statuses. */
export function isScanStatus(value: unknown): value is ScanStatus {
  return typeof value === "string" && VALID_STATUSES.has(value);
}

/**
 * Compute a progression step's render state relative to the current status
 * (Requirement 7.1: highlight the current status, mark prior steps done).
 *
 * `failed` is terminal and not part of the progression, so when the scan has
 * failed none of the progression steps are "current"; the failure is shown by a
 * separate terminal marker.
 */
export function scanStepState(
  current: ScanStatus,
  step: ScanStatus,
): StepState {
  if (current === "failed") {
    return "upcoming";
  }
  const currentIndex = SCAN_TIMELINE_ORDER.indexOf(current);
  const stepIndex = SCAN_TIMELINE_ORDER.indexOf(step);
  if (stepIndex < currentIndex) {
    return "done";
  }
  if (stepIndex === currentIndex) {
    return "current";
  }
  return "upcoming";
}

/* -------------------------------------------------------------------------- */
/* Realtime client shape (the slice of @insforge/sdk realtime we depend on)   */
/* -------------------------------------------------------------------------- */

/** Result of `realtime.subscribe()` (per the @insforge/sdk realtime docs). */
interface RealtimeSubscribeResult {
  ok: boolean;
  error?: { code?: string; message?: string };
}

/**
 * The minimal realtime surface this component uses, mirroring the
 * `insforge.realtime` API: `connect()`, `subscribe()`, `on()/off()` listeners,
 * `unsubscribe()`, and `disconnect()`. Typing only this slice keeps the
 * component testable (a fake can be injected via {@link createRealtimeClient}).
 */
interface RealtimeLike {
  connect(): Promise<void>;
  subscribe(channel: string): Promise<RealtimeSubscribeResult>;
  on(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener: (payload: unknown) => void): void;
  unsubscribe(channel: string): void;
  disconnect(): void;
}

/** A client exposing a `realtime` namespace, as returned by `createClient`. */
export interface RealtimeClientLike {
  realtime: RealtimeLike;
}

/** Configuration for connecting the default `@insforge/sdk` realtime client. */
export interface RealtimeConnectionConfig {
  baseUrl: string;
  anonKey: string;
}

/**
 * Default realtime client factory: builds an `@insforge/sdk` browser client
 * bound to the public InsForge base URL + anon key. The anon key is a public
 * key safe for the browser; it never carries the admin/service credential.
 *
 * Returns `null` when no public config is available, in which case the
 * component skips realtime entirely and relies on polling (Requirement 7.4).
 */
async function defaultCreateRealtimeClient(
  config: RealtimeConnectionConfig,
): Promise<RealtimeClientLike> {
  // Imported lazily so the SDK (and its socket.io client) is only pulled in
  // when realtime is actually attempted, and never during SSR.
  const { createClient } = await import("@insforge/sdk");
  return createClient({
    baseUrl: config.baseUrl,
    anonKey: config.anonKey,
  }) as unknown as RealtimeClientLike;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface ScanProgressTimelineProps {
  /** The Scan whose lifecycle is rendered + tracked. */
  scanId: string;
  /** Status to render before the first realtime/poll update arrives. */
  initialStatus: ScanStatus;
  /**
   * Notified whenever the tracked status changes (never for the initial
   * value). The Scan detail page (task 23.6) uses this to refresh results when
   * the scan reaches `completed` within 2s (Requirement 7.5).
   */
  onStatusChange?: (status: ScanStatus) => void;
  /**
   * Public InsForge base URL for the realtime client. Defaults to
   * `NEXT_PUBLIC_INSFORGE_API_URL`. When neither is set, realtime is skipped
   * and the timeline updates via polling only (Requirement 7.4).
   */
  realtimeUrl?: string;
  /** Public InsForge anon key for the realtime client. Defaults to
   * `NEXT_PUBLIC_INSFORGE_ANON_KEY`. */
  realtimeAnonKey?: string;
  /** Polling interval in ms for the fallback. Must be ≤ 5000 (Requirement 7.4). */
  pollIntervalMs?: number;
  /** Grace window (ms) to wait for a realtime event before also polling. */
  realtimeGraceMs?: number;
  /**
   * Injectable realtime client factory (for tests). Returning `null` (or a
   * factory that throws) makes the component fall back to polling — exactly the
   * degrade-never-crash behavior required by 7.4.
   */
  createRealtimeClient?: (
    config: RealtimeConnectionConfig,
  ) => Promise<RealtimeClientLike | null> | RealtimeClientLike | null;
  className?: string;
}

/**
 * `ScanProgressTimeline` renders the ordered Scan lifecycle with the current
 * status highlighted and prior steps marked done (Requirement 7.1), and keeps
 * it live while the scan runs:
 *
 *  - **Realtime (7.3):** subscribes to the InsForge realtime channel
 *    `scan:{scanId}` via `@insforge/sdk` (`realtime.connect()` →
 *    `realtime.subscribe(channel)` → `realtime.on('status_changed', …)`) and
 *    applies status changes as they arrive (target < 2s).
 *  - **Polling fallback (7.4):** if connecting/subscribing fails, or no event
 *    arrives within a short grace window, it transparently starts polling
 *    `GET /api/scans/:id` at an interval ≤ 5s and applies `{ scan: { status } }`
 *    — no manual page reload required.
 *  - **Completion (7.5):** on reaching `completed`/`failed` it stops realtime
 *    and polling and signals the change via {@link ScanProgressTimelineProps.onStatusChange}
 *    so the parent can render results.
 *
 * All realtime/polling errors degrade silently to polling and never throw to
 * the user.
 */
export function ScanProgressTimeline({
  scanId,
  initialStatus,
  onStatusChange,
  realtimeUrl,
  realtimeAnonKey,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  realtimeGraceMs = DEFAULT_REALTIME_GRACE_MS,
  createRealtimeClient = defaultCreateRealtimeClient,
  className,
}: ScanProgressTimelineProps) {
  const [status, setStatus] = React.useState<ScanStatus>(initialStatus);

  // Latest tracked status, readable synchronously inside timers/listeners.
  const statusRef = React.useRef<ScanStatus>(initialStatus);
  // Stable ref to the latest callback so effect deps stay minimal.
  const onStatusChangeRef = React.useRef(onStatusChange);
  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  React.useEffect(() => {
    statusRef.current = initialStatus;
    setStatus(initialStatus);
  }, [initialStatus]);

  React.useEffect(() => {
    // If the scan is already terminal there is nothing to track.
    if (TERMINAL_STATUSES.has(statusRef.current)) {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let realtimeClient: RealtimeClientLike | null = null;
    const channel = `scan:${scanId}`;

    /** Apply a (possibly untrusted) next status, stopping on terminal. */
    function applyStatus(next: unknown): void {
      if (cancelled || !isScanStatus(next)) {
        return;
      }
      if (next === statusRef.current) {
        return;
      }
      statusRef.current = next;
      setStatus(next);
      onStatusChangeRef.current?.(next);
      if (TERMINAL_STATUSES.has(next)) {
        teardown();
      }
    }

    /** Idempotently start the polling fallback (Requirement 7.4). */
    function startPolling(): void {
      if (cancelled || pollTimer !== null) {
        return;
      }
      const tick = async (): Promise<void> => {
        try {
          const res = await fetch(`/api/scans/${scanId}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (!res.ok) {
            return; // transient; keep polling
          }
          const body: unknown = await res.json().catch(() => null);
          const nextStatus =
            body != null &&
            typeof body === "object" &&
            "scan" in body &&
            (body as { scan?: unknown }).scan != null &&
            typeof (body as { scan?: unknown }).scan === "object"
              ? (body as { scan: { status?: unknown } }).scan.status
              : undefined;
          applyStatus(nextStatus);
        } catch {
          // Network hiccup — swallow and keep polling (never throw to the user).
        }
      };
      // Bound to ≤ 5s by the prop contract; clamp defensively.
      const interval = Math.min(Math.max(pollIntervalMs, 250), 5000);
      pollTimer = setInterval(() => {
        void tick();
      }, interval);
      // Kick off an immediate read so we don't wait a full interval.
      void tick();
    }

    /** Stop realtime + polling and release listeners. Safe to call repeatedly. */
    function teardown(): void {
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (realtimeClient) {
        try {
          realtimeClient.realtime.off("status_changed", handleStatusEvent);
          realtimeClient.realtime.off("error", handleRealtimeError);
          realtimeClient.realtime.off("connect_error", handleRealtimeError);
          realtimeClient.realtime.unsubscribe(channel);
          realtimeClient.realtime.disconnect();
        } catch {
          // Best-effort cleanup; ignore SDK teardown errors.
        }
        realtimeClient = null;
      }
    }

    /** Realtime `status_changed` payload carries the new `status` field. */
    function handleStatusEvent(payload: unknown): void {
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      const next =
        payload != null && typeof payload === "object"
          ? (payload as { status?: unknown }).status
          : undefined;
      applyStatus(next);
    }

    /** Any realtime error transparently degrades to polling (Requirement 7.4). */
    function handleRealtimeError(): void {
      startPolling();
    }

    async function connectRealtime(): Promise<void> {
      const baseUrl =
        realtimeUrl ?? process.env.NEXT_PUBLIC_INSFORGE_API_URL ?? "";
      const anonKey =
        realtimeAnonKey ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? "";

      // No public realtime config → realtime unavailable → poll (7.4).
      if (!baseUrl || !anonKey) {
        startPolling();
        return;
      }

      try {
        const client = await createRealtimeClient({ baseUrl, anonKey });
        if (cancelled || !client) {
          if (!client) startPolling();
          return;
        }
        realtimeClient = client;
        client.realtime.on("status_changed", handleStatusEvent);
        client.realtime.on("error", handleRealtimeError);
        client.realtime.on("connect_error", handleRealtimeError);

        await client.realtime.connect();
        if (cancelled) {
          return;
        }
        const sub = await client.realtime.subscribe(channel);
        if (cancelled) {
          return;
        }
        if (!sub.ok) {
          // Subscribe denied/failed → fall back to polling (7.4).
          startPolling();
          return;
        }
        // Subscribed: arm a grace timer so a silent/broken channel still makes
        // progress. Polling and realtime can safely coexist (both idempotently
        // apply the latest status).
        graceTimer = setTimeout(() => {
          startPolling();
        }, realtimeGraceMs);
      } catch {
        // connect()/subscribe()/factory threw → degrade to polling (7.4).
        if (!cancelled) {
          startPolling();
        }
      }
    }

    void connectRealtime();

    return () => {
      cancelled = true;
      teardown();
    };
    // Re-establish tracking if the scan being tracked changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, pollIntervalMs, realtimeGraceMs, realtimeUrl, realtimeAnonKey]);

  const hasFailed = status === "failed";

  return (
    <ol
      className={cn("flex flex-col gap-3", className)}
      data-scan-status={status}
      aria-label="Scan progress"
    >
      {SCAN_TIMELINE_ORDER.map((step) => {
        const state = scanStepState(status, step);
        return (
          <li
            key={step}
            data-status={step}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-3"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                state === "done" &&
                  "border-primary bg-primary text-primary-foreground",
                state === "current" &&
                  "border-primary text-primary ring-2 ring-primary/40",
                state === "upcoming" &&
                  "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {state === "done" ? "✓" : SCAN_TIMELINE_ORDER.indexOf(step) + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                state === "current" && "font-semibold text-foreground",
                state === "done" && "text-foreground",
                state === "upcoming" && "text-muted-foreground",
              )}
            >
              {SCAN_STATUS_LABELS[step]}
            </span>
          </li>
        );
      })}

      {hasFailed && (
        <li
          data-status="failed"
          data-state="current"
          aria-current="step"
          className="flex items-center gap-3"
        >
          <Badge variant="destructive">{SCAN_STATUS_LABELS.failed}</Badge>
        </li>
      )}
    </ol>
  );
}
