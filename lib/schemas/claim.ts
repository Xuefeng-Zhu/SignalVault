import { z } from 'zod';

import { ClaimTypeEnum } from './enums';

/**
 * A single public claim extracted from normalized snapshot content.
 *
 * `confidence` is a model-assigned probability in [0, 1]. Both `statementText`
 * and `evidenceText` must be non-empty; the evidence is the grounding excerpt
 * that the claim was derived from.
 *
 * Requirements: 13.1
 */
export const ClaimSchema = z.object({
  claimType: ClaimTypeEnum,
  statementText: z.string().min(1),
  evidenceText: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type Claim = z.infer<typeof ClaimSchema>;
