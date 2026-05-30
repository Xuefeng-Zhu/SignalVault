// Feature: signalvault, Property 24: Scan creation honors the retry budget
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { withRetry, PERSISTENCE_MAX_ATTEMPTS } from "@/lib/workflow/retry";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

/**
 * Property 24 (Validates: Requirements 6.2, 6.3):
 *
 * Scan creation uses `withRetry` with `PERSISTENCE_MAX_ATTEMPTS` (4 total =
 * 1 initial attempt + 3 retries). This property verifies:
 *
 *  1. When the operation fails `failCount` times then succeeds on the next
 *     attempt, AND `failCount < PERSISTENCE_MAX_ATTEMPTS`, it succeeds and the
 *     attempt count is `failCount + 1`.
 *  2. When the operation fails `PERSISTENCE_MAX_ATTEMPTS` times (every attempt
 *     fails), the result is exhausted with `ok: false` and `attempts` equals
 *     `PERSISTENCE_MAX_ATTEMPTS`.
 *  3. On the first attempt succeeding (failCount = 0), the result has `ok: true`
 *     and `attempts = 1`.
 */
describe("Property 24: Scan creation honors the retry budget", () => {
  it("succeeds within the retry budget when it eventually succeeds", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a number of failures that still leaves at least one attempt.
        fc.integer({ min: 0, max: PERSISTENCE_MAX_ATTEMPTS - 1 }),
        async (failCount) => {
          let callCount = 0;
          const result = await withRetry(async () => {
            callCount += 1;
            if (callCount <= failCount) {
              throw new Error(`simulated failure ${callCount}`);
            }
            return "success";
          }, PERSISTENCE_MAX_ATTEMPTS);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value).toBe("success");
            expect(result.attempts).toBe(failCount + 1);
          }
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("exhausts the budget when every attempt fails", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        let callCount = 0;
        const result = await withRetry(async () => {
          callCount += 1;
          throw new Error(`always fails: attempt ${callCount}`);
        }, PERSISTENCE_MAX_ATTEMPTS);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.attempts).toBe(PERSISTENCE_MAX_ATTEMPTS);
          expect(result.lastError).toContain("always fails");
        }
      }),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("PERSISTENCE_MAX_ATTEMPTS is 4 (1 initial + 3 retries)", () => {
    expect(PERSISTENCE_MAX_ATTEMPTS).toBe(4);
  });

  it("single-attempt success returns attempts=1", async () => {
    const result = await withRetry(async () => "ok", PERSISTENCE_MAX_ATTEMPTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(1);
    }
  });
});
