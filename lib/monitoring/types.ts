/**
 * Types for the Continuous Monitoring feature.
 *
 * These types describe the monitoring configuration, content hash tracking,
 * and check results used across the monitoring subsystem.
 */

/** Valid check interval options (in hours). */
export type CheckIntervalHours = 1 | 6 | 12 | 24;

/** Monitoring configuration for a company. */
export interface MonitoringConfig {
  id: string;
  workspaceId: string;
  companyId: string;
  monitoringEnabled: boolean;
  checkIntervalHours: CheckIntervalHours;
  lastAutoScanAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Insert shape for monitoring config (server-generated fields omitted). */
export type NewMonitoringConfig = Pick<
  MonitoringConfig,
  "workspaceId" | "companyId" | "monitoringEnabled" | "checkIntervalHours"
>;

/** A content hash record tracking a watched source's last-known state. */
export interface ContentHash {
  id: string;
  workspaceId: string;
  companyId: string;
  watchedSourceId: string;
  url: string;
  contentHash: string;
  lastCheckedAt: string;
  lastChangedAt: string | null;
  checkCount: number;
  createdAt: string;
}

/** Insert/update shape for content hashes. */
export type UpsertContentHash = Omit<ContentHash, "id" | "createdAt">;

/** Result of checking a single source for changes. */
export interface SourceCheckResult {
  watchedSourceId: string;
  url: string;
  changed: boolean;
  previousHash: string | null;
  currentHash: string | null;
  error?: string;
}

/** Summary result of a monitoring check for a company. */
export interface CompanyCheckResult {
  companyId: string;
  companyName: string;
  sourcesChecked: number;
  sourcesChanged: number;
  sourcesFailed: number;
  scanTriggered: boolean;
  scanId?: string;
  results: SourceCheckResult[];
}

/** Summary of a full cron run across all monitored companies. */
export interface CronRunResult {
  companiesChecked: number;
  companiesWithChanges: number;
  scansTriggered: number;
  errors: string[];
  results: CompanyCheckResult[];
}

/** Monitoring status for display in UI. */
export type MonitoringHealthStatus = "healthy" | "stale" | "changed";

/** Dashboard-friendly monitoring summary for a company. */
export interface MonitoringStatusSummary {
  companyId: string;
  companyName: string;
  monitoringEnabled: boolean;
  checkIntervalHours: CheckIntervalHours;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  healthStatus: MonitoringHealthStatus;
}
