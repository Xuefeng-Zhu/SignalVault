import "server-only";

import type { InferenceRequest, ModelClient, RunMode } from "@/lib/adapters/types";

import { seededInferenceText } from "./demo-inference";

/**
 * Demo implementation of {@link ModelClient} (Model_Adapter).
 *
 * Returns DETERMINISTIC seeded analysis output for the Demo_Company "Dropbox"
 * and NEVER issues a network request (Requirements 24.3, 18.1). It is selected
 * by the adapter factory whenever `DEMO_MODE` is true or the model provider
 * credentials (`MODEL_API_KEY` / `MODEL_BASE_URL`) are missing (Requirement
 * 24.3 / 18.2).
 *
 * All payload-selection logic lives in the pure, unit-testable
 * `./demo-inference` module; this class only carries the adapter contract
 * (`mode`, `isConfigured`) and stays `server-only`, mirroring the apify
 * adapter's `demo` / `demo-capture` split.
 */
export class DemoModelClient implements ModelClient {
  /** This adapter is the demo path; it is never configured for live operation. */
  readonly mode: RunMode = "demo";

  /** Always false: the demo client holds no live credentials (Requirement 18.1). */
  isConfigured(): boolean {
    return false;
  }

  /**
   * Return deterministic seeded analysis text for the Demo_Company. Resolves
   * immediately without any network call; `simulated` is always true so callers
   * can surface the demo-substitution warning (Requirements 24.3, 18.1).
   */
  async complete(req: InferenceRequest): Promise<{ text: string; simulated: boolean }> {
    return { text: seededInferenceText(req), simulated: true };
  }
}

/** Convenience constructor mirroring the factory's expected call site (task 6.2). */
export function createDemoModelClient(): DemoModelClient {
  return new DemoModelClient();
}
