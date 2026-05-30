// Feature: signalvault, Property 13: Uploaded artifact identifiers round-trip to persistence
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  ApifyClient,
  BoxClient,
  BoxFolderSet,
  BoxUploadResult,
  InsForgeClient,
  ModelClient,
  NewSnapshot,
  Scan,
  ScanStatus,
  Snapshot,
  WorkspaceRepository,
} from "@/lib/adapters/types";
import type { AdapterSet } from "@/lib/adapters/factory-core";
import { SourceTypeEnum } from "@/lib/schemas";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { createScanWorkflowContext, type ScanWorkflowContext } from "../context";
import { uploadSnapshotToBoxStep } from "./upload-snapshot-to-box";
import type { ArtifactIdentifiers, NormalizedSnapshot } from "./artifacts";

/**
 * Property 13 (Validates: Requirements 10.3):
 *
 * *For any* set of normalized snapshots uploaded for a scan, the Box artifact
 * identifiers returned by `uploadSnapshotToBoxStep` are persisted onto the
 * Snapshot records such that reading a record back yields the SAME identifiers
 * the step returned (and the same values the Box adapter returned). Concretely,
 * for each uploaded artifact the persisted `*BoxFileId`, `*ArtifactUrl`, and
 * `*ArtifactKey` equal the returned `raw`/`normalized`/`screenshot`
 * {@link ArtifactIdentifiers} — both `url` AND `key` (the InsForge storage
 * convention) plus the Box file id round-trip to persistence. A snapshot that
 * carried no screenshot reference persists no screenshot identifiers.
 *
 * The step core takes the context explicitly and uses only injected adapters,
 * so the round-trip is exercised end-to-end against in-memory fakes — a
 * `FakeBox` that records every upload and returns deterministic
 * `{fileId, folderId, url, key}`, and a `FakeRepo` whose `snapshots.update`
 * mutates an in-memory row that `snapshots.get` reads back.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/* -------------------------------------------------------------------------- */
/* In-memory fakes (adapted from capture-normalize-upload.test.ts)            */
/* -------------------------------------------------------------------------- */

/** Minimal in-memory snapshot/scan store exposing only the methods the step uses. */
class FakeRepo {
  readonly snapshots = new Map<string, Snapshot>();
  scanStatus: ScanStatus = "queued";
  scanFolderId: string | null = null;
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
        id: string,
        status: ScanStatus,
        patch?: Partial<Pick<Scan, "failureReason" | "boxScanFolderId">>,
      ): Promise<Scan> {
        self.scanStatus = status;
        if (patch && "boxScanFolderId" in patch) {
          self.scanFolderId = patch.boxScanFolderId ?? null;
        }
        return {
          id,
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

    // Only the members the step under test touches are implemented.
    return { snapshots, scans } as unknown as WorkspaceRepository;
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

/** Records every upload and the full result it returned, with deterministic ids. */
class FakeBox {
  readonly uploads: { folderId: string; artifactType: string; name: string }[] = [];
  /** Every {fileId, folderId, url, key} the adapter handed back. */
  readonly results: BoxUploadResult[] = [];
  simulated = false;
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
      async ensureScanFolders(): Promise<BoxFolderSet> {
        return { ...self.folderSet, simulated: self.simulated };
      },
      async upload(
        folderId: string,
        artifactType: string,
        name: string,
      ): Promise<BoxUploadResult> {
        self.uploads.push({ folderId, artifactType, name });
        self.seq += 1;
        const fileId = `file-${artifactType}-${self.seq}`;
        const result: BoxUploadResult = {
          fileId,
          folderId,
          // url is deterministically derived from fileId (FakeBox contract):
          url: `https://box.test/file/${fileId}`,
          key: `${artifactType}/${self.seq}/${name}`,
          simulated: self.simulated,
        };
        self.results.push(result);
        return result;
      },
      folderWebLink: (id: string) => `https://box.test/folder/${id}`,
    } as unknown as BoxClient;
  }
}

const noopApify = {
  mode: "demo",
  isConfigured: () => false,
  capture: async () => [],
} as unknown as ApifyClient;

