import { beforeEach, describe, expect, it } from "vitest";

import type {
  BoxClient,
  BoxFolderSet,
  BoxUploadResult,
  ClaimRow,
  InferenceRequest,
  InsForgeClient,
  ModelClient,
  NewClaim,
  WorkspaceRepository,
} from "@/lib/adapters/types";
import type { AdapterSet } from "@/lib/adapters/factory-core";
import type { Claim, ClaimStatus } from "@/lib/schemas";
import { deserializeDiff } from "@/lib/diff";

import { type ScanWorkflowContext } from "../context";
import { extractClaimsStep } from "./extract-claims";
import { classifyClaimsStep } from "./classify-claims";
import { runDebateStep } from "./run-debate";
import { writeBriefToBoxStep } from "./write-brief";
import type { ComputeDiffData } from "./compute-diff";
import type { FindPreviousSnapshotData } from "./find-previous-snapshot";

/* -------------------------------------------------------------------------- */
/* Fakes                                                                      */
/* -------------------------------------------------------------------------- */

/** In-memory claims/scan store exposing only the methods the analyze steps use. */
class FakeRepo {
  readonly claims = new Map<string, ClaimRow>();
  /** Claims keyed by scanId for prior-claim loads. */
  readonly priorClaims: ClaimRow[] = [];
  scanStatus = "queued";
  failStatusUpdates = 0;
  private seq = 0;

  asRepository(): WorkspaceRepository {
    const self = this;
    const claims = {
      async create(rows: NewClaim[]): Promise<ClaimRow[]> {
        return rows.map((row) => {
          self.seq += 1;
          const id = `claim-${self.seq}`;
          const stored: ClaimRow = {
            ...row,
            id,
            createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, self.seq)).toISOString(),
          };
          self.claims.set(id, stored);
          return stored;
        });
      },
      async listForScan(scanId: string): Promise<ClaimRow[]> {
        const live = [...self.claims.values()].filter((c) => c.scanId === scanId);
        const prior = self.priorClaims.filter((c) => c.scanId === scanId);
        return [...prior, ...live];
      },
      async updateStatus(id: string, status: ClaimStatus): Promise<ClaimRow> {
        if (self.failStatusUpdates > 0) {
          self.failStatusUpdates -= 1;
          throw new Error("simulated status persistence failure");
        }
        const existing = self.claims.get(id);
        if (!existing) throw new Error(`claim ${id} not found`);
        const updated: ClaimRow = { ...existing, claimStatus: status };
        self.claims.set(id, updated);
        return updated;
      },
    };

    const scans = {
      async updateStatus(_id: string, status: string): Promise<unknown> {
        self.scanStatus = status;
        return { id: _id, status };
      },
    };

    return { claims, scans } as unknown as WorkspaceRepository;
  }
}

function fakeInsForge(repo: FakeRepo): InsForgeClient {
  return {
    mode: "demo",
    isConfigured: () => false,
    scoped: () => repo.asRepository(),
    getActiveWorkspace: async () => {
      throw new Error("not used");
    },
  } as unknown as InsForgeClient;
}

/** Records uploads; configurable to simulate / throw. */
class FakeBox {
  readonly uploads: {
    folderId: string;
    artifactType: string;
    name: string;
    content: string;
  }[] = [];
  simulated = false;
  throwOnUpload = false;
  private seq = 0;

  readonly folderSet: BoxFolderSet = {
    scanFolderId: "folder-scan",
    subfolders: {
      raw: "folder-raw",
      normalized: "folder-normalized",
      screenshots: "folder-screenshots",
      diff: "folder-diffs",
      claim: "folder-claims",
      report: "folder-reports",
    },
    simulated: false,
  };

