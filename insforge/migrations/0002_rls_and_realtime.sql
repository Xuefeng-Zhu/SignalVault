-- Migration: 0002_rls_and_realtime
-- Spec: signalvault — Task 4.2 "Author RLS policies and the scan-status realtime trigger"
-- Requirements: 1.4, 21.7, 7.3
--
-- This migration does two things on top of the tables created in 0001:
--   1. Enables Row Level Security on every domain table and adds
--      membership-scoped SELECT/INSERT/UPDATE/DELETE policies so a row is only
--      accessible when its workspace_id (directly, or via its parent chain) is
--      one of the workspaces the calling user (auth.uid()) is a member of.
--        - companies / scans / verdicts / integrations -> workspace_id directly
--        - watched_sources -> companies.workspace_id (via company_id)
--        - snapshots / diffs / claims -> scans.workspace_id (via scan_id)
--        - workspaces -> id is the workspace; workspace_members -> workspace_id
--      Requirements 1.4 (restrict every query to the active workspace's records
--      and exclude others) and 21.7 (cross-workspace access denied).
--   2. Adds a Postgres trigger on scans.status that, on a status change,
--      publishes a realtime event to channel `scan:{scanId}` via
--      realtime.publish so the Scan detail timeline updates live
--      (Requirement 7.3). The publish is wrapped so a realtime failure can
--      never block the status persistence (degrade-never-crash; the client
--      falls back to polling per Requirement 7.4).
--
-- Conventions (per InsForge docs / AGENTS.md):
--   * RLS predicates use auth.uid() to identify the calling user.
--   * Realtime is published DB-side with realtime.publish(channel, event, payload).
--   * SECURITY DEFINER helpers are used for membership/parent-chain checks so
--     policies are recursion-free (a policy on workspace_members cannot safely
--     query workspace_members under RLS without bypassing it).
--
-- This migration is idempotent: it uses CREATE OR REPLACE for functions,
-- DROP ... IF EXISTS before each policy/trigger, a guarded channel insert, and
-- ENABLE ROW LEVEL SECURITY (a no-op when already enabled). It is safe to
-- re-run. The linked project currently holds no rows, so enabling RLS here is
-- safe and locks out no existing data.

-- ============================================================================
-- 1. Membership / access helper functions (SECURITY DEFINER, recursion-free)
-- ============================================================================

-- True when the calling user is a member of workspace ws_id.
-- SECURITY DEFINER so it bypasses RLS on workspace_members; this is what lets
-- the workspace_members policies reference membership without infinite
-- recursion, and lets child-table policies check the parent's workspace.
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
  );
$$;

-- True when the calling user may create a membership row in ws_id:
--   * the workspace has no members yet (first-login bootstrap / initial claim
--     of a freshly created workspace — Requirement 1.3), or
--   * the caller is already an owner/admin of that workspace.
-- This supports the auth bootstrap (a brand-new user creating their first
-- workspace + membership) while preventing an authenticated user from
-- self-joining an already-populated workspace they do not belong to (21.7).
CREATE OR REPLACE FUNCTION public.can_manage_workspace_members(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = ws_id
    )
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = ws_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    );
$$;

-- True when the calling user can access the company (its workspace membership).
-- Used by watched_sources (whose workspace is companies.workspace_id).
CREATE OR REPLACE FUNCTION public.can_access_company(company uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = company
      AND public.is_workspace_member(c.workspace_id)
  );
$$;

-- True when the calling user can access the scan (its workspace membership).
-- Used by snapshots, diffs, and claims (whose workspace is scans.workspace_id).
CREATE OR REPLACE FUNCTION public.can_access_scan(scan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.scans s
    WHERE s.id = scan
      AND public.is_workspace_member(s.workspace_id)
  );
$$;

-- ============================================================================
-- 2. Enable Row Level Security on every domain table
-- ============================================================================

ALTER TABLE public.workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watched_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diffs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verdicts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations      ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. RLS policies — workspaces
--    A user can see / act on a workspace they are a member of.
--    INSERT is allowed to any authenticated user so a brand-new user can
--    create their first workspace (Requirement 1.3); they then claim it by
--    inserting the bootstrap membership row (see workspace_members below).
-- ============================================================================

DROP POLICY IF EXISTS workspaces_select_member ON public.workspaces;
CREATE POLICY workspaces_select_member ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS workspaces_insert_authenticated ON public.workspaces;
CREATE POLICY workspaces_insert_authenticated ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS workspaces_update_member ON public.workspaces;
CREATE POLICY workspaces_update_member ON public.workspaces
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(id))
  WITH CHECK (public.is_workspace_member(id));

