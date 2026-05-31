// Feature: signalvault, Property 5: Valid Add Company creates one company and one source per URL
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  InMemoryInsForgeClient,
  TEST_WORKSPACE_ID,
} from "@/tests/fixtures/in-memory-insforge";
import type { WorkspaceRepository } from "@/lib/adapters/types";
import { SourceTypeEnum, type SourceType } from "@/lib/schemas";
import { MIN_URLS, MAX_URLS, NAME_MAX } from "@/lib/schemas/company";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { createCompany } from "./companies";

/**
 * Property 5 (Validates: Requirements 4.1, 4.2, 4.7):
 *
 * For ANY valid Add Company submission — a name of 1–200 characters (non-blank
 * after trim), a syntactically valid hostname domain, and 3–5 distinct valid
 * HTTP/HTTPS URLs each assigned a source type — `createCompany` produces
 * EXACTLY ONE company record and EXACTLY ONE watched-source record per submitted
 * URL in the active workspace, with each source carrying its submitted source
 * type (Req 4.1, 4.2). Watched_Sources exist only because the company was
 * created successfully (Req 4.7).
 *
 * This tests the VALID path only, so every generated submission is constrained
 * to satisfy `AddCompanyFormSchema`: URLs are made unique within a submission
 * (no duplicate-URL rejection, Req 4.6) and the domain is a real hostname (no
 * domain rejection, Req 4.5).
 *
 * Each property runs against a FRESH, un-seeded in-memory workspace repository
 * (the in-memory InsForge store) — no mocks — so "exactly one company" is asserted
 * against an empty starting state, end to end through the same repository
 * surface the live client implements.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** A fresh, empty (un-seeded) workspace repository for each generated case. */
function emptyRepo(): WorkspaceRepository {
  const client = new InMemoryInsForgeClient();
  return client.scoped(TEST_WORKSPACE_ID);
}

/** Lowercase alphanumeric DNS-label / path-segment characters. */
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

/** A 1–20 char alphanumeric token (valid DNS label; safe URL path segment). */
const alnumTokenArb = (maxLength = 20): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: maxLength })
    .map((chars) => chars.join(""));

/**
 * A syntactically valid hostname `label(.label)*.tld` whose labels are pure
 * alphanumerics (so they always start/end alphanumeric, matching the schema's
 * hostname rule). Sometimes includes a subdomain for variety.
 */
const domainArb: fc.Arbitrary<string> = fc
  .tuple(
    alnumTokenArb(20),
    fc.option(alnumTokenArb(20), { nil: undefined }),
    fc.constantFrom("com", "io", "ai", "dev", "net", "org", "co", "example"),
  )
  .map(([label, sub, tld]) =>
    sub === undefined ? `${label}.${tld}` : `${sub}.${label}.${tld}`,
  );

/**
 * A non-blank-after-trim name of at most 200 characters. `minLength: 1` /
 * `maxLength: NAME_MAX` bounds the raw length (so the trimmed length never
 * exceeds 200); the filter drops the rare all-whitespace string so the name
 * stays non-blank (Req 4.5's valid side).
 */
const nameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: NAME_MAX })
  .filter((s) => s.trim().length >= 1);

/** Every source type, so submissions span the full SourceType enum (Req 4.2). */
const sourceTypeArb: fc.Arbitrary<SourceType> = fc.constantFrom(
  ...SourceTypeEnum.options,
);

/** Per-row spec: scheme + path token + source type (URL host comes from the body). */
const rowSpecArb = fc.record({
  proto: fc.constantFrom("http", "https"),
  seg: alnumTokenArb(12),
  sourceType: sourceTypeArb,
});

/** A submitted URL row as accepted by `createCompany`. */
interface UrlRow {
  url: string;
  sourceType: SourceType;
}

/** A valid Add Company body: name, domain, and 3–5 unique http(s) URL rows. */
interface ValidBody {
  name: string;
  domain: string;
  urls: UrlRow[];
}

/**
 * Generate a fully valid Add Company body. The URL count varies over 3..5; each
 * URL is built as `${proto}://${host}/${seg}-${i}`, and the per-row `-${i}`
 * suffix guarantees the URLs are unique within the submission (so the
 * duplicate-URL rule, Req 4.6, never trips on this valid path). Source types
 * vary across the enum, independently per row.
 */
const validBodyArb: fc.Arbitrary<ValidBody> = fc
  .tuple(
    nameArb,
    domainArb,
    domainArb, // host for the URLs (any valid hostname)
    fc.integer({ min: MIN_URLS, max: MAX_URLS }),
    fc.array(rowSpecArb, { minLength: MAX_URLS, maxLength: MAX_URLS }),
  )
  .map(([name, domain, host, count, specs]) => ({
    name,
    domain,
    urls: specs.slice(0, count).map((s, i) => ({
      url: `${s.proto}://${host}/${s.seg}-${i}`,
      sourceType: s.sourceType,
    })),
  }));

describe("Property 5: valid Add Company creates one company and one source per URL (Requirements 4.1, 4.2, 4.7)", () => {
  it("creates exactly one company and exactly one source per submitted URL, each with its source type", async () => {
    await fc.assert(
      fc.asyncProperty(validBodyArb, async (body) => {
        // Fresh, empty workspace per case so "exactly one company" is exact.
        const repo = emptyRepo();

        const result = await createCompany(repo, body);

        // (1) The valid submission succeeds.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // (2) Exactly ONE company created — both in the result and persisted.
        expect(result.company).toBeDefined();
        expect(result.company.id).toBeTruthy();
        expect(await repo.companies.list()).toHaveLength(1);

        // (3) Exactly one source per URL, one-to-one with the submitted rows,
        //     each carrying its submitted source type, all under this company.
        expect(result.sources).toHaveLength(body.urls.length);

        const submitted = new Map<string, SourceType>(
          body.urls.map((row) => [row.url, row.sourceType]),
        );
        const matched = new Set<string>();
        for (const source of result.sources) {
          expect(source.companyId).toBe(result.company.id);
          // Each created source corresponds to a submitted URL...
          expect(submitted.has(source.url)).toBe(true);
          // ...and carries that row's source type (Req 4.2).
          expect(source.sourceType).toBe(submitted.get(source.url));
          // ...and no submitted URL is matched twice (one-to-one).
          expect(matched.has(source.url)).toBe(false);
          matched.add(source.url);
        }
        // Every submitted URL is covered exactly once.
        expect(matched.size).toBe(body.urls.length);

        // (4) Persisted: one watched_source per URL under the new company.
        const persisted = await repo.companies.listSources(result.company.id);
        expect(persisted).toHaveLength(body.urls.length);
      }),
      pbtParams(),
    );
  });

  it("runs the property at least 100 times", () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
