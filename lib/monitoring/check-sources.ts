import "server-only";

/**
 * Core monitoring check logic.
 *
 * For each watched source belonging to a company, performs a lightweight fetch,
 * computes the content hash, compares against stored hashes, and triggers a
 * full scan when changes are detected.
 */

import { guardUrl, guardResolvedUrl } from "@/lib/security/ssrf";

import { computeContentHash, hasContentChanged } from "./content-hash";
import type {
  CompanyCheckResult,
  ContentHash,
  SourceCheckResult,
  UpsertContentHash,
} from "./types";
import type {
  Company,
  InsForgeClient,
  Scan,
  WatchedSource,
  WorkspaceRepository,
} from "@/lib/adapters/types";

/* -------------------------------------------------------------------------- */
/* Lightweight page fetch (no Apify — direct fetch with SSRF guards)          */
/* -------------------------------------------------------------------------- */

const USER_AGENT = "SignalVault/1.0 (competitive-intel-monitor)";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch page content for hash-checking only.
 * Returns null if the URL fails SSRF guard, DNS resolution, or fetch.
 */
export async function fetchPageContent(url: string): Promise<string | null> {
  const guard = guardUrl(url);
  if (!guard.ok) return null;

  const dnsGuard = await guardResolvedUrl(url);
  if (!dnsGuard.ok) return null;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Content hash DB operations (using InsForge raw table access)               */
/* -------------------------------------------------------------------------- */

/**
 * Narrow DB interface for content_hashes table operations.
 * We use the InsForge client's `from()` method directly since this is a new
 * table not covered by the existing repository interfaces.
 */
export interface MonitoringDb {
  getContentHash(
    workspaceId: string,
    watchedSourceId: string,
  ): Promise<ContentHash | null>;

  upsertContentHash(data: UpsertContentHash): Promise<void>;

  getMonitoringConfig(
    workspaceId: string,
    companyId: string,
  ): Promise<{
    monitoringEnabled: boolean;
    checkIntervalHours: number;
    lastAutoScanAt: string | null;
  } | null>;

  updateLastAutoScan(workspaceId: string, companyId: string): Promise<void>;

  listMonitoredCompanies(): Promise<
    Array<{
      workspaceId: string;
      companyId: string;
      checkIntervalHours: number;
      lastCheckedAt: string | null;
    }>
  >;
}

/* -------------------------------------------------------------------------- */
/* In-memory monitoring DB (for initial deployment)               */
/* -------------------------------------------------------------------------- */

const contentHashStore = new Map<string, ContentHash>();
const monitoringConfigStore = new Map<
  string,
  {
    workspaceId: string;
    companyId: string;
    monitoringEnabled: boolean;
    checkIntervalHours: number;
    lastAutoScanAt: string | null;
  }
>();

function hashKey(workspaceId: string, watchedSourceId: string): string {
  return `${workspaceId}::${watchedSourceId}`;
}

function configKey(workspaceId: string, companyId: string): string {
  return `${workspaceId}::${companyId}`;
}

export const inMemoryMonitoringDb: MonitoringDb = {
  async getContentHash(workspaceId, watchedSourceId) {
    return contentHashStore.get(hashKey(workspaceId, watchedSourceId)) ?? null;
  },

  async upsertContentHash(data) {
    const key = hashKey(data.workspaceId, data.watchedSourceId);
    const existing = contentHashStore.get(key);
    contentHashStore.set(key, {
      id: existing?.id ?? crypto.randomUUID(),
      workspaceId: data.workspaceId,
      companyId: data.companyId,
      watchedSourceId: data.watchedSourceId,
      url: data.url,
      contentHash: data.contentHash,
      lastCheckedAt: data.lastCheckedAt,
      lastChangedAt: data.lastChangedAt,
      checkCount: data.checkCount,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
  },

  async getMonitoringConfig(workspaceId, companyId) {
    const config = monitoringConfigStore.get(configKey(workspaceId, companyId));
    if (!config) return null;
    return {
      monitoringEnabled: config.monitoringEnabled,
      checkIntervalHours: config.checkIntervalHours,
      lastAutoScanAt: config.lastAutoScanAt,
    };
  },

  async updateLastAutoScan(workspaceId, companyId) {
    const key = configKey(workspaceId, companyId);
    const config = monitoringConfigStore.get(key);
    if (config) {
      config.lastAutoScanAt = new Date().toISOString();
    }
  },

  async listMonitoredCompanies() {
    const results: Array<{
      workspaceId: string;
      companyId: string;
      checkIntervalHours: number;
      lastCheckedAt: string | null;
    }> = [];

    for (const config of monitoringConfigStore.values()) {
      if (!config.monitoringEnabled) continue;

      // Find the most recent lastCheckedAt for this company's sources
      let lastCheckedAt: string | null = null;
      for (const hash of contentHashStore.values()) {
        if (
          hash.workspaceId === config.workspaceId &&
          hash.companyId === config.companyId
        ) {
          if (!lastCheckedAt || hash.lastCheckedAt > lastCheckedAt) {
            lastCheckedAt = hash.lastCheckedAt;
          }
        }
      }

      results.push({
        workspaceId: config.workspaceId,
        companyId: config.companyId,
        checkIntervalHours: config.checkIntervalHours,
        lastCheckedAt,
      });
    }

    return results;
  },
};

/** Set monitoring config (used by the config API route). */
export function setMonitoringConfig(
  workspaceId: string,
  companyId: string,
  enabled: boolean,
  intervalHours: number,
): void {
  const key = configKey(workspaceId, companyId);
  const existing = monitoringConfigStore.get(key);
  monitoringConfigStore.set(key, {
    workspaceId,
    companyId,
    monitoringEnabled: enabled,
    checkIntervalHours: intervalHours,
    lastAutoScanAt: existing?.lastAutoScanAt ?? null,
  });
}

/** Get monitoring config (used by the config API route). */
export function getMonitoringConfig(
  workspaceId: string,
  companyId: string,
): {
  monitoringEnabled: boolean;
  checkIntervalHours: number;
  lastAutoScanAt: string | null;
} | null {
  const config = monitoringConfigStore.get(configKey(workspaceId, companyId));
  if (!config) return null;
  return {
    monitoringEnabled: config.monitoringEnabled,
    checkIntervalHours: config.checkIntervalHours,
    lastAutoScanAt: config.lastAutoScanAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Core check logic                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Check a single watched source for content changes.
 */
async function checkSource(
  db: MonitoringDb,
  workspaceId: string,
  companyId: string,
  source: WatchedSource,
): Promise<SourceCheckResult> {
  try {
    const content = await fetchPageContent(source.url);
    if (content === null) {
      return {
        watchedSourceId: source.id,
        url: source.url,
        changed: false,
        previousHash: null,
        currentHash: null,
        error: "Failed to fetch page content (SSRF guard, DNS, or HTTP error)",
      };
    }

    const currentHash = computeContentHash(content);
    const existing = await db.getContentHash(workspaceId, source.id);
    const previousHash = existing?.contentHash ?? null;
    const changed = hasContentChanged(previousHash, currentHash);

    const now = new Date().toISOString();
    await db.upsertContentHash({
      workspaceId,
      companyId,
      watchedSourceId: source.id,
      url: source.url,
      contentHash: currentHash,
      lastCheckedAt: now,
      lastChangedAt: changed ? now : (existing?.lastChangedAt ?? null),
      checkCount: (existing?.checkCount ?? 0) + 1,
    });

    return {
      watchedSourceId: source.id,
      url: source.url,
      changed,
      previousHash,
      currentHash,
    };
  } catch (err) {
    return {
      watchedSourceId: source.id,
      url: source.url,
      changed: false,
      previousHash: null,
      currentHash: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Check if a scan is already running for a company (deduplication).
 */
async function isScanRunning(
  repo: WorkspaceRepository,
  companyId: string,
): Promise<boolean> {
  const scans = await repo.scans.listForCompany(companyId);
  return scans.some(
    (scan) =>
      scan.status === "queued" ||
      scan.status === "scraping" ||
      scan.status === "uploading" ||
      scan.status === "diffing" ||
      scan.status === "analyzing",
  );
}

/**
 * Check all watched sources for a company and trigger a scan if changes detected.
 */
export async function checkCompanySources(
  db: MonitoringDb,
  repo: WorkspaceRepository,
  workspaceId: string,
  company: Company,
  sources: WatchedSource[],
): Promise<CompanyCheckResult> {
  const results: SourceCheckResult[] = [];

  // Check each source independently — a failure in one shouldn't block others
  for (const source of sources) {
    const result = await checkSource(db, workspaceId, company.id, source);
    results.push(result);
  }

  const sourcesChanged = results.filter((r) => r.changed).length;
  const sourcesFailed = results.filter((r) => r.error).length;
  let scanTriggered = false;
  let scanId: string | undefined;

  // Trigger a full scan if any source has changes and no scan is already running
  if (sourcesChanged > 0) {
    const alreadyRunning = await isScanRunning(repo, company.id);
    if (!alreadyRunning) {
      try {
        const [scan] = await repo.scans.create([
          {
            companyId: company.id,
            triggerType: "monitoring_auto",
            status: "queued",
          },
        ]);
        if (scan) {
          scanTriggered = true;
          scanId = scan.id;
          await db.updateLastAutoScan(workspaceId, company.id);
        }
      } catch (err) {
        // Best effort — don't fail the whole check if scan creation fails
        console.error(
          `[Monitoring] Failed to trigger scan for company ${company.id}:`,
          err,
        );
      }
    }
  }

  return {
    companyId: company.id,
    companyName: company.name,
    sourcesChecked: results.length,
    sourcesChanged,
    sourcesFailed,
    scanTriggered,
    scanId,
    results,
  };
}
