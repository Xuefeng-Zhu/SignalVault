import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  API_ERROR_STATUS,
  apiErrorBody,
  errorResponse,
  jsonError,
  jsonOk,
  jsonResponse,
  parseJsonBody,
  type ApiError,
} from "./errors";

describe("apiErrorBody", () => {
  it("builds the canonical envelope without a field by default", () => {
    expect(apiErrorBody("NOT_FOUND", "Scan not found.")).toEqual({
      error: { code: "NOT_FOUND", message: "Scan not found." },
    } satisfies ApiError);
  });

  it("includes the field only when provided", () => {
    expect(apiErrorBody("VALIDATION", "bad", "id")).toEqual({
      error: { code: "VALIDATION", message: "bad", field: "id" },
    });
  });
});

describe("errorResponse (Web Response)", () => {
  it("maps each code to its design-specified HTTP status", async () => {
    const expected: Record<keyof typeof API_ERROR_STATUS, number> = {
      VALIDATION: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INTERNAL: 500,
    };
    for (const [code, status] of Object.entries(expected)) {
      const res = errorResponse(code as keyof typeof expected, "msg");
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: { code, message: "msg" } });
    }
  });

  it("carries the field through to the JSON body", async () => {
    const res = errorResponse("VALIDATION", "A scan id is required.", "id");
    expect(await res.json()).toEqual({
      error: { code: "VALIDATION", message: "A scan id is required.", field: "id" },
    });
  });
});

describe("jsonResponse (Web Response)", () => {
  it("returns 200 with a JSON body by default", async () => {
    const res = jsonResponse({ hello: "world" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("honors a custom status", () => {
    expect(jsonResponse({}, 201).status).toBe(201);
  });
});

describe("jsonError / jsonOk (NextResponse)", () => {
  it("jsonError maps the status and emits the envelope", async () => {
    const res = jsonError("UNAUTHORIZED", "nope");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "nope" } });
  });

  it("jsonOk returns the body with the chosen status", async () => {
    const res = jsonOk({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns the validated data on a valid body", async () => {
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ name: "ok" }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ name: "ok" });
  });

  it("returns a 400 VALIDATION response naming the offending field", async () => {
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error.code).toBe("VALIDATION");
      expect(body.error.field).toBe("name");
    }
  });

  it("treats a malformed body as a 400 VALIDATION error, not a throw", async () => {
    const req = new Request("http://test", { method: "POST", body: "not-json" });
    const result = await parseJsonBody(req, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});
