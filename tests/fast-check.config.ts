import type { Parameters as FcParameters } from "fast-check";

/**
 * Minimum number of iterations every property-based test must run.
 * Per design.md "Property-Based Testing": each property runs a minimum of 100 iterations.
 */
export const PBT_MIN_RUNS = 100;

/**
 * Shared fast-check parameters for property tests. `fc.configureGlobal` in
 * tests/setup.ts already enforces this globally, but tests can also pass this
 * explicitly to `fc.assert(..., pbtParams())` to be self-documenting or to
 * override iteration counts per property.
 *
 * The return is generic over the property's argument tuple `Ts` so it stays
 * assignable to `fc.assert`'s `params?: Parameters<Ts>` for any property shape.
 * Call sites invoke it without type arguments; `Ts` is then inferred from the
 * (optional) `overrides`, defaulting to `unknown[]`, and the result is widened
 * to the call's expected `Parameters<Ts>` at the `fc.assert` boundary.
 */
export function pbtParams<Ts extends unknown[] = unknown[]>(
  overrides: Partial<FcParameters<Ts>> = {},
): FcParameters<Ts> {
  return { numRuns: PBT_MIN_RUNS, ...overrides };
}
