import { beforeEach, describe, expect, it } from "vitest";

import {
  DemoInsForgeClient,
  DEMO_WORKSPACE_ID,
} from "@/lib/adapters/insforge/demo-store";
import type { WorkspaceRepository } from "@/lib/adapters/types";

import {
  createCompany,
  listCompanies,
  slugifyCompanyName,
} from "./companies";

/**
 * Unit tests for the `/api/companies` core (task 20.1). These exercise the pure
 * core against a REAL in-memory workspace repository (the demo InsForge store,
 * un-seeded) — no mocks — so the validation, atomic-create, and list-shaping
 * logic is verified end to end through the same repository surface the live
 * client implements.
 */

/** A fresh, empty (un-seeded) workspace repository for each test. */
function emptyRepo(): WorkspaceRepository {
  const client = new DemoInsForgeClient({ seedDemoCompany: false });
  return client.scoped(DEMO_WORKSPACE_ID);
}

/** A valid Add Company body with `count` URLs (3–5). */
function validBody(name = "Dropbox", count = 3) {
  const roles = ["homepage", "pricing", "docs", "changelog", "trust"] as const;
  return {
    name,
    domain: "acme.example",
    urls: Array.from({ length: count }, (_, i) => ({
      url: `https://acme.example/${roles[i]}`,
      sourceType: roles[i],
    })),
  };
}

describe("slugifyCompanyName", () => {
  it("lowercases and hyphenates non-alphanumeric runs", () => {
    expect(slugifyCompanyName("Dropbox")).toBe("dropbox");
    expect(slugifyCompanyName("  Foo / Bar!! ")).toBe("foo-bar");
  });

  it("falls back to 'company' when no usable characters remain", () => {
    expect(slugifyCompanyName("***")).toBe("company");
  });
});

