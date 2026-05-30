// Feature: signalvault, Property 29: Schema validation gates step and agent consumption
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";

import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

import { StepBoundaryError, parseAtBoundary } from "./artifacts";

/**
 * Property 29 (Validates: Requirements 23.5, 23.6):
 *
 * Schema validation at every step boundary acts as a gate: invalid data (wrong
 * type, missing field, out-of-range value) MUST NOT pass through. Specifically:
 *
 *  - `parseAtBoundary` MUST throw `StepBoundaryError` for any value that does
 *    not satisfy the schema.
 *  - `parseAtBoundary` MUST return the parsed value for any conforming input.
 *
 * This property runs over arbitrary objects, primitives, and randomly mutated
 * valid values to verify the gate holds in both directions.
 */

describe("Property 29: schema validation gates step consumption", () => {
  it("parseAtBoundary throws StepBoundaryError for invalid input", () => {
    const schema = z.object({
      scanId: z.string().uuid(),
      confidence: z.number().int().min(0).max(100),
    });

    fc.assert(
      fc.property(
        // Generate things that are definitely NOT a valid { scanId: uuid, confidence: 0-100 }
        fc.oneof(
          fc.string().filter((s) => !z.string().uuid().safeParse(s).success),
          fc.integer({ min: 101, max: 9999 }), // out-of-range confidence
          fc.constant(null),
          fc.constant(undefined),
          fc.constant({}),
          fc.record({ scanId: fc.constant("not-a-uuid"), confidence: fc.constant(-1) }),
        ),
        (invalid) => {
          expect(() =>
            parseAtBoundary(schema, invalid, "test boundary"),
          ).toThrow(StepBoundaryError);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("parseAtBoundary returns valid value for conforming input", () => {
    const schema = z.object({
      scanId: z.string().uuid(),
      confidence: z.number().int().min(0).max(100),
    });

    fc.assert(
      fc.property(
        fc.record({
          scanId: fc.uuid(),
          confidence: fc.integer({ min: 0, max: 100 }),
        }),
        (valid) => {
          const result = parseAtBoundary(schema, valid, "test boundary");
          expect(result).toEqual(valid);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("StepBoundaryError names the failing boundary and field", () => {
    const schema = z.object({
      value: z.number().int().min(0).max(10),
    });

    expect(() => parseAtBoundary(schema, { value: 999 }, "myStep input")).toThrow(
      StepBoundaryError,
    );

    try {
      parseAtBoundary(schema, { value: 999 }, "myStep input");
    } catch (err) {
      expect(err).toBeInstanceOf(StepBoundaryError);
      expect((err as StepBoundaryError).message).toContain("myStep input");
    }
  });

  it("nested required fields: missing required field is rejected", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          // Intentionally omit required `status` field
        }),
        (partial) => {
          const schema = z.object({
            id: z.string().uuid(),
            status: z.string().min(1),
          });
          // Input missing `status` is invalid.
          expect(() =>
            parseAtBoundary(schema, partial, "missing-field boundary"),
          ).toThrow(StepBoundaryError);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });
});
