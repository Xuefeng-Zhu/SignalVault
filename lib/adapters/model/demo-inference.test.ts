import { describe, expect, it } from "vitest";

import {
  ClaimSchema,
  ClaimStatusEnum,
  VerdictSchema,
  type Strategy,
} from "@/lib/schemas";
import { z } from "zod";

import type { InferenceRequest } from "@/lib/adapters/types";

import { resolvePayloadKind, seededInferenceText } from "./demo-inference";

/**
 * Unit tests for the deterministic demo inference mapping (Requirements 24.3,
 * 18.1, 18.7). These exercise the pure module the server-only DemoModelClient
 * delegates to.
 */

function req(responseSchemaName: string, userContent = ""): InferenceRequest {
  return {
    system: "You are a SignalVault analysis agent.",
    messages: userContent ? [{ role: "user", content: userContent }] : [],
    responseSchemaName,
    timeoutMs: 60_000,
  };
}

describe("seededInferenceText payload selection", () => {
  it("returns a Claim[] JSON array conforming to ClaimSchema for claim-extraction names", () => {
    for (const name of ["Claim[]", "ClaimArray", "claim_list"]) {
      const parsed = JSON.parse(seededInferenceText(req(name)));
      const claims = z.array(ClaimSchema).parse(parsed);
      expect(claims.length).toBeGreaterThan(0);
    }
  });

  it("returns claim statuses (one valid Claim_Status per claim) for classification names", () => {
    const StatusRow = z.object({
      statementText: z.string().min(1),
      claimStatus: ClaimStatusEnum,
    });
    for (const name of ["ClaimStatus", "ClaimStatus[]", "claim_classification"]) {
      const parsed = JSON.parse(seededInferenceText(req(name)));
      const rows = z.array(StatusRow).parse(parsed);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it("returns a Verdict ('moving_upmarket', confidence 85) for verdict/judge names", () => {
    for (const name of ["Verdict", "JudgeVerdict"]) {
      const verdict = VerdictSchema.parse(JSON.parse(seededInferenceText(req(name))));
      const strategy: Strategy = "moving_upmarket";
      expect(verdict.strategyPrediction).toBe(strategy);
      expect(verdict.confidence).toBe(85);
    }
  });

  it("returns a defense argument with keyEvidence", () => {
    const DefenseSchema = z.object({
      argument: z.string().min(1),
      keyEvidence: z.array(z.string().min(1)).min(1),
    });
    const parsed = DefenseSchema.parse(JSON.parse(seededInferenceText(req("DefenseArgument"))));
    expect(parsed.argument.length).toBeGreaterThan(0);
  });

  it("returns a prosecutor argument with counterEvidence", () => {
    const ProsecutorSchema = z.object({
      argument: z.string().min(1),
      counterEvidence: z.array(z.string().min(1)).min(1),
    });
    const parsed = ProsecutorSchema.parse(
      JSON.parse(seededInferenceText(req("ProsecutorArgument"))),
    );
    expect(parsed.argument.length).toBeGreaterThan(0);
  });

  it("falls back to a deterministic plain-text narrative for unknown names", () => {
    const text = seededInferenceText(req("SomethingUnknown"));
    expect(() => JSON.parse(text)).toThrow();
    expect(text).toContain("Dropbox");
    expect(resolvePayloadKind(req("SomethingUnknown"))).toBe("default");
  });

  it("uses message content as a secondary signal when the schema name is unknown", () => {
    expect(resolvePayloadKind(req("Unknown", "Please produce the final verdict."))).toBe(
      "verdict",
    );
    const verdict = VerdictSchema.parse(
      JSON.parse(seededInferenceText(req("Unknown", "Please produce the final verdict."))),
    );
    expect(verdict.confidence).toBe(85);
  });

  it("is deterministic across repeated calls (Requirement 18.7)", () => {
    for (const name of ["Claim[]", "ClaimStatus", "Verdict", "DefenseArgument", "Unknown"]) {
      expect(seededInferenceText(req(name))).toBe(seededInferenceText(req(name)));
    }
  });
});
