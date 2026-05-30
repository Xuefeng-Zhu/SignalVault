import { z } from 'zod';

import { StrategyEnum } from './enums';

/**
 * The strategy Verdict produced by the judge agent.
 *
 * `confidence` and `riskScore` are integers in [0, 100]. `recommendedActions`
 * carries between 1 and 10 non-empty action strings. `keyEvidence` and
 * `counterEvidence` may be empty.
 *
 * Requirements: 15.3, 16.1
 */
export const VerdictSchema = z.object({
  strategyPrediction: StrategyEnum,
  confidence: z.number().int().min(0).max(100),
  riskScore: z.number().int().min(0).max(100),
  recommendedActions: z.array(z.string().min(1)).min(1).max(10),
  keyEvidence: z.array(z.string()),
  counterEvidence: z.array(z.string()),
});

export type Verdict = z.infer<typeof VerdictSchema>;
