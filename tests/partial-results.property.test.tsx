/**
 * Feature: signalvault, Property 26: Partial results render available elements
 * and placeholder the rest.
 *
 * Tests that the CourtroomAnalysis component renders gracefully when some or
 * all result fields are null/undefined — it must not throw and must still
 * render the judge conclusion when one is provided.
 *
 * Requirements: 15.4
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { render } from "@testing-library/react";

import { CourtroomAnalysis } from "@/components/courtroom-analysis";
import { PBT_MIN_RUNS, pbtParams } from "@/tests/fast-check.config";

/**
 * Arbitrary for an optional non-empty string (simulates real analysis text
 * that may or may not be provided for a partial scan result).
 */
const optionalText = fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
  nil: undefined,
  freq: 3,
});

/**
 * Property 26: CourtroomAnalysis renders without throwing for any combination
 * of present/absent defense, prosecution, and judge fields.
 *
 * A partial result is one where some fields were computed (non-null) and others
 * were not. The component must handle every combination, showing the judge
 * conclusion when available and omitting absent sections gracefully.
 */
describe("Property 26: Partial results render available elements without throwing", () => {
  it("renders without throwing for any combination of present/absent fields", () => {
    fc.assert(
      fc.property(
        // Generate all combinations of present/absent analysis fields.
        fc.record({
          defenseArgument: optionalText,
          prosecutionArgument: optionalText,
          judgeConclusion: optionalText,
        }),
        ({ defenseArgument, prosecutionArgument, judgeConclusion }) => {
          const defense = defenseArgument
            ? { argument: defenseArgument }
            : undefined;
          const prosecution = prosecutionArgument
            ? { argument: prosecutionArgument }
            : undefined;
          const judge = judgeConclusion
            ? { conclusion: judgeConclusion }
            : undefined;

          // Must not throw regardless of combination.
          expect(() => {
            render(
              <CourtroomAnalysis
                defense={defense}
                prosecution={prosecution}
                judge={judge}
              />,
            );
          }).not.toThrow();
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("renders judge conclusion when provided even if others are absent", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (conclusion) => {
          const { container } = render(
            <CourtroomAnalysis judge={{ conclusion }} />,
          );
          expect(container.textContent).toContain(conclusion);
        },
      ),
      { ...pbtParams(), numRuns: PBT_MIN_RUNS },
    );
  });

  it("renders with null-like props (all absent) without crashing", () => {
    expect(() => {
      render(
        <CourtroomAnalysis
          defense={null}
          prosecution={null}
          judge={undefined}
        />,
      );
    }).not.toThrow();
  });
});