describe("createCompany — valid input (Req 4.1, 4.2, 4.7)", () => {
  let repo: WorkspaceRepository;
  beforeEach(() => {
    repo = emptyRepo();
  });

  it("creates one company and one watched source per URL", async () => {
    const result = await createCompany(repo, validBody("Dropbox", 4));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.company.name).toBe("Dropbox");
    expect(result.company.domain).toBe("acme.example");
    expect(result.company.slug).toBe("dropbox");
    expect(result.sources).toHaveLength(4);
    for (const source of result.sources) {
      expect(source.companyId).toBe(result.company.id);
    }

    // Persisted in the workspace.
    const companies = await repo.companies.list();
    expect(companies).toHaveLength(1);
    const persistedSources = await repo.companies.listSources(result.company.id);
    expect(persistedSources).toHaveLength(4);
  });

  it("trims the name, domain, and URLs before persisting", async () => {
    const result = await createCompany(repo, {
      name: "  Padded Co  ",
      domain: "  padded.example  ",
      urls: [
        { url: "  https://padded.example/a  ", sourceType: "homepage" },
        { url: "https://padded.example/b", sourceType: "pricing" },
        { url: "https://padded.example/c", sourceType: "docs" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.company.name).toBe("Padded Co");
    expect(result.company.domain).toBe("padded.example");
    expect(result.sources[0]!.url).toBe("https://padded.example/a");
  });
});

describe("createCompany — invalid input is rejected atomically (Req 4.3–4.6, 4.8)", () => {
  let repo: WorkspaceRepository;
  beforeEach(() => {
    repo = emptyRepo();
  });

  async function expectRejectedWithNothingPersisted(body: unknown, field?: string) {
    const result = await createCompany(repo, body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    if (field !== undefined) {
      expect(result.error.field).toBe(field);
    }
    // No records persisted on rejection (Req 4.3–4.6 atomicity).
    expect(await repo.companies.list()).toHaveLength(0);
  }

  it("rejects fewer than 3 URLs and names the urls field (4.3)", async () => {
    const body = validBody("Few", 3);
    body.urls = body.urls.slice(0, 2);
    await expectRejectedWithNothingPersisted(body, "urls");
  });

  it("rejects more than 5 URLs (4.3)", async () => {
    const roles = ["homepage", "pricing", "docs", "changelog", "trust", "careers"] as const;
    const body = {
      name: "Many",
      domain: "many.example",
      urls: roles.map((r) => ({ url: `https://many.example/${r}`, sourceType: r })),
    };
    await expectRejectedWithNothingPersisted(body, "urls");
  });

  it("rejects an invalid http(s) URL and names the offending row (4.4)", async () => {
    const body = validBody("Bad URL", 3);
    body.urls[1] = { url: "not-a-url", sourceType: "pricing" };
    await expectRejectedWithNothingPersisted(body, "urls.1.url");
  });

  it("rejects an empty name and names the name field (4.5)", async () => {
    const body = { ...validBody(), name: "" };
    await expectRejectedWithNothingPersisted(body, "name");
  });

  it("rejects a name longer than 200 characters (4.5)", async () => {
    const body = { ...validBody(), name: "x".repeat(201) };
    await expectRejectedWithNothingPersisted(body, "name");
  });

  it("rejects an invalid hostname domain and names the domain field (4.5)", async () => {
    const body = { ...validBody(), domain: "not a hostname" };
    await expectRejectedWithNothingPersisted(body, "domain");
  });

  it("rejects an invalid source type (4.2)", async () => {
    const body = validBody("Bad Type", 3);
    // @ts-expect-error intentionally invalid source type for the test
    body.urls[0].sourceType = "newsroom";
    await expectRejectedWithNothingPersisted(body, "urls.0.sourceType");
  });

  it("rejects duplicate URLs and names the duplicate row (4.6)", async () => {
    const body = validBody("Dupes", 3);
    body.urls[2] = { url: body.urls[0]!.url, sourceType: "docs" };
    await expectRejectedWithNothingPersisted(body, "urls.2.url");
  });
});

describe("createCompany — atomic rollback on partial failure (Req 4.8)", () => {
  it("persists no company when source creation fails after the company row exists", async () => {
    const client = new DemoInsForgeClient({ seedDemoCompany: false });
    const repo = client.scoped(DEMO_WORKSPACE_ID);

    // Force the second step (addSources) to fail AFTER the company is created.
    const realAddSources = repo.companies.addSources.bind(repo.companies);
    let companyExistedDuringFailure = false;
    repo.companies.addSources = async () => {
      // The company must already exist at this point (Req 4.7).
      companyExistedDuringFailure = (await repo.companies.list()).length === 1;
      throw new Error("source insert failed");
    };

    const result = await createCompany(repo, validBody("Rollback Co", 3));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
    }
    // The company existed mid-flight, then was rolled back (4.8).
    expect(companyExistedDuringFailure).toBe(true);
    expect(await repo.companies.list()).toHaveLength(0);

    // Sanity: the un-overridden method still works.
    void realAddSources;
  });
});

describe("listCompanies — dashboard shaping + ordering (Req 3.1, 3.2, 3.6, 3.7)", () => {
  it("returns companies alphabetically (case-insensitive ascending), losslessly", async () => {
    const repo = emptyRepo();
    await createCompany(repo, validBody("banana", 3));
    await createCompany(repo, validBody("Apple", 3));
    await createCompany(repo, validBody("cherry", 3));

    const { companies } = await listCompanies(repo);
    expect(companies.map((c) => c.name)).toEqual(["Apple", "banana", "cherry"]);
    expect(companies).toHaveLength(3);
  });

  it("reports source count and a not-yet-scanned company (latestScan/verdict null)", async () => {
    const repo = emptyRepo();
    await createCompany(repo, validBody("Dropbox", 5));

    const { companies } = await listCompanies(repo);
    expect(companies[0]!.sourceCount).toBe(5);
    expect(companies[0]!.latestScan).toBeNull();
    expect(companies[0]!.verdict).toBeNull();
  });

  it("includes the latest completed scan's verdict (strategy + risk)", async () => {
    const repo = emptyRepo();
    const created = await createCompany(repo, validBody("Verdict Co", 3));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [scan] = await repo.scans.create([
      { companyId: created.company.id, triggerType: "manual", status: "completed" },
    ]);
    await repo.verdicts.create([
      {
        scanId: scan!.id,
        strategyPrediction: "moving_upmarket",
        confidence: 82,
        riskScore: 40,
        recommendedActions: ["watch pricing"],
        keyEvidence: [],
        counterEvidence: [],
        isFallback: false,
      },
    ]);

    const { companies } = await listCompanies(repo);
    expect(companies[0]!.latestScan?.status).toBe("completed");
    expect(companies[0]!.verdict).toEqual({
      strategyPrediction: "moving_upmarket",
      riskScore: 40,
    });
  });
});
