// Feature: signalvault, Property 4: Dashboard ordering is case-insensitive ascending and lossless
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  InMemoryInsForgeClient,
  TEST_WORKSPACE_ID,
} from "@/tests/fixtures/in-memory-insforge";
import type { SourceType } from "@/lib/schemas";
import type { WorkspaceRepository } from "@/lib/adapters/types";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { createCompany, listCompanies } from "./companies";

/**
 * Property 4 (Validates: Requirements 3.1):
 *
 * For ANY set of companies created in a workspace, `listCompanies(repo)`:
 *   - ORDERING: returns them ordered case-insensitively ascending by name —
 *     i.e. for every consecutive pair (a, b) the impl's own comparison key
 *     holds, `a.name.toLowerCase() <= b.name.toLowerCase()` (the impl lowercases
 *     and compares, tiebreaking by id), and
 *   - LOSSLESS: returns the SAME multiset of companies it was given — every
 *     created company id appears exactly once, with none added and none
 *     dropped.
 *
 * The property is driven against a REAL in-memory workspace repository (the
 * un-seeded in-memory InsForge store) — no mocks — so creation and listing flow
 * through the same `WorkspaceRepository` surface the live client implements.
 *
 * Names are generated adversarially for case-insensitive ordering: pairs that
 * differ only by case (e.g. "banana"/"Banana"), mixed/UPPER/lower casing,
 * leading/trailing whitespace (trimmed on persist), unicode, and the same
 * trimmed name reused as distinct companies (duplicates-as-distinct). Each URL
 * set per company is valid (3–5 unique http(s) URLs, each with a source type)
 * so creation ALWAYS succeeds and the ordering/lossless behavior is what's
 * exercised.
 *
 * Each property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** A fresh, empty (un-seeded) workspace repository. */
function emptyRepo(): WorkspaceRepository {
  const client = new InMemoryInsForgeClient();
  return client.scoped(TEST_WORKSPACE_ID);
}

/** Source-type roles used to build per-company URL rows (≥ 5 so count 3–5 fits). */
const ROLES: readonly SourceType[] = [
  "homepage",
  "pricing",
  "docs",
  "changelog",
  "trust",
];

/**
 * Build a VALID Add Company body for `name`. URLs are made unique BOTH within
 * the company (distinct roles) and across companies (the per-company `index` in
 * the path), so the schema's 3–5-unique-URL rule always passes regardless of
 * how many companies are created.
 */
function validBody(name: string, index: number, urlCount: number) {
  return {
    name,
    domain: "company.example",
    urls: Array.from({ length: urlCount }, (_, i) => ({
      url: `https://company.example/c${index}/${ROLES[i]}`,
      sourceType: ROLES[i]!,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Generators — adversarial casing / whitespace / unicode / duplicates        */
/* -------------------------------------------------------------------------- */

/** Random non-empty word over a tiny dual-case alphabet so lowercase collisions
 *  (names differing only by case) arise frequently. */
const wordArb = fc
  .array(fc.constantFrom(..."abABcdCDxyXYzZ".split("")), {
    minLength: 1,
    maxLength: 10,
  })
  .map((chars) => chars.join(""));

/** Hand-picked adversarial names: case-only pairs, UPPER/lower, padded
 *  whitespace (trimmed on persist), and unicode. */
const fixedNameArb = fc.constantFrom(
  "apple",
  "Apple",
  "APPLE",
  "banana",
  "Banana",
  "BANANA",
  "apricot",
  "APRICOT",
  "  spaced name  ",
  "Ünïçødé",
  "ünïçødé",
  "Zürich",
  "zürich",
);

/** A company spec: its (pre-trim) name and how many URLs to attach (3–5). */
const specArb = fc.record({
  name: fc.oneof(wordArb, fixedNameArb),
  urlCount: fc.integer({ min: 3, max: 5 }),
});

/** 1–12 companies so the case-insensitive ordering is genuinely exercised. */
const specsArb = fc.array(specArb, { minLength: 1, maxLength: 12 });

type Spec = { name: string; urlCount: number };

/** An explicit adversarial example always run alongside the random cases: it
 *  mixes "apple"/"Banana"/"banana"/"APRICOT" plus a padded duplicate-as-distinct. */
const ADVERSARIAL_EXAMPLE: Spec[] = [
  { name: "apple", urlCount: 3 },
  { name: "Banana", urlCount: 4 },
  { name: "banana", urlCount: 3 },
  { name: "APRICOT", urlCount: 5 },
  { name: "  Cherry  ", urlCount: 3 },
  { name: "cherry", urlCount: 4 },
];

describe("Property 4: dashboard ordering is case-insensitive ascending and lossless (Req 3.1)", () => {
  it("orders companies case-insensitively ascending and loses none", async () => {
    await fc.assert(
      fc.asyncProperty(specsArb, async (specs) => {
        const repo = emptyRepo();

        // Create each company; creation must always succeed for valid bodies.
        const createdIds: string[] = [];
        for (let i = 0; i < specs.length; i++) {
          const result = await createCompany(
            repo,
            validBody(specs[i]!.name, i, specs[i]!.urlCount),
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return; // narrows the union; never taken in practice
          createdIds.push(result.company.id);
        }

        const { companies } = await listCompanies(repo);

        // 1) ORDERING — consecutive returned names are non-decreasing under the
        //    impl's own key (lowercase compare, tiebreak by id).
        for (let i = 1; i < companies.length; i++) {
          const prev = companies[i - 1]!.name.toLowerCase();
          const curr = companies[i]!.name.toLowerCase();
          expect(prev <= curr).toBe(true);
        }

        // 2) LOSSLESS — same multiset of ids: same size, every created id
        //    present exactly once, no extras.
        expect(companies.length).toBe(createdIds.length);

        const returnedIds = companies.map((c) => c.id);
        expect([...returnedIds].sort()).toEqual([...createdIds].sort());

        const counts = new Map<string, number>();
        for (const id of returnedIds) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const id of createdIds) {
          expect(counts.get(id)).toBe(1);
        }
        expect(counts.size).toBe(createdIds.length);
      }),
      pbtParams({ numRuns: PBT_MIN_RUNS, examples: [[ADVERSARIAL_EXAMPLE]] }),
    );
  });
});
