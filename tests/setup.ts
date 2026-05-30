import "@testing-library/jest-dom/vitest";
import fc from "fast-check";

/**
 * Minimum number of iterations every property-based test must run.
 * Per design.md "Property-Based Testing": each property runs a minimum of 100 iterations.
 */
export const PBT_MIN_RUNS = 100;

// Apply the minimum-iterations contract globally so every fast-check
// property in the suite runs at least PBT_MIN_RUNS times unless a test
// explicitly opts into more.
fc.configureGlobal({ numRuns: PBT_MIN_RUNS });
