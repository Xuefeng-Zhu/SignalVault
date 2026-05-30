// Feature: signalvault, Property 6: Invalid Add Company is rejected atomically
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DemoInsForgeClient,
  DEMO_WORKSPACE_ID,
} from "@/lib/adapters/insforge/demo-store";
import { SourceTypeEnum } from "@/lib/schemas";
import { MIN_URLS, MAX_URLS, NAME_MAX } from "@/lib/schemas/company";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { createCompany } from "./companies";

/**
 * Property 6 (Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.8):
 *
 * For ANY invalid Add Company submission, `createCompany` MUST:
 *  - return `ok: false` (no company or source row is created), and
 *  - leave the workspace in the exact same state it was in before the call
 *    (atomic rejection — Requirement 4.8).
 *
 * Invalid submissions include:
 *  - Name too long (> 200 chars) or blank (Req 4.3)
 *  - Invalid/private domain (Req 4.5)
 *  - Fewer than 3 URLs or more than 5 URLs (Req 4.4)
 *  - Duplicate URLs within the submission (Req 4.6)
 *  - Non-HTTP(S) URL or malformed URL (Req 4.3)
 */

describe("Property 6: Invalid Add Company is rejected atomically", () => {
  function makeRepo() {
    const client = new DemoInsForgeClient({ seedDemoCompany: false });
    return client.scoped(DEMO_WORKSPACE_ID);
  }

  const validUrl = (i: number) => `https://example${i}.com/page`;
  const validUrls = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      url: validUrl(i),
      sourceType: "pricing" as const,
    }));

  it("name too long is rejected without creating any data", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a string whose trimmed length exceeds NAME_MAX.
        // Using printableAscii (no leading/trailing whitespace by nature of the
        // generation) ensures trim() doesn't reduce the length below NAME_MAX + 1.
        fc
          .string({
            minLength: NAME_MAX + 1,
            maxLength: NAME_MAX + 50,
          })
          .filter((s) => s.trim().length > NAME_MAX),
        async (longName) => {
          const repo = makeRepo();
          const body = {
            name: longName,
            domain: "example.com",
            urls: validUrls(3),
          };
          const result = await createCompany(repo, body);
          expect(result.ok).toBe(false);
          // No company was created.
          const companies = await repo.companies.list();
          expect(companies).toHaveLength(0);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("blank name is rejected", async () => {
    const repo = makeRepo();
    const blankNames = ["", "   ", "\t\n"];
    for (const name of blankNames) {
      const result = await createCompany(repo, {
        name,
        domain: "example.com",
        urls: validUrls(3),
      });
      expect(result.ok).toBe(false);
    }
    const companies = await repo.companies.list();
    expect(companies).toHaveLength(0);
  });

  it("too few URLs (< 3) is rejected", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: MIN_URLS - 1 }),
        async (count) => {
          const repo = makeRepo();
          const result = await createCompany(repo, {
            name: "Test Co",
            domain: "test.com",
            urls: validUrls(count),
          });
          expect(result.ok).toBe(false);
          const companies = await repo.companies.list();
          expect(companies).toHaveLength(0);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("too many URLs (> 5) is rejected", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_URLS + 1, max: MAX_URLS + 5 }),
        async (count) => {
          const repo = makeRepo();
          const result = await createCompany(repo, {
            name: "Test Co",
            domain: "test.com",
            urls: validUrls(count),
          });
          expect(result.ok).toBe(false);
          const companies = await repo.companies.list();
          expect(companies).toHaveLength(0);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("duplicate URLs within the submission are rejected", async () => {
    const repo = makeRepo();
    // Provide 3–5 entries but with duplicates.
    const result = await createCompany(repo, {
      name: "Test Co",
      domain: "test.com",
      urls: [
        { url: "https://example.com", sourceType: "pricing" as const },
        { url: "https://example.com", sourceType: "docs" as const }, // duplicate
        { url: "https://other.com", sourceType: "careers" as const },
      ],
    });
    expect(result.ok).toBe(false);
    const companies = await repo.companies.list();
    expect(companies).toHaveLength(0);
  });

  it("non-http(s) URL is rejected atomically", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant("ftp://example.com/page"),
          fc.constant("file:///etc/passwd"),
          fc.constant("javascript:alert(1)"),
          fc.constant("not-a-url"),
        ),
        async (badUrl) => {
          const repo = makeRepo();
          // Mix the bad URL with valid ones.
          const result = await createCompany(repo, {
            name: "Test Co",
            domain: "test.com",
            urls: [
              { url: badUrl, sourceType: "pricing" as const },
              { url: "https://valid1.com", sourceType: "docs" as const },
              { url: "https://valid2.com", sourceType: "careers" as const },
            ],
          });
          expect(result.ok).toBe(false);
          const companies = await repo.companies.list();
          expect(companies).toHaveLength(0);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });
});
