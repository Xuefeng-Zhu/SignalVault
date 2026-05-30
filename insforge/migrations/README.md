# InsForge Migrations

Versioned, reproducible SQL migrations for the SignalVault InsForge Postgres backend.

- **Project:** SignalVault (API base `https://j3i3s9hq.us-west.insforge.app`)
- **Linked config:** `.insforge/project.json` (the InsForge CLI reads this).

## Files

| File | Purpose |
| --- | --- |
| `0001_create_core_tables.sql` | Creates the ten core domain tables with all constraints/CHECKs (spec task 4.1). Table DDL only — no RLS, no triggers. |
| `0002_rls_and_realtime.sql` | Enables RLS on all ten domain tables with membership-scoped (`auth.uid()`) SELECT/INSERT/UPDATE/DELETE policies, and adds the `scans.status` realtime trigger publishing to `scan:{scanId}` (spec task 4.2). |

### `0002_rls_and_realtime.sql` details

- **Membership helpers (SECURITY DEFINER):** `is_workspace_member(ws_id)`,
  `can_manage_workspace_members(ws_id)`, `can_access_company(company_id)`,
  `can_access_scan(scan_id)`. Defined `SECURITY DEFINER` so policies are
  recursion-free and child tables can check their parent's workspace.
- **Workspace scoping (Req 1.4, 21.7):** every row is accessible only when its
  `workspace_id` — directly (`companies`, `scans`, `verdicts`, `integrations`),
  via `companies.workspace_id` (`watched_sources`), or via `scans.workspace_id`
  (`snapshots`, `diffs`, `claims`) — belongs to a workspace the caller is a
  member of. `workspaces`/`workspace_members` are scoped by membership, with a
  first-login bootstrap path so a new user can create and claim their first
  workspace (Req 1.3).
- **Realtime trigger (Req 7.3):** registers the `scan:%` channel pattern and
  adds `scan_status_realtime` (`AFTER UPDATE OF status ... WHEN OLD.status IS
  DISTINCT FROM NEW.status`) which calls `realtime.publish('scan:{id}',
  'status_changed', payload)`. The publish is wrapped in an exception guard so a
  realtime failure can never block status persistence (Req 7.2); the client
  falls back to polling when no event arrives (Req 7.4).
- **Idempotent:** `CREATE OR REPLACE` functions, `DROP POLICY IF EXISTS` before
  each policy, guarded channel insert, `DROP TRIGGER IF EXISTS`, and
  `ENABLE ROW LEVEL SECURITY` (a no-op when already enabled). Safe to re-run.

## How these are applied

Migrations are applied to the linked InsForge project. Two equivalent paths:

1. **InsForge MCP tooling (used to apply 0001):** the `run-raw-sql` infrastructure
   tool executes the DDL against the project's Postgres database. This is the
   path the InsForge `instructions` doc recommends for schema management
   (`run-raw-sql`, `get-table-schema`).
2. **InsForge CLI:** `insforge` reads `.insforge/project.json` and can run the
   same SQL files (e.g. an `insforge` SQL/migration command) for CI or local
   reproducibility.

Apply migrations in ascending numeric order. Each file is idempotent at the
file level only (re-running a `CREATE TABLE` will error if the table already
exists); to re-apply a clean slate, drop the tables first.

## Verification

After applying, confirm tables exist via the InsForge MCP `get-backend-metadata`
tool (lists tables) or `get-table-schema` per table.
