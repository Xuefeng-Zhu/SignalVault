/**
 * Barrel for the InsForge adapter implementations.
 *
 * Exposes the live {@link InsForgeClient} (task 7.1). The server-only `./live`
 * entry binds the real InsForge credentials and threads the caller's access
 * token for RLS; the `./live-repository` core (also re-exported) carries the
 * testable workspace-scoping + array-form-insert logic, and `./mappers` holds
 * the camelCase<->snake_case row translation. The demo in-memory store (task
 * 7.2) and the selection factory (task 6.2) are added by their own tasks.
 */
export {
  createLiveInsForgeClient,
  type CreateLiveInsForgeClientOptions,
} from "./live";

export {
  LiveInsForgeClient,
  LiveWorkspaceRepository,
  WorkspaceScopeError,
  InsForgeRepositoryError,
  createLiveInsForgeClientCore,
  type InsforgeDatabaseLike,
  type TableHandle,
  type QueryBuilder,
  type DbResult,
  type DbError,
  type LiveInsForgeClientOptions,
} from "./live-repository";

export type { DbRow } from "./mappers";

// Demo in-memory store (task 7.2). Re-exported here so the InsForge adapter has
// a single import site, mirroring the apify adapter barrel.
export {
  DemoInsForgeClient,
  createDemoInsForgeClient,
  type DemoInsForgeOptions,
} from "./demo";
