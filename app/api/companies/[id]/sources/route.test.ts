import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_COMPANY_ID } from "@/lib/adapters/insforge/demo-store";

import { POST } from "./route";

/**
 * Tests for `POST /api/companies/:id/sources` (Requirements 5.6, 5.7) and its
 * scope-check / validation behavior (Requirements 1.5, 21.7).
 *
 * Exercises the REAL guard + seeded demo InsForge repository (no mocks). Each
 * `DemoInsForgeClient` owns its own in-memory store, so persistence assertions
 * observe the created row in the response rather than across requests.
 */

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

beforeEach(() => {
  process.env.DEMO_MODE = "true";
});

afterEach(() => {
  if (ORIGINAL_DEMO_MODE === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  }
});

function postSource(id: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://test/api/companies/${id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: { id } },
  );
}

describe("POST /api/companies/:id/sources", () => {
  it("persists a valid watched source and returns 201 with the created row (Req 5.6)", async () => {
    const res = await postSource(DEMO_COMPANY_ID, {
      url: "https://acme.ai/security",
      sourceType: "trust",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source.companyId).toBe(DEMO_COMPANY_ID);
    expect(body.source.url).toBe("https://acme.ai/security");
    expect(body.source.sourceType).toBe("trust");
    expect(typeof body.source.id).toBe("string");
    expect(body.source.id.length).toBeGreaterThan(0);
  });

  it("rejects an invalid http(s) URL with 400 VALIDATION and field=url (Req 5.7)", async () => {
    const res = await postSource(DEMO_COMPANY_ID, {
      url: "ftp://acme.ai/not-http",
      sourceType: "trust",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("url");
  });

  it("rejects a non-URL string with 400 VALIDATION and field=url (Req 5.7)", async () => {
    const res = await postSource(DEMO_COMPANY_ID, {
      url: "not a url",
      sourceType: "pricing",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("url");
  });

  it("rejects an invalid source type with 400 VALIDATION and field=sourceType", async () => {
    const res = await postSource(DEMO_COMPANY_ID, {
      url: "https://acme.ai/blog",
      sourceType: "newsletter",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.field).toBe("sourceType");
  });

  it("returns 404 NOT_FOUND for a company outside the active workspace and creates nothing (Req 1.5)", async () => {
    const res = await postSource("00000000-0000-0000-0000-000000000000", {
      url: "https://acme.ai/security",
      sourceType: "trust",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(Object.keys(body)).toEqual(["error"]);
  });

  it("treats a malformed JSON body as 400 VALIDATION", async () => {
    const res = await postSource(DEMO_COMPANY_ID, "{not json");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
  });
});