  asClient(): BoxClient {
    const self = this;
    return {
      mode: "demo",
      isConfigured: () => false,
      async upload(
        folderId: string,
        artifactType: string,
        name: string,
        content: Buffer | string,
      ): Promise<BoxUploadResult> {
        if (self.throwOnUpload) throw new Error("box upload failed");
        self.seq += 1;
        self.uploads.push({ folderId, artifactType, name, content: String(content) });
        const fileId = `file-${artifactType}-${self.seq}`;
        return {
          fileId,
          folderId,
          url: `https://box.test/file/${fileId}`,
          key: `${artifactType}/${self.seq}/${name}`,
          simulated: self.simulated,
        };
      },
      folderWebLink: (id: string) => `https://box.test/folder/${id}`,
    } as unknown as BoxClient;
  }
}

/** A ModelClient that returns canned text keyed by responseSchemaName signal. */
function fakeModel(
  responder: (req: InferenceRequest) => string,
): ModelClient & { requests: InferenceRequest[] } {
  const requests: InferenceRequest[] = [];
  return {
    mode: "demo",
    isConfigured: () => false,
    async complete(req: InferenceRequest) {
      requests.push(req);
      return { text: responder(req), simulated: true };
    },
    requests,
  };
}

function makeContext(parts: {
  insforge: InsForgeClient;
  box?: BoxClient;
  model?: ModelClient;
  boxFolders?: BoxFolderSet;
  currentSnapshots?: ScanWorkflowContext["currentSnapshots"];
}): ScanWorkflowContext {
  const adapters: AdapterSet = {
    apify: {} as unknown as AdapterSet["apify"],
    box: parts.box ?? new FakeBox().asClient(),
    insforge: parts.insforge,
    model: parts.model ?? fakeModel(() => "[]"),
  };
  return {
    scanId: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    companyId: "33333333-3333-3333-3333-333333333333",
    companyName: "Dropbox",
    companySlug: "dropbox",
    scanTimestamp: "2024-01-01T00-00-00",
    scanCreatedAt: "2024-01-01T00:00:00.000Z",
    mode: "demo",
    adapters,
    ...(parts.boxFolders !== undefined ? { boxFolders: parts.boxFolders } : {}),
    currentSnapshots: parts.currentSnapshots ?? [],
    warnings: [],
    skipped: [],
  };
}

/* -------------------------------------------------------------------------- */
/* extractClaimsStep                                                          */
/* -------------------------------------------------------------------------- */

const PRICING_CONTENT = "Contact sales for Enterprise pricing.";
const claimJson = (statementText: string, evidenceText: string) =>
  JSON.stringify([
    { claimType: "pricing", statementText, evidenceText, confidence: 0.9 },
  ]);

