import { describe, expect, it, vi } from "vitest";

import type { Claim } from "@/lib/schemas";
import { ClaimStatusEnum } from "@/lib/schemas";
import type { InferenceRequest, ModelClient } from "@/lib/adapters/types";

import {
  CLAIM_STATUS_SCHEMA_NAME,
  classifyClaims,
  NO_PRIOR_STATUS,
  UNDETERMINED_STATUS,
} from "./claim-classifier";

/** Build a schema-conformant Claim with a unique statement. */
function claim(statementText: string, overrides: Partial<Claim> = {}): Claim {
  return {
    claimType: "pricing",
    statementText,
    evidenceText: `evidence for: ${statementText}`,
    confidence: 0.9,
    ...overrides,
  };
}

/** A stub ModelClient that returns a fixed text and records its requests. */
function stubModel(text: string): ModelClient & { requests: InferenceRequest[] } {
  const requests: InferenceRequest[] = [];
  return {
    mode: "demo",
    isConfigured: () => false,
    async complete(req: InferenceRequest) {
      requests.push(req);
      return { text, simulated: true };
    },
    requests,
  };
}

const VALID_STATUSES = new Set(ClaimStatusEnum.options);

describe("classifyClaims", () => {
  it("assigns `new` to every claim without calling the model when no prior snapshot (14.2)", async () => {
    const model = stubModel("[]");
    const currentClaims = [claim("A"), claim("B"), claim("C")];

    const result = await classifyClaims({
      currentClaims,
      priorClaims: null,
      hasPriorSnapshot: false,
      model,
    });

    expect(result.map((r) => r.status)).toEqual([
      NO_PRIOR_STATUS,
      NO_PRIOR_STATUS,
      NO_PRIOR_STATUS,
    ]);
    expect(model.requests).toHaveLength(0);
  });

  it("treats a flagged-but-empty prior claim set as no prior basis (14.2)", async () => {
    const model = stubModel("[]");
    const result = await classifyClaims({
      currentClaims: [claim("A")],
      priorClaims: [],
      hasPriorSnapshot: true,
      model,
    });

    expect(result[0]!.status).toBe(NO_PRIOR_STATUS);
    expect(model.requests).toHaveLength(0);
  });

  it("maps each claim to its model-provided valid status by statementText (14.1)", async () => {
    const model = stubModel(
      JSON.stringify([
        { statementText: "A", claimStatus: "strengthened" },
        { statementText: "B", claimStatus: "removed" },
      ]),
    );
    const currentClaims = [claim("A"), claim("B")];

    const result = await classifyClaims({
      currentClaims,
      priorClaims: [claim("A-prior")],
      hasPriorSnapshot: true,
      model,
    });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.status)).toEqual(["strengthened", "removed"]);
    expect(model.requests[0]!.responseSchemaName).toBe(CLAIM_STATUS_SCHEMA_NAME);
  });

  it("defaults to needs_review when the model omits a claim (14.3)", async () => {
    const model = stubModel(
      JSON.stringify([{ statementText: "A", claimStatus: "weakened" }]),
    );

    const result = await classifyClaims({
      currentClaims: [claim("A"), claim("B")],
      priorClaims: [claim("prior")],
      hasPriorSnapshot: true,
      model,
    });

    expect(result[0]!.status).toBe("weakened");
    expect(result[1]!.status).toBe(UNDETERMINED_STATUS);
  });

  it("defaults to needs_review for invalid status values and unparseable output (14.3)", async () => {
    const invalidStatus = stubModel(
      JSON.stringify([{ statementText: "A", claimStatus: "totally_invalid" }]),
    );
    const garbage = stubModel("not json at all");

    const [a] = await classifyClaims({
      currentClaims: [claim("A")],
      priorClaims: [claim("prior")],
      hasPriorSnapshot: true,
      model: invalidStatus,
    });
    const [b] = await classifyClaims({
      currentClaims: [claim("A")],
      priorClaims: [claim("prior")],
      hasPriorSnapshot: true,
      model: garbage,
    });

    expect(a!.status).toBe(UNDETERMINED_STATUS);
    expect(b!.status).toBe(UNDETERMINED_STATUS);
  });

  it("falls back to needs_review for all claims when the model throws (14.3)", async () => {
    const model: ModelClient = {
      mode: "demo",
      isConfigured: () => false,
      complete: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const result = await classifyClaims({
      currentClaims: [claim("A"), claim("B")],
      priorClaims: [claim("prior")],
      hasPriorSnapshot: true,
      model,
    });

    expect(result.map((r) => r.status)).toEqual([
      UNDETERMINED_STATUS,
      UNDETERMINED_STATUS,
    ]);
  });

  it("always returns exactly one valid status per input claim (14.1)", async () => {
    const model = stubModel(
      JSON.stringify([{ statementText: "A", claimStatus: "contradicted" }]),
    );
    const currentClaims = [claim("A"), claim("B"), claim("C")];

    const result = await classifyClaims({
      currentClaims,
      priorClaims: [claim("prior")],
      hasPriorSnapshot: true,
      model,
    });

    expect(result).toHaveLength(currentClaims.length);
    for (const { status } of result) {
      expect(VALID_STATUSES.has(status)).toBe(true);
    }
  });

  it("returns an empty result for empty input", async () => {
    const model = stubModel("[]");
    const result = await classifyClaims({
      currentClaims: [],
      priorClaims: [claim("prior")],
      hasPriorSnapshot: true,
      model,
    });

    expect(result).toEqual([]);
    expect(model.requests).toHaveLength(0);
  });
});
