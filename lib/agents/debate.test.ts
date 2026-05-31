import { describe, expect, it } from "vitest";

import type { Claim } from "@/lib/schemas";
import type { Diff } from "@/lib/diff";
import type { InferenceRequest, ModelClient } from "@/lib/adapters/types";

import {
  AgentValidationError,
  DEBATE_TIMEOUT_MS,
  DefenseSchema,
  ProsecutorSchema,
  type ClaimStatusAssignment,
  type DebateEvidence,
} from "./debate";
import {
  runDefense,
  DEFENSE_RESPONSE_SCHEMA_NAME,
  DEFENSE_SYSTEM_PROMPT,
} from "./defense";
import {
  runProsecutor,
  PROSECUTOR_RESPONSE_SCHEMA_NAME,
  PROSECUTOR_SYSTEM_PROMPT,
} from "./prosecutor";

/**
 * Unit tests for the courtroom-debate agents (Requirements 15.1, 15.2, 15.5).
 *
 * The agents are exercised with injected fake {@link ModelClient}s so the tests
 * stay pure: a recording client (to assert the request shape/stance) and a
 * malformed client (to assert validation failures surface as
 * {@link AgentValidationError}).
 */

/** Deterministic defense response for testing. */
const DEFENSE_RESPONSE = JSON.stringify({
  argument: "The pricing changes indicate a deliberate enterprise-readiness push with AI integration.",
  keyEvidence: [
    "Enterprise plan moved to contact-sales pricing.",
    "AI-powered features added to the top tier.",
  ],
});

/** Deterministic prosecutor response for testing. */
const PROSECUTOR_RESPONSE = JSON.stringify({
  argument: "The changes are a routine copy refresh rather than a durable strategic pivot.",
  counterEvidence: [
    "Free tier remains unchanged, suggesting incremental rather than transformational change.",
    "Similar announcements have been made before without follow-through.",
  ],
});

/** Return the appropriate canned response based on the schema name. */
function cannedInferenceText(req: InferenceRequest): string {
  const name = req.responseSchemaName.toLowerCase();
  if (name.includes("defense") || name.includes("defence")) {
    return DEFENSE_RESPONSE;
  }
  if (name.includes("prosecut")) {
    return PROSECUTOR_RESPONSE;
  }
  return "{}";
}

/** A ModelClient that records the last request and returns canned text. */
class RecordingModelClient implements ModelClient {
  readonly mode = "live" as const;
  lastRequest: InferenceRequest | null = null;

  constructor(private readonly responder: (req: InferenceRequest) => string) {}

  isConfigured(): boolean {
    return true;
  }

  async complete(req: InferenceRequest): Promise<{ text: string; simulated: boolean }> {
    this.lastRequest = req;
    return { text: this.responder(req), simulated: false };
  }
}

/** A ModelClient backed by canned responses. */
const cannedClient = new RecordingModelClient((req) => cannedInferenceText(req));

const claims: Claim[] = [
  {
    claimType: "pricing",
    statementText: "Enterprise plan is now contact-sales.",
    evidenceText: "Contact sales for Enterprise pricing.",
    confidence: 0.9,
  },
];

const statuses: ClaimStatusAssignment[] = [
  { statementText: "Enterprise plan is now contact-sales.", claimStatus: "new" },
];

const diffs: Diff[] = [
  {
    priorSnapshotId: "prior-1",
    currentSnapshotId: "current-1",
    changeScore: 70,
    changeSummary: "Pricing moved to contact-sales.",
    addedText: "Contact sales for Enterprise pricing.",
    removedText: "Start for free.",
    modifiedSections: [],
  },
];

const evidence: DebateEvidence = { claims, statuses, diffs };

describe("runDefense", () => {
  it("returns a schema-valid defense argument from canned output", async () => {
    const result = await runDefense({ ...evidence, model: cannedClient });
    expect(() => DefenseSchema.parse(result)).not.toThrow();
    expect(result.argument.length).toBeGreaterThan(0);
    expect(Array.isArray(result.keyEvidence)).toBe(true);
  });

  it("builds a request with the defense-for stance and traced schema name", async () => {
    const client = new RecordingModelClient((req) => cannedInferenceText(req));
    await runDefense({ ...evidence, model: client });

    const req = client.lastRequest!;
    expect(req.system).toBe(DEFENSE_SYSTEM_PROMPT);
    expect(req.system).toContain("argue FOR");
    expect(req.responseSchemaName).toBe(DEFENSE_RESPONSE_SCHEMA_NAME);
    expect(req.responseSchemaName.toLowerCase()).toContain("defense");
    expect(req.timeoutMs).toBe(DEBATE_TIMEOUT_MS);
    // Evidence is handed to the model as the user message.
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]!.content).toContain("Enterprise plan is now contact-sales.");
  });

  it("throws AgentValidationError tagged 'defense' on non-JSON output", async () => {
    const client = new RecordingModelClient(() => "not json");
    await expect(runDefense({ ...evidence, model: client })).rejects.toBeInstanceOf(
      AgentValidationError,
    );
    await runDefense({ ...evidence, model: client }).catch((error) => {
      expect(error).toBeInstanceOf(AgentValidationError);
      expect((error as AgentValidationError).agent).toBe("defense");
      expect((error as AgentValidationError).rawText).toBe("not json");
    });
  });

  it("throws AgentValidationError on JSON that fails the schema", async () => {
    // Missing `argument`; `keyEvidence` wrong type.
    const client = new RecordingModelClient(() =>
      JSON.stringify({ keyEvidence: "nope" }),
    );
    await expect(runDefense({ ...evidence, model: client })).rejects.toBeInstanceOf(
      AgentValidationError,
    );
  });
});

describe("runProsecutor", () => {
  it("returns a schema-valid prosecutor argument from canned output", async () => {
    const result = await runProsecutor({ ...evidence, model: cannedClient });
    expect(() => ProsecutorSchema.parse(result)).not.toThrow();
    expect(result.argument.length).toBeGreaterThan(0);
    expect(Array.isArray(result.counterEvidence)).toBe(true);
  });

  it("builds a request with the prosecution-against stance and traced schema name", async () => {
    const client = new RecordingModelClient((req) => cannedInferenceText(req));
    await runProsecutor({ ...evidence, model: client });

    const req = client.lastRequest!;
    expect(req.system).toBe(PROSECUTOR_SYSTEM_PROMPT);
    expect(req.system).toContain("copy-refresh");
    expect(req.responseSchemaName).toBe(PROSECUTOR_RESPONSE_SCHEMA_NAME);
    expect(req.responseSchemaName.toLowerCase()).toContain("prosecut");
    expect(req.timeoutMs).toBe(DEBATE_TIMEOUT_MS);
  });

  it("throws AgentValidationError tagged 'prosecutor' on non-JSON output", async () => {
    const client = new RecordingModelClient(() => "<<<bad>>>");
    await runProsecutor({ ...evidence, model: client }).catch((error) => {
      expect(error).toBeInstanceOf(AgentValidationError);
      expect((error as AgentValidationError).agent).toBe("prosecutor");
    });
    await expect(runProsecutor({ ...evidence, model: client })).rejects.toBeInstanceOf(
      AgentValidationError,
    );
  });

  it("throws AgentValidationError on JSON that fails the schema", async () => {
    // `argument` empty violates min(1).
    const client = new RecordingModelClient(() =>
      JSON.stringify({ argument: "", counterEvidence: [] }),
    );
    await expect(runProsecutor({ ...evidence, model: client })).rejects.toBeInstanceOf(
      AgentValidationError,
    );
  });
});