describe("extractClaimsStep (Requirements 13.2, 13.4)", () => {
  let repo: FakeRepo;
  let box: FakeBox;

  beforeEach(() => {
    repo = new FakeRepo();
    box = new FakeBox();
  });

  it("persists each extracted claim and uploads a claim ledger to claims/ (Req 13.2, 13.4)", async () => {
    const model = fakeModel(() =>
      claimJson("Enterprise is contact-sales.", PRICING_CONTENT),
    );
    const ctx = makeContext({
      insforge: fakeInsForge(repo),
      box: box.asClient(),
      model,
      boxFolders: box.folderSet,
      currentSnapshots: [
        { snapshotId: "snap-1", watchedSourceId: "src-1", normalizedContent: PRICING_CONTENT },
      ],
    });

    const result = await extractClaimsStep(ctx);

    expect(repo.scanStatus).toBe("analyzing");
    // Persisted (Req 13.2).
    expect(result.claims).toHaveLength(1);
    expect(repo.claims.size).toBe(1);
    expect(result.claims[0]!.snapshotId).toBe("snap-1");
    expect(result.claims[0]!.scanId).toBe(ctx.scanId);

    // Claim ledger uploaded to the claims/ subfolder (Req 13.4).
    expect(result.ledgerFileId).toBe("file-claim-1");
    expect(box.uploads).toHaveLength(1);
    expect(box.uploads[0]!.artifactType).toBe("claim");
    expect(box.uploads[0]!.folderId).toBe("folder-claims");
    const ledger = JSON.parse(box.uploads[0]!.content);
    expect(ledger.claimCount).toBe(1);
  });

  it("drops ungrounded claims and tolerates an empty extraction (Req 13.6)", async () => {
    // Evidence text is NOT present in the normalized content -> filtered out.
    const model = fakeModel(() => claimJson("Bogus", "not in the content"));
    const ctx = makeContext({
      insforge: fakeInsForge(repo),
      box: box.asClient(),
      model,
      boxFolders: box.folderSet,
      currentSnapshots: [
        { snapshotId: "snap-1", watchedSourceId: "src-1", normalizedContent: PRICING_CONTENT },
      ],
    });

    const result = await extractClaimsStep(ctx);

    expect(result.claims).toHaveLength(0);
    expect(repo.claims.size).toBe(0);
    // The ledger is still produced (with zero claims).
    expect(result.ledgerFileId).toBe("file-claim-1");
  });

  it("omits the ledger when no claims/ folder is available, recording a warning", async () => {
    const model = fakeModel(() =>
      claimJson("Enterprise is contact-sales.", PRICING_CONTENT),
    );
    const ctx = makeContext({
      insforge: fakeInsForge(repo),
      box: box.asClient(),
      model,
      // no boxFolders
      currentSnapshots: [
        { snapshotId: "snap-1", watchedSourceId: "src-1", normalizedContent: PRICING_CONTENT },
      ],
    });

    const result = await extractClaimsStep(ctx);

    expect(result.claims).toHaveLength(1);
    expect(result.ledgerFileId).toBeNull();
    expect(ctx.warnings.some((w) => w.includes("claims/ folder"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* classifyClaimsStep                                                         */
/* -------------------------------------------------------------------------- */

function seedClaim(repo: FakeRepo, id: string, statementText: string): ClaimRow {
  const row: ClaimRow = {
    id,
    scanId: "11111111-1111-1111-1111-111111111111",
    snapshotId: "snap-1",
    claimType: "pricing",
    statementText,
    evidenceText: `evidence: ${statementText}`,
    confidence: 0.9,
    claimStatus: null,
    riskLevel: null,
    createdAt: "2024-01-01T00:00:01.000Z",
  };
  repo.claims.set(id, row);
  return row;
}

const extractedFrom = (claims: ClaimRow[]) => ({ claims, ledgerFileId: null });

describe("classifyClaimsStep (Requirement 14.6)", () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
  });

  it("persists the assigned status onto each claim record (Req 14.6)", async () => {
    const a = seedClaim(repo, "claim-1", "A");
    const b = seedClaim(repo, "claim-2", "B");
    const model = fakeModel(() =>
      JSON.stringify([
        { statementText: "A", claimStatus: "strengthened" },
        { statementText: "B", claimStatus: "removed" },
      ]),
    );
    const ctx = makeContext({ insforge: fakeInsForge(repo), model });
    const previous: FindPreviousSnapshotData = { priorScanId: "scan-prior", pairings: [] };
    // A prior scan with claims so the classifier consults the model.
    repo.priorClaims.push({ ...a, id: "prior-a", scanId: "scan-prior" });

    const result = await classifyClaimsStep(ctx, extractedFrom([a, b]), previous);

    expect(result.classified.map((c) => c.status)).toEqual(["strengthened", "removed"]);
    expect(repo.claims.get("claim-1")!.claimStatus).toBe("strengthened");
    expect(repo.claims.get("claim-2")!.claimStatus).toBe("removed");
  });

  it("assigns `new` without a prior snapshot (Req 14.2)", async () => {
    const a = seedClaim(repo, "claim-1", "A");
    const model = fakeModel(() => "[]");
    const ctx = makeContext({ insforge: fakeInsForge(repo), model });
    const previous: FindPreviousSnapshotData = { priorScanId: null, pairings: [] };

    const result = await classifyClaimsStep(ctx, extractedFrom([a]), previous);

    expect(result.classified[0]!.status).toBe("new");
    expect(repo.claims.get("claim-1")!.claimStatus).toBe("new");
    // No prior snapshot -> the model is not consulted.
    expect(model.requests).toHaveLength(0);
  });

  it("continues and carries the assignment forward when status persistence fails", async () => {
    const a = seedClaim(repo, "claim-1", "A");
    repo.priorClaims.push({ ...a, id: "prior-a", scanId: "scan-prior" });
    repo.failStatusUpdates = 99;
    const model = fakeModel(() =>
      JSON.stringify([{ statementText: "A", claimStatus: "weakened" }]),
    );
    const ctx = makeContext({ insforge: fakeInsForge(repo), model });
    const previous: FindPreviousSnapshotData = { priorScanId: "scan-prior", pairings: [] };

    const result = await classifyClaimsStep(ctx, extractedFrom([a]), previous);

    expect(result.classified[0]!.status).toBe("weakened");
    expect(ctx.warnings.some((w) => w.includes("Failed to persist status"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* runDebateStep                                                              */
/* -------------------------------------------------------------------------- */

function classifiedFixture(): { claim: ClaimRow; status: ClaimStatus }[] {
  const claim: ClaimRow = {
    id: "claim-1",
    scanId: "scan-1",
    snapshotId: "snap-1",
    claimType: "pricing",
    statementText: "Enterprise is contact-sales.",
    evidenceText: PRICING_CONTENT,
    confidence: 0.9,
    claimStatus: "new",
    riskLevel: null,
    createdAt: "2024-01-01T00:00:01.000Z",
  };
  return [{ claim, status: "new" }];
}

const diffDataFixture: ComputeDiffData = {
  diffs: [
    {
      watchedSourceId: "src-1",
      artifactUploaded: true,
      diff: {
        id: "diff-1",
        scanId: "scan-1",
        diffBoxFileId: "file-diff-1",
        createdAt: "2024-01-01T00:00:02.000Z",
        priorSnapshotId: "snap-prev",
        currentSnapshotId: "snap-1",
        changeScore: 70,
        changeSummary: "Pricing moved to contact-sales.",
        addedText: PRICING_CONTENT,
        removedText: "Start for free.",
        modifiedSections: [],
      },
    },
  ],
  baselines: [],
};

const validVerdictJson = JSON.stringify({
  strategyPrediction: "moving_upmarket",
  confidence: 82,
  riskScore: 64,
  recommendedActions: ["Brief the sales team."],
  keyEvidence: ["Pricing moved to contact-sales."],
  counterEvidence: ["Could be a copy refresh."],
});

describe("runDebateStep (Requirements 15.1, 15.2, 15.3)", () => {
  it("produces the concluded verdict from valid defense/prosecutor/judge output", async () => {
    const repo = new FakeRepo();
    const model = fakeModel((req) => {
      const name = req.responseSchemaName.toLowerCase();
      if (name.includes("defense")) {
        return JSON.stringify({ argument: "It is real.", keyEvidence: [] });
      }
      if (name.includes("prosecut")) {
        return JSON.stringify({ argument: "Maybe not.", counterEvidence: [] });
      }
      return validVerdictJson; // judge
    });
    const ctx = makeContext({ insforge: fakeInsForge(repo), model });

    const result = await runDebateStep(
      ctx,
      { classified: classifiedFixture() },
      diffDataFixture,
    );

    expect(repo.scanStatus).toBe("analyzing");
    expect(result.isFallback).toBe(false);
    expect(result.verdict.strategyPrediction).toBe("moving_upmarket");
    expect(result.verdict.confidence).toBe(82);
  });

  it("substitutes the deterministic fallback when an agent output is invalid (Req 15.7)", async () => {
    const repo = new FakeRepo();
    const model = fakeModel((req) => {
      const name = req.responseSchemaName.toLowerCase();
      if (name.includes("defense")) return "not json"; // invalid -> AgentValidationError
      if (name.includes("prosecut")) {
        return JSON.stringify({ argument: "Maybe not.", counterEvidence: [] });
      }
      return validVerdictJson;
    });
    const ctx = makeContext({ insforge: fakeInsForge(repo), model });

    const result = await runDebateStep(
      ctx,
      { classified: classifiedFixture() },
      diffDataFixture,
    );

    expect(result.isFallback).toBe(true);
    expect(result.failureCause).toBeTruthy();
    // The deterministic fallback is the demo verdict.
    expect(result.verdict.strategyPrediction).toBe("moving_upmarket");
    expect(ctx.warnings.some((w) => w.includes("fallback verdict"))).toBe(true);
  });

  it("returns insufficient_evidence when there are no diffs and no statuses (Req 15.6)", async () => {
    const repo = new FakeRepo();
    const model = fakeModel(() => validVerdictJson);
    const ctx = makeContext({ insforge: fakeInsForge(repo), model });

    const result = await runDebateStep(
      ctx,
      { classified: [] },
      { diffs: [], baselines: [] },
    );

    expect(result.verdict.strategyPrediction).toBe("insufficient_evidence");
    expect(result.verdict.confidence).toBeLessThanOrEqual(25);
    expect(result.isFallback).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* writeBriefToBoxStep                                                        */
/* -------------------------------------------------------------------------- */

const debateFixture = {
  verdict: {
    strategyPrediction: "moving_upmarket" as const,
    confidence: 82,
    riskScore: 64,
    recommendedActions: ["Brief the sales team.", "Re-scan in 30 days."],
    keyEvidence: ["Pricing moved to contact-sales."],
    counterEvidence: ["Could be a copy refresh."],
  },
  isFallback: false,
  failureCause: null,
};

describe("writeBriefToBoxStep (Requirement 16.5)", () => {
  let box: FakeBox;

  beforeEach(() => {
    box = new FakeBox();
  });

  it("renders a markdown brief and uploads it to the reports/ subfolder (Req 16.5)", async () => {
    const repo = new FakeRepo();
    const ctx = makeContext({
      insforge: fakeInsForge(repo),
      box: box.asClient(),
      boxFolders: box.folderSet,
    });

    const result = await writeBriefToBoxStep(
      ctx,
      debateFixture,
      { classified: classifiedFixture() },
      diffDataFixture,
    );

    expect(result.briefFileId).toBe("file-report-1");
    expect(box.uploads).toHaveLength(1);
    expect(box.uploads[0]!.artifactType).toBe("report");
    expect(box.uploads[0]!.folderId).toBe("folder-reports");

    // The brief covers verdict, evidence, actions, claims, and diffs.
    const brief = result.brief;
    expect(brief).toContain("# SignalVault Intelligence Brief: Dropbox");
    expect(brief).toContain("Moving upmarket");
    expect(brief).toContain("Confidence:** 82");
    expect(brief).toContain("Risk score:** 64");
    expect(brief).toContain("Pricing moved to contact-sales.");
    expect(brief).toContain("Brief the sales team.");
    expect(brief).toContain("## Claim Summary");
    expect(brief).toContain("## Detected Changes");
    expect(brief).toContain("change score 70/100");
  });

  it("omits the brief when no reports/ folder is available, recording a warning", async () => {
    const repo = new FakeRepo();
    const ctx = makeContext({ insforge: fakeInsForge(repo), box: box.asClient() });

    const result = await writeBriefToBoxStep(
      ctx,
      debateFixture,
      { classified: [] },
      { diffs: [], baselines: [] },
    );

    expect(result.briefFileId).toBeNull();
    expect(ctx.warnings.some((w) => w.includes("reports/ folder"))).toBe(true);
    // Even with no evidence, the brief still renders placeholder sections.
    expect(result.brief).toContain("No public claims were extracted");
    expect(result.brief).toContain("No page changes were computed");
  });
});
