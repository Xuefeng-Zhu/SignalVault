import "server-only";

/**
 * Server-only entry for the demo in-memory {@link InsForgeClient}
 * (InsForge_Adapter).
 *
 * The adapter factory (task 6.2) selects this client whenever `DEMO_MODE` is
 * active or InsForge credentials are missing (Requirements 18.1, 1.6). All of
 * the in-memory store, workspace-scoped repositories, and Demo_Company seeding
 * live in the pure, unit-testable `./demo-store` module; this entry only
 * re-exports them behind the `import "server-only"` guard so concrete adapter
 * construction stays out of the browser bundle, mirroring the apify
 * (`demo`/`demo-capture`) and model (`demo`/`demo-inference`) adapter splits.
 *
 * The store holds no secrets, so the guard here is for construction-site
 * consistency rather than credential protection.
 */
export {
  DemoInsForgeClient,
  createDemoInsForgeClient,
  DEMO_WORKSPACE_ID,
  DEMO_WORKSPACE_NAME,
  DEMO_COMPANY_ID,
  DEMO_BASELINE_SCAN_ID,
  DEMO_LATEST_SCAN_ID,
  type DemoInsForgeOptions,
} from "./demo-store";