DROP POLICY IF EXISTS workspaces_delete_member ON public.workspaces;
CREATE POLICY workspaces_delete_member ON public.workspaces
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(id));

-- ============================================================================
-- 4. RLS policies — workspace_members
--    A user can see membership rows for workspaces they belong to.
--    INSERT is gated by can_manage_workspace_members: allowed when the
--    workspace has no members yet (bootstrap) or the caller is an owner/admin.
--    A user may always remove their own membership; owners/admins may manage
--    memberships of their workspace.
-- ============================================================================

DROP POLICY IF EXISTS workspace_members_select_member ON public.workspace_members;
CREATE POLICY workspace_members_select_member ON public.workspace_members
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_members_insert_bootstrap_or_admin ON public.workspace_members;
CREATE POLICY workspace_members_insert_bootstrap_or_admin ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (
    -- a user bootstrapping their own first membership into an empty workspace,
    -- or an existing owner/admin adding a member
    (user_id = auth.uid() AND public.can_manage_workspace_members(workspace_id))
    OR public.can_manage_workspace_members(workspace_id)
  );

DROP POLICY IF EXISTS workspace_members_update_admin ON public.workspace_members;
CREATE POLICY workspace_members_update_admin ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (public.can_manage_workspace_members(workspace_id))
  WITH CHECK (public.can_manage_workspace_members(workspace_id));

DROP POLICY IF EXISTS workspace_members_delete_self_or_admin ON public.workspace_members;
CREATE POLICY workspace_members_delete_self_or_admin ON public.workspace_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_manage_workspace_members(workspace_id)
  );

-- ============================================================================
-- 5. RLS policies — companies  (workspace_id directly)
-- ============================================================================

DROP POLICY IF EXISTS companies_select_member ON public.companies;
CREATE POLICY companies_select_member ON public.companies
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS companies_insert_member ON public.companies;
CREATE POLICY companies_insert_member ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS companies_update_member ON public.companies;
CREATE POLICY companies_update_member ON public.companies
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS companies_delete_member ON public.companies;
CREATE POLICY companies_delete_member ON public.companies
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- ============================================================================
-- 6. RLS policies — watched_sources  (workspace via companies.workspace_id)
-- ============================================================================

DROP POLICY IF EXISTS watched_sources_select_member ON public.watched_sources;
CREATE POLICY watched_sources_select_member ON public.watched_sources
  FOR SELECT TO authenticated
  USING (public.can_access_company(company_id));

DROP POLICY IF EXISTS watched_sources_insert_member ON public.watched_sources;
CREATE POLICY watched_sources_insert_member ON public.watched_sources
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS watched_sources_update_member ON public.watched_sources;
CREATE POLICY watched_sources_update_member ON public.watched_sources
  FOR UPDATE TO authenticated
  USING (public.can_access_company(company_id))
  WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS watched_sources_delete_member ON public.watched_sources;
CREATE POLICY watched_sources_delete_member ON public.watched_sources
  FOR DELETE TO authenticated
  USING (public.can_access_company(company_id));

-- ============================================================================
-- 7. RLS policies — scans  (workspace_id directly)
-- ============================================================================

DROP POLICY IF EXISTS scans_select_member ON public.scans;
CREATE POLICY scans_select_member ON public.scans
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS scans_insert_member ON public.scans;
CREATE POLICY scans_insert_member ON public.scans
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS scans_update_member ON public.scans;
CREATE POLICY scans_update_member ON public.scans
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS scans_delete_member ON public.scans;
CREATE POLICY scans_delete_member ON public.scans
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- ============================================================================
-- 8. RLS policies — snapshots  (workspace via scans.workspace_id)
-- ============================================================================

