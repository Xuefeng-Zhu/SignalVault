import {
  acmeClaims,
  buildAcmeClaimRecords,
  buildDemoVerdict,
} from "@/lib/demo";

// `import type` keeps this module free of the `server-only` runtime guard that
// `@/lib/adapters/types` pulls in, so the pure inference-mapping logic stays
// unit-testable while the demo *client* (`./demo`) remains server-only. This
// mirrors the apify adapter's `demo-capture` split.
import type { InferenceRequest } from "@/lib/adapters/types";

/**
 * Pure, deterministic mapping from an {@link InferenceRequest} to the seeded
 * "Dropbox" analysis text the demo {@link import('./demo').DemoModelClient}
 * returns. No randomness, no timestamps, no ids, and no network — repeated
 * scans produce byte-identical output (Requirements 24.3, 18.1, 18.7).
 *
 * Output is keyed off {@link InferenceRequest.responseSchemaName} (the value
 * the live client passes through for tracing) so each downstream analysis agent
 * — claim extractor, claim classifier, defense, prosecutor, judge (tasks
 * 16.x / 17.x) — receives a payload its Zod schema can parse. Matching is
 * deliberately tolerant: the schema name is normalized and matched on keywords,
 * with the request messages used as a secondary signal, so the agent tasks can
 * align their `responseSchemaName` values without an exact-string contract.
 *
 * ## Supported `responseSchemaName` keys
 *
 * Matching is case-insensitive and ignores non-alphanumeric characters, so
 * `"Claim[]"`, `"claim_array"`, and `"ClaimArray"` all match the claim key.
 * Keys are checked in the priority order below; agent tasks should pick a
 * `responseSchemaName` containing one of the listed keywords.
 *
 * | Canonical key        | Matches when the name contains | Deterministic payload |
 * | -------------------- | ------------------------------ | --------------------- |
 * | `ClaimStatus`        | `status` or `classif`          | JSON array of `{ statementText, claimStatus }` (one per seeded claim) |
 * | `DefenseArgument`    | `defense` / `defence`          | JSON `{ argument, keyEvidence[] }` arguing the shift is real |
 * | `ProsecutorArgument` | `prosecut`                     | JSON `{ argument, counterEvidence[] }` flagging copy-refresh / weak signals |
 * | `Verdict`            | `verdict` or `judge`           | JSON `Verdict` ("moving_upmarket", confidence 82) |
 * | `Claim[]`            | `claim`                        | JSON array of `Claim` (claimType, statementText, evidenceText, confidence) |
 *
 * If none match (an unknown schema name and no keyword in the messages), a
 * deterministic plain-text analysis narrative is returned as a sensible default.
 */

/** The deterministic payload kinds the demo client can produce. */
export type PayloadKind =
  | "claim-status"
  | "defense"
  | "prosecutor"
  | "verdict"
  | "claims"
  | "default";

/** Lowercase and strip every non-alphanumeric character for tolerant matching. */
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a {@link PayloadKind} from a normalized signal string. Keys are
 * checked most-specific first so that, e.g., "ClaimStatus" resolves to the
 * classification payload rather than the claim-array payload.
 */
function classifySignal(normalized: string): PayloadKind | undefined {
  if (normalized.includes("status") || normalized.includes("classif")) {
    return "claim-status";
  }
  if (normalized.includes("defense") || normalized.includes("defence")) {
    return "defense";
  }
  if (normalized.includes("prosecut")) {
    return "prosecutor";
  }
  if (normalized.includes("verdict") || normalized.includes("judge")) {
    return "verdict";
  }
  if (normalized.includes("claim")) {
    return "claims";
  }
  return undefined;
}

/**
 * Pick the deterministic payload kind for a request: first from the
 * `responseSchemaName`, then (as a fallback) from the request system prompt and
 * messages, and finally a stable default.
 */
export function resolvePayloadKind(req: InferenceRequest): PayloadKind {
  const fromSchema = classifySignal(normalizeKey(req.responseSchemaName));
  if (fromSchema) {
    return fromSchema;
  }

  const messageText = req.messages.map((m) => m.content).join(" ");
  const fromMessages = classifySignal(normalizeKey(`${req.system} ${messageText}`));
  return fromMessages ?? "default";
}

/** Stable two-space JSON encoding of a deterministic payload. */
function toJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * The deterministic plain-text analysis narrative used when no schema/message
 * keyword matches. Mirrors the seeded Dropbox AI-platform pivot story.
 */
const DEFAULT_ANALYSIS_TEXT = [
  "Demo analysis for Dropbox.",
  "",
  "Across the two seeded snapshots, Dropbox shows a coordinated AI-platform pivot: pricing added Enterprise tiers with Dropbox Dash AI and DLP; the security page added SOC 2 Type II, ISO 27001, HIPAA, SAML SSO, DLP, and legal holds; the docs launched a Dash AI universal search API and content intelligence API; and careers shifted from file-sync engineering to AI/ML research hiring.",
  "",
  "Strategy prediction: AI platform pivot (confidence 85 / 100).",
].join("\n");

/** Seeded defense argument: the changes support a deliberate AI pivot. */
const DEFENSE_ARGUMENT =
  "The evidence supports a deliberate pivot to an AI-powered workspace platform. Dropbox added an Enterprise tier with Dash AI and DLP, hardened its security posture with SOC 2 Type II, ISO 27001, HIPAA, SAML SSO, and legal holds, launched Dash AI universal search and content intelligence APIs, and is hiring a Head of AI Research, Senior ML Engineers, and Staff AI/ML Platform engineers. Taken together these are coordinated signals of an AI-platform transformation rather than incremental product updates.";

/** Seeded prosecutor argument: the changes may not prove a durable pivot. */
const PROSECUTOR_ARGUMENT =
  "These changes may not prove a durable AI-platform pivot. Dropbox has announced AI features before (Smart Sync, content suggestions) without fully committing to a platform transformation. The free/consumer tiers still exist in the pricing structure, suggesting the pivot may be additive rather than a full repositioning. Follow-up scans are needed to confirm the AI investment is sustained rather than a temporary marketing push.";

/**
 * Build the deterministic seeded text for a request. Pure and side-effect free;
 * never touches the network.
 */
export function seededInferenceText(req: InferenceRequest): string {
  switch (resolvePayloadKind(req)) {
    case "claims": {
      // Claim[] in ClaimSchema shape (claimType, statementText, evidenceText, confidence).
      return toJson(buildAcmeClaimRecords());
    }
    case "claim-status": {
      // One Claim_Status per seeded claim, paired with the claim it classifies.
      const statuses = acmeClaims.map((c) => ({
        statementText: c.statementText,
        claimStatus: c.claimStatus,
      }));
      return toJson(statuses);
    }
    case "defense": {
      const verdict = buildDemoVerdict();
      return toJson({ argument: DEFENSE_ARGUMENT, keyEvidence: verdict.keyEvidence });
    }
    case "prosecutor": {
      const verdict = buildDemoVerdict();
      return toJson({
        argument: PROSECUTOR_ARGUMENT,
        counterEvidence: verdict.counterEvidence,
      });
    }
    case "verdict": {
      // VerdictSchema shape: drop the persistence-only `isFallback` flag.
      const { isFallback: _isFallback, ...verdict } = buildDemoVerdict();
      return toJson(verdict);
    }
    case "default":
    default:
      return DEFAULT_ANALYSIS_TEXT;
  }
}
