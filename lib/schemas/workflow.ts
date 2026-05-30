import { z } from 'zod';

import { SourceTypeEnum } from './enums';

/**
 * Typed input/output for the Mastra `signalVaultScanWorkflow`. These schemas
 * are the single source of truth for the workflow boundary and are validated
 * before the workflow runs and before its result is returned.
 *
 * Requirements: 23.2, 23.3
 */

/** Workflow input — validated at scan start (Requirement 23.2). */
export const ScanWorkflowInput = z.object({
  companyId: z.string().uuid(),
  companyName: z.string().min(1).max(200),
  companySlug: z.string().min(1),
  workspaceId: z.string().uuid(),
  urls: z
    .array(
      z.object({
        url: z.string().url(),
        pageRole: SourceTypeEnum,
      }),
    )
    .min(3)
    .max(5),
  mode: z.enum(['demo', 'live']),
});

/** Workflow output — validated before it is returned (Requirement 23.3). */
export const ScanWorkflowOutput = z.object({
  scanId: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
  boxSnapshotFolderId: z.string(),
  changedPages: z.number().int().nonnegative(),
  claimCount: z.number().int().nonnegative(),
  verdict: z.string(),
  confidence: z.number().min(0).max(100),
  briefFileId: z.string(),
});

export type ScanWorkflowInput = z.infer<typeof ScanWorkflowInput>;
export type ScanWorkflowOutput = z.infer<typeof ScanWorkflowOutput>;
