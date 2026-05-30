import { beforeEach, describe, expect, it } from "vitest";

import type {
  ApifyClient,
  BoxClient,
  BoxFolderSet,
  BoxUploadResult,
  CaptureRequest,
  CaptureResult,
  InsForgeClient,
  ModelClient,
  NewSnapshot,
  Scan,
  ScanStatus,
  Snapshot,
  WorkspaceRepository,
} from "@/lib/adapters/types";
import type { AdapterSet } from "@/lib/adapters/factory-core";

import { type ScanWorkflowContext } from "../context";
import { runApifyCaptureStep } from "./run-apify-capture";
import { normalizeArtifactsStep } from "./normalize-artifacts";
import { uploadSnapshotToBoxStep } from "./upload-snapshot-to-box";
import type { CapturePlan, NormalizedSnapshot } from "./artifacts";

/* -------------------------------------------------------------------------- */
/* In-memory fakes for the injected adapters                                  */
/* -------------------------------------------------------------------------- */

/** A minimal in-memory snapshot/scan store exposing the methods the steps use. */
class FakeRepo {
  readonly snapshots = new Map<string, Snapshot>();
  scanStatus: ScanStatus = "queued";
  scanFolderId: string | null = null;
  /** Force snapshots.update to fail this many times before succeeding. */
  failUpdates = 0;
  private seq = 0;

  asRepository(): WorkspaceRepository {
    const self = this;
    const snapshots = {
      async create(rows: NewSnapshot[]): Promise<Snapshot[]> {
        return rows.map((row) => {
          self.seq += 1;
          const id = `snap-${self.seq}`;
          const snapshot: Snapshot = {
            id,
            scanId: row.scanId,
            watchedSourceId: row.watchedSourceId,
            simulated: row.simulated,
            createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, self.seq)).toISOString(),
            rawArtifactUrl: null,
            rawArtifactKey: null,
            rawBoxFileId: null,
            normalizedArtifactUrl: null,
            normalizedArtifactKey: null,
            normalizedBoxFileId: null,
            screenshotArtifactUrl: null,
            screenshotArtifactKey: null,
            screenshotBoxFileId: null,
            contentHash: null,
            normalizedTextHash: null,
          };
          self.snapshots.set(id, snapshot);
          return snapshot;
        });
      },
      async get(id: string): Promise<Snapshot | null> {
        return self.snapshots.get(id) ?? null;
      },
      async listForScan(scanId: string): Promise<Snapshot[]> {
        return [...self.snapshots.values()].filter((s) => s.scanId === scanId);
      },
      async update(id: string, patch: Partial<NewSnapshot>): Promise<Snapshot> {
        if (self.failUpdates > 0) {
          self.failUpdates -= 1;
          throw new Error("simulated persistence failure");
        }
        const existing = self.snapshots.get(id);
        if (!existing) throw new Error(`snapshot ${id} not found`);
        const { scanId: _scanId, ...rest } = patch;
        const updated: Snapshot = { ...existing, ...rest };
        self.snapshots.set(id, updated);
        return updated;
      },
    };

    const scans = {
      async updateStatus(
        _id: string,
        status: ScanStatus,
        patch?: Partial<Pick<Scan, "failureReason" | "boxScanFolderId">>,
      ): Promise<Scan> {
        self.scanStatus = status;
        if (patch && "boxScanFolderId" in patch) {
          self.scanFolderId = patch.boxScanFolderId ?? null;
        }
        return {
          id: _id,
          workspaceId: "ws-1",
          companyId: "co-1",
          status,
          triggerType: "manual",
          failureReason: patch?.failureReason ?? null,
          boxScanFolderId: self.scanFolderId,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:01.000Z",
        };
      },
    };

    // Only the members the steps under test touch are implemented; the rest are
    // present as undefined and never called.
    return {
      snapshots,
      scans,
    } as unknown as WorkspaceRepository;
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

/** Configurable fake ApifyClient returning canned capture results. */
function fakeApify(
  handler: (requests: CaptureRequest[]) => Promise<CaptureResult[]> | CaptureResult[],
): ApifyClient {
  return {
    mode: "demo",
    isConfigured: () => false,
    capture: async (requests: CaptureRequest[]) => handler(requests),
  } as unknown as ApifyClient;
}