DROP POLICY IF EXISTS snapshots_select_member ON public.snapshots;
CREATE POLICY snapshots_select_member ON public.snapshots
  FOR SELECT TO authenticated
  USING (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS snapshots_insert_member ON public.snapshots;
CREATE POLICY snapshots_insert_member ON public.snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS snapshots_update_member ON public.snapshots;
CREATE POLICY snapshots_update_member ON public.snapshots
  FOR UPDATE TO authenticated
  USING (public.can_access_scan(scan_id))
  WITH CHECK (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS snapshots_delete_member ON public.snapshots;
CREATE POLICY snapshots_delete_member ON public.snapshots
  FOR DELETE TO authenticated
  USING (public.can_access_scan(scan_id));

-- ============================================================================
-- 9. RLS policies — diffs  (workspace via scans.workspace_id)
-- ============================================================================

DROP POLICY IF EXISTS diffs_select_member ON public.diffs;
CREATE POLICY diffs_select_member ON public.diffs
  FOR SELECT TO authenticated
  USING (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS diffs_insert_member ON public.diffs;
CREATE POLICY diffs_insert_member ON public.diffs
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS diffs_update_member ON public.diffs;
CREATE POLICY diffs_update_member ON public.diffs
  FOR UPDATE TO authenticated
  USING (public.can_access_scan(scan_id))
  WITH CHECK (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS diffs_delete_member ON public.diffs;
CREATE POLICY diffs_delete_member ON public.diffs
  FOR DELETE TO authenticated
  USING (public.can_access_scan(scan_id));

-- ============================================================================
-- 10. RLS policies — claims  (workspace via scans.workspace_id)
-- ============================================================================

DROP POLICY IF EXISTS claims_select_member ON public.claims;
CREATE POLICY claims_select_member ON public.claims
  FOR SELECT TO authenticated
  USING (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS claims_insert_member ON public.claims;
CREATE POLICY claims_insert_member ON public.claims
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS claims_update_member ON public.claims;
CREATE POLICY claims_update_member ON public.claims
  FOR UPDATE TO authenticated
  USING (public.can_access_scan(scan_id))
  WITH CHECK (public.can_access_scan(scan_id));

DROP POLICY IF EXISTS claims_delete_member ON public.claims;
CREATE POLICY claims_delete_member ON public.claims
  FOR DELETE TO authenticated
  USING (public.can_access_scan(scan_id));

-- ============================================================================
-- 11. RLS policies — verdicts  (workspace_id directly)
-- ============================================================================

DROP POLICY IF EXISTS verdicts_select_member ON public.verdicts;
CREATE POLICY verdicts_select_member ON public.verdicts
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS verdicts_insert_member ON public.verdicts;
CREATE POLICY verdicts_insert_member ON public.verdicts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS verdicts_update_member ON public.verdicts;
CREATE POLICY verdicts_update_member ON public.verdicts
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS verdicts_delete_member ON public.verdicts;
CREATE POLICY verdicts_delete_member ON public.verdicts
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- ============================================================================
-- 12. RLS policies — integrations  (workspace_id directly)
-- ============================================================================

DROP POLICY IF EXISTS integrations_select_member ON public.integrations;
CREATE POLICY integrations_select_member ON public.integrations
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS integrations_insert_member ON public.integrations;
CREATE POLICY integrations_insert_member ON public.integrations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS integrations_update_member ON public.integrations;
CREATE POLICY integrations_update_member ON public.integrations
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS integrations_delete_member ON public.integrations;
CREATE POLICY integrations_delete_member ON public.integrations
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- ============================================================================
-- 13. Realtime: register the per-scan channel pattern
--     The Scan detail page subscribes to `scan:{scanId}`; channel patterns use
--     SQL LIKE with ':' as the separator and '%' as the wildcard, so `scan:%`
--     matches every per-scan channel. Guarded insert keeps this idempotent.
-- ============================================================================

INSERT INTO realtime.channels (pattern, description, enabled)
SELECT 'scan:%', 'Per-scan status events for the SignalVault Scan detail timeline', true
WHERE NOT EXISTS (
  SELECT 1 FROM realtime.channels WHERE pattern = 'scan:%'
);

-- ============================================================================
-- 14. Realtime trigger: publish on scans.status change (Requirement 7.3)
--     On a status change the trigger publishes a `status_changed` event to
--     channel `scan:{scanId}` so subscribed clients update the timeline within
--     2s. realtime.publish is wrapped in an exception block so a realtime
--     failure can never roll back / block the status persistence
--     (status is persisted before progress is emitted, Requirement 7.2; the
--     client falls back to polling if no event arrives, Requirement 7.4).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_scan_status_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
BEGIN
  BEGIN
    PERFORM realtime.publish(
      'scan:' || NEW.id::text,
      'status_changed',
      jsonb_build_object(
        'id', NEW.id,
        'scanId', NEW.id,
        'workspaceId', NEW.workspace_id,
        'companyId', NEW.company_id,
        'status', NEW.status,
        'failureReason', NEW.failure_reason,
        'updatedAt', NEW.updated_at
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Degrade, never crash: a realtime publish failure must not abort the
    -- status update. The client transparently falls back to polling (7.4).
    RAISE WARNING 'notify_scan_status_changed: realtime.publish failed for scan % : %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scan_status_realtime ON public.scans;
CREATE TRIGGER scan_status_realtime
  AFTER UPDATE OF status ON public.scans
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_scan_status_changed();