const noopModel = {
  mode: "demo",
  isConfigured: () => false,
  complete: async () => ({ text: "", simulated: true }),
} as unknown as ModelClient;

function makeContext(repo: FakeRepo, box: FakeBox): ScanWorkflowContext {
  const adapters: AdapterSet = {
    apify: noopApify,
    box: box.asClient(),
    insforge: fakeInsForge(repo),
    model: noopModel,
  };
  return createScanWorkflowContext({
    scanId: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    companyId: "33333333-3333-3333-3333-333333333333",
    companyName: "Dropbox",
    companySlug: "dropbox",
    scanTimestamp: "2024-01-01T00-00-00",
    scanCreatedAt: "2024-01-01T00:00:00.000Z",
    mode: "demo",
    adapters,
  });
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/** One generated normalized snapshot, varying role/content/screenshot/flags. */
const snapshotSpecArb = fc.record({
  pageRole: fc.constantFrom(...SourceTypeEnum.options),
  rawHtml: fc.string(),
  normalizedContent: fc.string(),
  // `undefined` => no screenshot reference (no screenshot artifact uploaded).
  screenshotRef: fc.option(fc.string(), { nil: undefined }),
  contentHash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  normalizedTextHash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  fallbackUsed: fc.boolean(),
  simulated: fc.boolean(),
});

type SnapshotSpec = ReturnType<typeof snapshotSpecArb["generate"]>["value"];

/**
 * Seed a snapshot row per spec into the FakeRepo (so `snapshots.update` has a
 * row to patch) and build the matching {@link NormalizedSnapshot} referencing
 * the generated row id.
 */
async function seedNormalizedSnapshots(
  repo: FakeRepo,
  scanId: string,
  specs: SnapshotSpec[],
): Promise<NormalizedSnapshot[]> {
  const rows: NewSnapshot[] = specs.map((spec, i) => ({
    scanId,
    watchedSourceId: `src-${i}`,
    simulated: spec.simulated,
  }));
  const seeded = await repo.asRepository().snapshots.create(rows);

  return specs.map((spec, i) => {
    const base: NormalizedSnapshot = {
      snapshotId: seeded[i]!.id,
      watchedSourceId: `src-${i}`,
      url: `https://acme.test/${spec.pageRole}-${i}`,
      pageRole: spec.pageRole,
      rawHtml: spec.rawHtml,
      simulated: spec.simulated,
      normalizedContent: spec.normalizedContent,
      contentHash: spec.contentHash,
      normalizedTextHash: spec.normalizedTextHash,
      fallbackUsed: spec.fallbackUsed,
    };
    return spec.screenshotRef === undefined
      ? base
      : { ...base, screenshotRef: spec.screenshotRef };
  });
}

/* -------------------------------------------------------------------------- */
/* Round-trip assertion helpers                                               */
/* -------------------------------------------------------------------------- */

/**
 * Assert one artifact's identifiers round-tripped to persistence: the persisted
 * file id / url / key equal the returned identifiers (and are non-empty — both
 * url AND key plus the file id), the parent folder is the type-matched
 * subfolder, and the quad is exactly one the Box adapter handed back.
 */
function expectRoundTrip(
  ids: ArtifactIdentifiers | undefined,
  persisted: {
    fileId?: string | null;
    url?: string | null;
    key?: string | null;
  },
  expectedFolderId: string,
  boxResults: BoxUploadResult[],
): void {
  expect(ids).toBeDefined();
  const returned = ids!;

  // Round-trip: reading the snapshot back yields the SAME identifiers (Req 10.3).
  expect(persisted.fileId).toBe(returned.fileId);
  expect(persisted.url).toBe(returned.url);
  expect(persisted.key).toBe(returned.key);

  // Both url AND key are persisted (InsForge convention), plus the Box file id.
  expect(persisted.fileId).toBeTruthy();
  expect(persisted.url).toBeTruthy();
  expect(persisted.key).toBeTruthy();

  // The artifact landed in (and persisted) the type-matched subfolder.
  expect(returned.folderId).toBe(expectedFolderId);

  // The persisted/returned identifiers are exactly what the Box adapter returned.
  expect(
    boxResults.some(
      (r) =>
        r.fileId === returned.fileId &&
        r.folderId === returned.folderId &&
        r.url === returned.url &&
        r.key === returned.key,
    ),
  ).toBe(true);
}

/* -------------------------------------------------------------------------- */
/* Property 13                                                                */
/* -------------------------------------------------------------------------- */

describe("Property 13: Uploaded artifact identifiers round-trip to persistence (Requirements 10.3)", () => {
  it("persists the returned Box identifiers so reading the snapshot back yields the SAME identifiers", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(snapshotSpecArb, { minLength: 1, maxLength: 5 }),
        async (specs) => {
          const repo = new FakeRepo();
          const box = new FakeBox();
          const ctx = makeContext(repo, box);

          const normalized = await seedNormalizedSnapshots(repo, ctx.scanId, specs);

          const result = await uploadSnapshotToBoxStep(ctx, normalized);

          // Every input snapshot is processed and carried forward.
          expect(result.snapshots).toHaveLength(normalized.length);

          const reader = repo.asRepository();
          for (const up of result.snapshots) {
            const stored = await reader.snapshots.get(up.snapshotId);
            expect(stored).not.toBeNull();
            const row = stored!;

            // raw + normalized artifacts always upload successfully here.
            expectRoundTrip(
              up.raw,
              {
                fileId: row.rawBoxFileId,
                url: row.rawArtifactUrl,
                key: row.rawArtifactKey,
              },
              result.folderSet.subfolders.raw,
              box.results,
            );
            expectRoundTrip(
              up.normalized,
              {
                fileId: row.normalizedBoxFileId,
                url: row.normalizedArtifactUrl,
                key: row.normalizedArtifactKey,
              },
              result.folderSet.subfolders.normalized,
              box.results,
            );

            if (up.screenshotRef !== undefined) {
              // A screenshot reference was captured -> its ids round-trip too.
              expectRoundTrip(
                up.screenshot,
                {
                  fileId: row.screenshotBoxFileId,
                  url: row.screenshotArtifactUrl,
                  key: row.screenshotArtifactKey,
                },
                result.folderSet.subfolders.screenshots,
                box.results,
              );
            } else {
              // No screenshot reference -> no screenshot identifiers persisted.
              expect(up.screenshot).toBeUndefined();
              expect(row.screenshotBoxFileId ?? null).toBeNull();
              expect(row.screenshotArtifactUrl ?? null).toBeNull();
              expect(row.screenshotArtifactKey ?? null).toBeNull();
            }
          }
        },
      ),
      pbtParams(),
    );
  });

  it("persists no screenshot identifiers for snapshots captured without a screenshot reference", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          snapshotSpecArb.map((spec) => ({ ...spec, screenshotRef: undefined })),
          { minLength: 1, maxLength: 5 },
        ),
        async (specs) => {
          const repo = new FakeRepo();
          const box = new FakeBox();
          const ctx = makeContext(repo, box);

          const normalized = await seedNormalizedSnapshots(repo, ctx.scanId, specs);
          const result = await uploadSnapshotToBoxStep(ctx, normalized);

          const reader = repo.asRepository();
          for (const up of result.snapshots) {
            const row = (await reader.snapshots.get(up.snapshotId))!;

            // raw + normalized still round-trip.
            expect(row.rawBoxFileId).toBe(up.raw?.fileId);
            expect(row.rawArtifactUrl).toBe(up.raw?.url);
            expect(row.rawArtifactKey).toBe(up.raw?.key);
            expect(row.normalizedBoxFileId).toBe(up.normalized?.fileId);

            // No screenshot artifact was uploaded or persisted.
            expect(up.screenshot).toBeUndefined();
            expect(row.screenshotBoxFileId ?? null).toBeNull();
            expect(row.screenshotArtifactUrl ?? null).toBeNull();
            expect(row.screenshotArtifactKey ?? null).toBeNull();
          }
          // Exactly two artifacts (raw + normalized) per snapshot were uploaded.
          expect(box.uploads).toHaveLength(specs.length * 2);
        },
      ),
      pbtParams(),
    );
  });

  it("runs each property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
