/**
 * Barrel for the Model adapter implementations.
 *
 * Exposes the live {@link ModelClient} (task 13.1) and the demo client (task
 * 13.2). The server-only `./live` entry binds the real provider credentials and
 * routes to an OpenAI-compatible chat-completions endpoint, preferring the
 * InsForge Model Gateway via the pure, test-importable provider precedence in
 * `./resolve` (Requirements 24.1, 24.2, 24.4). The selection factory (task 6.2)
 * chooses between live and demo.
 */
export {
  createLiveModelClient,
  LiveModelClient,
  ModelTimeoutError,
  ModelRequestError,
  MODEL_TIMEOUT_CEILING_MS,
} from "./live";
export { createDemoModelClient, DemoModelClient } from "./demo";
export {
  resolveModelProvider,
  type ModelProvider,
  type ModelProviderConfig,
} from "./resolve";
