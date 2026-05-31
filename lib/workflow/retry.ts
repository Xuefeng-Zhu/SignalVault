/**
 * Small, dependency-free retry helper for persistence operations in the Mastra
 * workflow steps.
 *
 * Box upload persistence must retry up to 3 times and, if every attempt fails,
 * record the failure cause and CONTINUE the workflow without terminating the
 * scan (Requirement 10.4). This helper captures exactly that "try, retry ≤ N,
 * then surface the cause without throwing" shape so the steps stay declarative.
 *
 * It is pure with respect to I/O (it only invokes the supplied async operation)
 * and has no `server-only` guard, so step cores using it remain unit-testable
 * with injected fakes — which the artifact-id persistence round-trip property
 * (task 18.3) relies on.
 */

import { errorMessage } from "./context";

/** Successful outcome: the operation returned a value within the attempt budget. */
export interface RetrySuccess<T> {
  ok: true;
  /** The value returned by the (first) successful attempt. */
  value: T;
  /** How many attempts were made before success (1-based). */
  attempts: number;
}

/** Exhausted outcome: every attempt failed; the last error message is retained. */
export interface RetryExhausted {
  ok: false;
  /** Total number of attempts made (equals `maxAttempts`). */
  attempts: number;
  /** Human-readable message of the last error encountered. */
  lastError: string;
}

export type RetryResult<T> = RetrySuccess<T> | RetryExhausted;

/**
 * Run `operation`, retrying on any thrown error up to a total of `maxAttempts`
 * attempts (default 4 = the first try + 3 retries, matching Requirement 10.4's
 * "retry the persistence up to 3 times"). Never throws: on exhaustion it
 * returns an {@link RetryExhausted} carrying the last error message so the
 * caller can record the cause and continue.
 *
 * @param operation  The async operation to attempt. Receives the 1-based
 *   attempt number for logging/idempotency if needed.
 * @param maxAttempts Total attempts (initial try included). Values < 1 are
 *   treated as 1. Defaults to 4 (one try + three retries).
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  maxAttempts = 4,
): Promise<RetryResult<T>> {
  const total = Math.max(1, Math.trunc(maxAttempts));
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      const value = await operation(attempt);
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      lastError = errorMessage(error);
      // Exponential backoff before retrying (skip delay after final attempt)
      if (attempt < total) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
      }
    }
  }

  return { ok: false, attempts: total, lastError };
}

/**
 * The number of persistence attempts for Box artifact-id persistence: the
 * initial attempt plus the three retries Requirement 10.4 mandates.
 */
export const PERSISTENCE_MAX_ATTEMPTS = 4;
