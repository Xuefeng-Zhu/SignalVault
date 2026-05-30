// Feature: signalvault, Property 30: Model routing prefers the InsForge Model Gateway
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

// Import the pure resolver directly (NOT via the barrel) so the test never
// pulls in the server-only live/demo Model clients.
import {
  resolveModelProvider,
  type ModelProviderConfig,
} from '@/lib/adapters/model/resolve';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';

/**
 * Property 30 (Validates: Requirements 24.2):
 * For any combination of configured inference providers, the Model adapter's
 * provider-precedence resolution always PREFERS the InsForge Model Gateway.
 *
 * The fixed precedence is:
 *   1. InsForge Model Gateway  ('insforge')          — preferred whenever present
 *   2. Direct OpenAI-compatible ('openai-compatible') — only when InsForge absent
 *   3. none configured          (null)
 *
 * `resolveModelProvider` is pure and deterministic (depends solely on its
 * argument), so these properties hold without any network access. Each
 * property runs a minimum of PBT_MIN_RUNS (100) iterations.
 */

/** Generate every combination of configured providers (2 booleans → 4 cases). */
const configArb: fc.Arbitrary<ModelProviderConfig> = fc.record({
  insforge: fc.boolean(),
  openAiCompatible: fc.boolean(),
});

describe('Property 30: Model routing prefers the InsForge Model Gateway', () => {
  it('prefers InsForge whenever it is configured, regardless of openAiCompatible', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const provider = resolveModelProvider(config);

        if (config.insforge) {
          // Core preference (Requirement 24.2): InsForge always wins when
          // present, even if a direct OpenAI-compatible endpoint is also set.
          expect(provider).toBe('insforge');
        } else if (config.openAiCompatible) {
          // InsForge absent → fall back to the configured OpenAI-compatible endpoint.
          expect(provider).toBe('openai-compatible');
        } else {
          // No provider configured → null (adapter operates in Demo Mode).
          expect(provider).toBeNull();
        }
      }),
      pbtParams(),
    );
  });

  it('is deterministic: the same config always yields the same provider', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const first = resolveModelProvider(config);
        const second = resolveModelProvider(config);
        expect(second).toBe(first);
      }),
      pbtParams(),
    );
  });

  it(`runs at least ${PBT_MIN_RUNS} iterations per property`, () => {
    expect(PBT_MIN_RUNS).toBeGreaterThanOrEqual(100);
  });
});
