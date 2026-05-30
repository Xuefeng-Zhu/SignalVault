import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cn } from "@/lib/utils";
import { PBT_MIN_RUNS } from "./setup";

describe("test harness smoke test", () => {
  it("runs basic assertions", () => {
    expect(1 + 1).toBe(2);
  });

  it("provides the jsdom environment", () => {
    // jsdom exposes a DOM document; this fails under the node environment.
    expect(typeof document).toBe("object");
    const el = document.createElement("div");
    el.textContent = "signalvault";
    expect(el.textContent).toBe("signalvault");
  });

  it("enforces the global fast-check minimum iteration count", () => {
    expect(fc.readConfigureGlobal().numRuns).toBe(PBT_MIN_RUNS);
  });

  it("resolves the @/* path alias in tests", () => {
    // Imported via "@/lib/utils" -> verifies tsconfig path alias resolution.
    expect(cn("a", "b")).toBe("a b");
  });

  it("verifies a trivial fast-check property", () => {
    // Addition is commutative over integers.
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
    );
  });
});