/** Records every upload so routing (artifactType -> folderId) can be asserted. */
class FakeBox {
  readonly uploads: {
    folderId: string;
    artifactType: string;
    name: string;
  }[] = [];
  simulated = true;
  throwOnFolders = false;
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
    simulated: true,
  };

  asClient(): BoxClient {
    const self = this;
    return {
      mode: "demo",
      isConfigured: () => false,
      async ensureScanFolders(): Promise<BoxFolderSet> {
        if (self.throwOnFolders) throw new Error("box folders unavailable");
        return { ...self.folderSet, simulated: self.simulated };
      },
      async upload(
        folderId: string,
        artifactType: string,
        name: string,
      ): Promise<BoxUploadResult> {
        if (self.throwOnUpload) throw new Error("box upload failed");
        self.uploads.push({ folderId, artifactType, name });
        self.seq += 1;
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

const noopModel = {
  mode: "demo",
  isConfigured: () => false,
  complete: async () => ({ text: "", simulated: true }),
} as unknown as ModelClient;

function makeContext(parts: {
  apify?: ApifyClient;
  box?: BoxClient;
  insforge: InsForgeClient;
}): ScanWorkflowContext {
  const adapters: AdapterSet = {
    apify: parts.apify ?? fakeApify(() => []),
    box: parts.box ?? new FakeBox().asClient(),
    insforge: parts.insforge,
    model: noopModel,
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
    currentSnapshots: [],
    warnings: [],
    skipped: [],
  };
}

const PLAN: CapturePlan = [
  {
    watchedSourceId: "src-pricing",
    request: { url: "https://acme.test/pricing", pageRole: "pricing", timeoutMs: 60_000 },
  },
  {
    watchedSourceId: "src-docs",
    request: { url: "https://acme.test/docs", pageRole: "docs", timeoutMs: 60_000 },
  },
];

/* -------------------------------------------------------------------------- */
/* runApifyCaptureStep                                                        */
/* -------------------------------------------------------------------------- */

describe("runApifyCaptureStep (Requirements 8.1, 8.5)", () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
  });

  it("creates one snapshot per successful capture and carries raw html forward", async () => {
    const apify = fakeApify((requests) =>
      requests.map((r) => ({
        url: r.url,
        pageRole: r.pageRole,
        ok: true,
        rawHtml: `<html><body><main>${r.pageRole}</main></body></html>`,
        screenshotRef: `shot-${r.pageRole}`,
        simulated: false,
      })),
    );
    const ctx = makeContext({ apify, insforge: fakeInsForge(repo) });

    const captured = await runApifyCaptureStep(ctx, PLAN);

    expect(repo.scanStatus).toBe("scraping");
    expect(captured).toHaveLength(2);
    expect(repo.snapshots.size).toBe(2);
    // Each captured snapshot is associated with its planned source (Req 8.5).
    expect(captured.map((c) => c.watchedSourceId).sort()).toEqual([
      "src-docs",
      "src-pricing",
    ]);
    expect(captured.every((c) => c.rawHtml.length > 0)).toBe(true);
    expect(ctx.skipped).toHaveLength(0);
  });

  it("records a skip for a failed source and continues, without a snapshot", async () => {
    const apify = fakeApify((requests) =>
      requests.map((r, i) =>
        i === 0
          ? {
              url: r.url,
              pageRole: r.pageRole,
              ok: false,
              simulated: false,
              skippedReason: "timeout after 60s",
            }
          : {
              url: r.url,
              pageRole: r.pageRole,
              ok: true,
              rawHtml: "<html><body><main>ok</main></body></html>",
              simulated: false,
            },
      ),
    );
    const ctx = makeContext({ apify, insforge: fakeInsForge(repo) });

    const captured = await runApifyCaptureStep(ctx, PLAN);

    expect(captured).toHaveLength(1);
    expect(repo.snapshots.size).toBe(1);
    expect(ctx.skipped).toEqual([
      { url: "https://acme.test/pricing", pageRole: "pricing", reason: "timeout after 60s" },
    ]);
  });

  it("surfaces a single 'simulated' warning when the adapter substitutes demo data (Req 8.6)", async () => {
    const apify = fakeApify((requests) =>
      requests.map((r) => ({
        url: r.url,
        pageRole: r.pageRole,
        ok: true,
        rawHtml: "<html><body><main>demo</main></body></html>",
        simulated: true,
      })),
    );
    const ctx = makeContext({ apify, insforge: fakeInsForge(repo) });

    await runApifyCaptureStep(ctx, PLAN);

    expect(ctx.warnings.filter((w) => w.includes("simulated"))).toHaveLength(1);
    expect([...repo.snapshots.values()].every((s) => s.simulated)).toBe(true);
  });

  it("degrades to all-skipped when the adapter throws, without crashing", async () => {
    const apify = fakeApify(() => {
      throw new Error("apify exploded");
    });
    const ctx = makeContext({ apify, insforge: fakeInsForge(repo) });

    const captured = await runApifyCaptureStep(ctx, PLAN);

    expect(captured).toEqual([]);
    expect(ctx.skipped).toHaveLength(2);
    expect(repo.snapshots.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* normalizeArtifactsStep                                                     */
/* -------------------------------------------------------------------------- */

describe("normalizeArtifactsStep (Requirements 9.1, 9.4, 9.5)", () => {
  it("normalizes, hashes, and persists content + normalized text hash", async () => {
    const repo = new FakeRepo();
    // Seed a snapshot record the step will update.
    const [snap] = await repo.asRepository().snapshots.create([
      { scanId: "scan-1", watchedSourceId: "src-pricing", simulated: false },
    ]);
    const ctx = makeContext({ insforge: fakeInsForge(repo) });

    const captured = [
      {
        snapshotId: snap!.id,
        watchedSourceId: "src-pricing",
        url: "https://acme.test/pricing",
        pageRole: "pricing" as const,
        rawHtml:
          "<html><body><nav>menu</nav><main><h1>Pricing</h1><p>Enterprise</p></main><footer>f</footer></body></html>",
        simulated: false,
      },
    ];

    const normalized = await normalizeArtifactsStep(ctx, captured);

    expect(normalized).toHaveLength(1);
    const result = normalized[0]!;
    // Script/nav/footer stripped by normalizeHtml.
    expect(result.normalizedContent).toContain("Pricing");
    expect(result.normalizedContent).not.toContain("menu");
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.normalizedTextHash).toMatch(/^[0-9a-f]{64}$/);

    const stored = repo.snapshots.get(snap!.id)!;
    expect(stored.contentHash).toBe(result.contentHash);
    expect(stored.normalizedTextHash).toBe(result.normalizedTextHash);
  });

  it("records a fallback warning when normalization yields empty content (Req 9.5)", async () => {
    const repo = new FakeRepo();
    const [snap] = await repo.asRepository().snapshots.create([
      { scanId: "scan-1", watchedSourceId: "src-x", simulated: false },
    ]);
    const ctx = makeContext({ insforge: fakeInsForge(repo) });

    const normalized = await normalizeArtifactsStep(ctx, [
      {
        snapshotId: snap!.id,
        watchedSourceId: "src-x",
        url: "https://acme.test/empty",
        pageRole: "homepage" as const,
        rawHtml: "<html><body><script>var x=1;</script></body></html>",
        simulated: false,
      },
    ]);

    expect(normalized[0]!.fallbackUsed).toBe(true);
    expect(ctx.warnings.some((w) => w.includes("fell back to raw text"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* uploadSnapshotToBoxStep                                                    */
/* -------------------------------------------------------------------------- */

function normalizedFixture(snapshotId: string): NormalizedSnapshot {
  return {
    snapshotId,
    watchedSourceId: "src-pricing",
    url: "https://acme.test/pricing",
    pageRole: "pricing",
    rawHtml: "<html><body><main>Pricing</main></body></html>",
    screenshotRef: "shot-pricing",
    simulated: false,
    normalizedContent: "# Pricing\n\nEnterprise",
    contentHash: "a".repeat(64),
    normalizedTextHash: "b".repeat(64),
    fallbackUsed: false,
  };
}

describe("uploadSnapshotToBoxStep (Requirements 10.1, 10.2, 10.3, 10.4)", () => {
  let repo: FakeRepo;
  let box: FakeBox;

  beforeEach(async () => {
    repo = new FakeRepo();
    box = new FakeBox();
  });

  async function seedSnapshot(): Promise<string> {
    const [snap] = await repo.asRepository().snapshots.create([
      { scanId: "scan-1", watchedSourceId: "src-pricing", simulated: false },
    ]);
    return snap!.id;
  }

  it("creates the folder tree and routes raw/normalized/screenshot to type-matched subfolders (Req 10.1, 10.2)", async () => {
    const id = await seedSnapshot();
    const ctx = makeContext({ box: box.asClient(), insforge: fakeInsForge(repo) });

    const result = await uploadSnapshotToBoxStep(ctx, [normalizedFixture(id)]);

    expect(repo.scanStatus).toBe("uploading");
    expect(result.folderSet.scanFolderId).toBe("folder-scan");

    const routing = box.uploads.map((u) => ({
      type: u.artifactType,
      folderId: u.folderId,
    }));
    expect(routing).toContainEqual({ type: "raw", folderId: "folder-raw" });
    expect(routing).toContainEqual({ type: "normalized", folderId: "folder-normalized" });
    expect(routing).toContainEqual({ type: "screenshot", folderId: "folder-screenshots" });
  });

  it("persists fileId + url + key for each uploaded artifact (Req 10.3)", async () => {
    const id = await seedSnapshot();
    const ctx = makeContext({ box: box.asClient(), insforge: fakeInsForge(repo) });

    const result = await uploadSnapshotToBoxStep(ctx, [normalizedFixture(id)]);

    const stored = repo.snapshots.get(id)!;
    // Raw artifact identifiers (both url AND key + box file id) persisted.
    expect(stored.rawBoxFileId).toBeTruthy();
    expect(stored.rawArtifactUrl).toBeTruthy();
    expect(stored.rawArtifactKey).toBeTruthy();
    expect(stored.normalizedBoxFileId).toBeTruthy();
    expect(stored.normalizedArtifactUrl).toBeTruthy();
    expect(stored.normalizedArtifactKey).toBeTruthy();
    expect(stored.screenshotBoxFileId).toBeTruthy();

    // The returned snapshot echoes the persisted identifiers (round-trip surface).
    const uploaded = result.snapshots[0]!;
    expect(uploaded.raw?.fileId).toBe(stored.rawBoxFileId);
    expect(uploaded.raw?.url).toBe(stored.rawArtifactUrl);
    expect(uploaded.raw?.key).toBe(stored.rawArtifactKey);
  });

  it("retries persistence up to 3 times then continues on exhaustion (Req 10.4)", async () => {
    const id = await seedSnapshot();
    // The scan-folder persist consumes no snapshot updates; fail 3 snapshot
    // updates then succeed on the 4th attempt.
    repo.failUpdates = 3;
    const ctx = makeContext({ box: box.asClient(), insforge: fakeInsForge(repo) });

    const result = await uploadSnapshotToBoxStep(ctx, [normalizedFixture(id)]);

    // Persistence eventually succeeded within the 4-attempt budget.
    expect(repo.snapshots.get(id)!.rawBoxFileId).toBeTruthy();
    // Workflow continued and produced a result.
    expect(result.snapshots).toHaveLength(1);
  });

  it("records a warning and continues when persistence is exhausted (Req 10.4)", async () => {
    const id = await seedSnapshot();
    // Fail more times than the attempt budget so persistence is exhausted.
    repo.failUpdates = 99;
    const ctx = makeContext({ box: box.asClient(), insforge: fakeInsForge(repo) });

    const result = await uploadSnapshotToBoxStep(ctx, [normalizedFixture(id)]);

    expect(ctx.warnings.some((w) => w.includes("Failed to persist Box identifiers"))).toBe(
      true,
    );
    // The scan was NOT terminated: a result is still produced.
    expect(result.snapshots).toHaveLength(1);
    expect(repo.snapshots.get(id)!.rawBoxFileId).toBeNull();
  });

  it("surfaces a simulated-storage warning and degrades if folders are unavailable", async () => {
    const id = await seedSnapshot();
    box.throwOnFolders = true;
    const ctx = makeContext({ box: box.asClient(), insforge: fakeInsForge(repo) });

    const result = await uploadSnapshotToBoxStep(ctx, [normalizedFixture(id)]);

    expect(ctx.warnings.some((w) => w.includes("Box scan folders"))).toBe(true);
    // Degraded: empty folder set, snapshots carried forward without ids.
    expect(result.folderSet.scanFolderId).toBe("");
    expect(result.snapshots[0]!.raw).toBeUndefined();
  });

  it("surfaces 'evidence storage is simulated' for a simulated Box adapter (Req 10.5)", async () => {
    const id = await seedSnapshot();
    box.simulated = true;
    const ctx = makeContext({ box: box.asClient(), insforge: fakeInsForge(repo) });

    await uploadSnapshotToBoxStep(ctx, [normalizedFixture(id)]);

    expect(ctx.warnings).toContain("Evidence storage is simulated.");
  });
});
