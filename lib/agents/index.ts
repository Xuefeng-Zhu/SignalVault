/**
 * Barrel for SignalVault's Mastra analysis agents.
 *
 * Currently exposes the courtroom-debate agents — the `defenseAgent`
 * (`runDefense`) and `prosecutorAgent` (`runProsecutor`) — together with the
 * shared debate schemas, evidence types, the typed validation error they
 * surface on bad model output, and the `judgeAgent` (`runJudge`) plus the
 * deterministic debate conclusion (`concludeDebate`). The `runDebateStep`
 * workflow wiring (task 18.6) imports from here.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7
 */

export {
  DefenseSchema,
  ProsecutorSchema,
  AgentValidationError,
  DEBATE_TIMEOUT_MS,
  buildEvidenceMessages,
  buildDebateRequest,
  parseAgentOutput,
  type DefenseArgument,
  type ProsecutorArgument,
  type DebateRole,
  type ClaimStatusAssignment,
  type DebateEvidence,
  type DebateAgentInput,
} from "./debate";

export {
  runDefense,
  DEFENSE_SYSTEM_PROMPT,
  DEFENSE_RESPONSE_SCHEMA_NAME,
} from "./defense";

export {
  runProsecutor,
  PROSECUTOR_SYSTEM_PROMPT,
  PROSECUTOR_RESPONSE_SCHEMA_NAME,
} from "./prosecutor";

export {
  runJudge,
  concludeDebate,
  isEvidenceAbsent,
  buildInsufficientEvidenceVerdict,
  buildJudgeRequest,
  JudgeOutputError,
  DefenseArgumentSchema,
  ProsecutorArgumentSchema,
  JUDGE_RESPONSE_SCHEMA_NAME,
  JUDGE_TIMEOUT_MS,
  INSUFFICIENT_EVIDENCE_CONFIDENCE,
  type JudgeInput,
  type DebateInput,
  type DebateConclusion,
} from "./judge";
