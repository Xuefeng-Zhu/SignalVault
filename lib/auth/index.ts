/**
 * Barrel for SignalVault's authentication / active-workspace helpers.
 *
 * - `./routes` — pure, Edge-safe routing constants and helpers shared by the
 *   middleware and server code (no `server-only`, no Node APIs).
 * - `./active-workspace` — the pure resolution core (testable with a fake
 *   InsForge client; property test 8.2 targets it).
 * - `./active-workspace.server` — the `server-only` request wrapper that reads
 *   the session via the InsForge auth SDK and resolves the active workspace.
 *
 * The server-only entry is intentionally NOT re-exported here so this barrel
 * stays importable from the Edge middleware bundle. Import
 * `resolveActiveWorkspace` directly from `./active-workspace.server` in pages /
 * route handlers.
 */
export {
  LOGIN_PATH,
  REDIRECT_PARAM,
  PROTECTED_PREFIXES,
  isProtectedPath,
  isDemoModeEnabled,
} from "./routes";

export {
  resolveActiveWorkspaceCore,
  type ActiveWorkspaceResolution,
  type ResolveActiveWorkspaceCoreInput,
} from "./active-workspace";
