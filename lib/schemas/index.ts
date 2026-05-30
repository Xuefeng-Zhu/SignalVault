/**
 * Barrel for SignalVault's shared Zod schemas and inferred TypeScript types.
 * These are the single source of truth shared across the API, the Mastra
 * workflow, and the analysis agents.
 *
 * Requirements: 23.2, 23.3, 13.1, 15.3, 16.1
 */
export {
  SourceTypeEnum,
  ClaimTypeEnum,
  ClaimStatusEnum,
  StrategyEnum,
  type SourceType,
  type ClaimType,
  type ClaimStatus,
  type Strategy,
} from './enums';

export { ClaimSchema, type Claim } from './claim';

export {
  AddCompanyFormSchema,
  UrlRowSchema,
  ADD_COMPANY_MESSAGES,
  MIN_URLS,
  MAX_URLS,
  NAME_MAX,
  isValidHostname,
  isValidHttpUrl,
  validateAddCompanyForm,
  type AddCompanyFormValues,
  type AddCompanyFormErrors,
  type UrlRow,
} from './company';

export { VerdictSchema, type Verdict } from './verdict';

export {
  ScanWorkflowInput,
  ScanWorkflowOutput,
  type ScanWorkflowInput as ScanWorkflowInputType,
  type ScanWorkflowOutput as ScanWorkflowOutputType,
} from './workflow';
