/**
 * Barrel for the InsForge adapter implementations.
 *
 * Exposes the live {@link InsForgeClient} (task 7.1). The server-only `./live`
 * entry binds the real InsForge credentials and threads the caller's access
 * token for RLS; the `./live-repository` core (also re-exported) carries the
 * testable workspace-scoping + array-form-insert logic, and `./mappers` holds
 * the camelCase<->snake_case row translation.
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
