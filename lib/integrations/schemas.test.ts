import { describe, expect, it } from "vitest";

import {
  ApifyConfigSchema,
  BoxConfigSchema,
  configSchemaFor,
  serializeConfig,
} from "./schemas";

// Unit tests for the integration request schemas + canonical serialization.

describe("ApifyConfigSchema", () => {
  it("accepts a non-empty token", () => {
    expect(ApifyConfigSchema.safeParse({ apifyToken: "tok" }).success).toBe(true);
  });

  it("rejects a missing or empty token", () => {
    expect(ApifyConfigSchema.safeParse({}).success).toBe(false);
    expect(ApifyConfigSchema.safeParse({ apifyToken: "" }).success).toBe(false);
  });

  it("rejects unexpected keys (strict)", () => {
    expect(
      ApifyConfigSchema.safeParse({ apifyToken: "tok", extra: "x" }).success,
    ).toBe(false);
  });
});

describe("BoxConfigSchema", () => {
  it("accepts a developer token", () => {
    expect(
      BoxConfigSchema.safeParse({ developerToken: "dev" }).success,
    ).toBe(true);
  });

  it("accepts a client id + secret pair", () => {
    expect(
      BoxConfigSchema.safeParse({ clientId: "id", clientSecret: "secret" })
        .success,
    ).toBe(true);
  });

  it("rejects a client id without a secret", () => {
    expect(BoxConfigSchema.safeParse({ clientId: "id" }).success).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(BoxConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe("configSchemaFor", () => {
  it("selects the schema by provider", () => {
    expect(configSchemaFor("Apify")).toBe(ApifyConfigSchema);
    expect(configSchemaFor("Box")).toBe(BoxConfigSchema);
  });
});

describe("serializeConfig", () => {
  it("is deterministic regardless of input key order for Box", () => {
    const a = serializeConfig("Box", {
      clientId: "id",
      clientSecret: "secret",
    });
    const b = serializeConfig("Box", {
      clientSecret: "secret",
      clientId: "id",
    });
    expect(a).toBe(b);
  });

  it("serializes the Apify token", () => {
    expect(serializeConfig("Apify", { apifyToken: "tok" })).toBe(
      JSON.stringify({ apifyToken: "tok" }),
    );
  });
});
