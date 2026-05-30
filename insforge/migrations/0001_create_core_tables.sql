-- Migration: 0001_create_core_tables
-- Spec: signalvault — Task 4.1 "Author migrations for all ten tables"
-- Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10
--
-- Creates the ten core SignalVault domain tables exactly as specified in
-- design.md "InsForge Postgres Schema". This migration contains table DDL and
-- constraints/CHECKs ONLY. RLS policies and the scan-status realtime trigger
-- are authored separately in task 4.2.
--
-- Conventions (per InsForge / AGENTS.md):
--   * Primary keys are uuid DEFAULT gen_random_uuid().
--   * Users are referenced via auth.users(id).
--   * Timestamps default to now().

-- workspaces
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- workspace_members (User <-> Workspace, with role)
CREATE TABLE workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

-- companies
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  domain text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- watched_sources
CREATE TABLE watched_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN
    ('homepage','pricing','docs','changelog','trust','careers','terms','privacy','status','blog')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- scans
CREATE TABLE scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN
    ('queued','scraping','uploading','diffing','analyzing','completed','failed')),
  trigger_type text NOT NULL DEFAULT 'manual',
  failure_reason text,
  box_scan_folder_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- snapshots (raw/normalized/screenshot evidence refs + hashes)
CREATE TABLE snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  watched_source_id uuid NOT NULL REFERENCES watched_sources(id) ON DELETE CASCADE,
  raw_artifact_url text, raw_artifact_key text, raw_box_file_id text,
  normalized_artifact_url text, normalized_artifact_key text, normalized_box_file_id text,
  screenshot_artifact_url text, screenshot_artifact_key text, screenshot_box_file_id text,
  content_hash text,          -- hash of raw HTML
  normalized_text_hash text,  -- hash of normalized content
  simulated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- diffs
CREATE TABLE diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  prior_snapshot_id uuid REFERENCES snapshots(id) ON DELETE SET NULL,
  current_snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  change_score int NOT NULL CHECK (change_score BETWEEN 0 AND 100),
  change_summary text NOT NULL,
  added_text text NOT NULL DEFAULT '',
  removed_text text NOT NULL DEFAULT '',
  modified_sections jsonb NOT NULL DEFAULT '[]',
  diff_box_file_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- claims
CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  claim_type text NOT NULL CHECK (claim_type IN
    ('pricing','packaging','security','compliance','feature','integration',
     'social_proof','hiring','terms','positioning')),
  statement_text text NOT NULL,
  evidence_text text NOT NULL,
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  claim_status text CHECK (claim_status IN
    ('new','removed','weakened','contradicted','strengthened','needs_review')),
  risk_level text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- verdicts
CREATE TABLE verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  strategy_prediction text NOT NULL CHECK (strategy_prediction IN
    ('moving_upmarket','enterprise_readiness','pricing_tightening',
     'security_posture_change','messaging_pivot','self_serve_push','insufficient_evidence')),
  confidence int NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  risk_score int NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  recommended_actions jsonb NOT NULL,   -- 1..10 entries
  key_evidence jsonb NOT NULL DEFAULT '[]',
  counter_evidence jsonb NOT NULL DEFAULT '[]',
  is_fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- integrations
CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('Apify','Box')),
  credential_ciphertext text,   -- encrypted (live) or mock placeholder (demo)
  is_mock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);
