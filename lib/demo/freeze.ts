/**
 * Internal immutability helpers for the deterministic Demo_Company seed.
 *
 * The seed constants must be reproducible across repeated scans
 * (Requirement 18.7), so the canonical data is deep-frozen at module load and
 * builder functions hand out deep clones. Both helpers are pure and
 * deterministic: no randomness, no timestamps, no I/O.
 *
 * This module is intentionally not re-exported from the package barrel.
 */

/**
 * Recursively freeze a value and every nested object/array in place, then
 * return the same reference with its original type preserved. Frozen seed
 * constants cannot be mutated by consumers, which keeps repeated reads stable.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Return a deep, mutable copy of a (typically frozen) seed value. Builder
 * functions use this so callers receive a fresh structure that is deeply equal
 * across calls without exposing or aliasing the canonical frozen constant.
 */
export function cloneSeed<T>(value: T): T {
  return structuredClone(value);
}
