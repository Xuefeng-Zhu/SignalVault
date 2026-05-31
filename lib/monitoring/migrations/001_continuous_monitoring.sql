-- Continuous Monitoring tables
-- Run this migration to create the content_hashes and monitoring_config tables.

-- Track last-known content hash per watched source
CREATE TABLE IF NOT EXISTS content_hashes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  watched_source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_at TIMESTAMPTZ,
  check_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, watched_source_id)
);

-- Index for efficient cron lookups
CREATE INDEX IF NOT EXISTS idx_content_hashes_workspace_company
  ON content_hashes(workspace_id, company_id);

CREATE INDEX IF NOT EXISTS idx_content_hashes_last_checked
  ON content_hashes(last_checked_at);

-- Monitoring configuration per company
CREATE TABLE IF NOT EXISTS monitoring_config (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT false,
  check_interval_hours INTEGER NOT NULL DEFAULT 6
    CHECK (check_interval_hours IN (1, 6, 12, 24)),
  last_auto_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, company_id)
);

-- Index for cron: find all enabled monitoring configs
CREATE INDEX IF NOT EXISTS idx_monitoring_config_enabled
  ON monitoring_config(monitoring_enabled)
  WHERE monitoring_enabled = true;

-- RLS policies (requires the workspace_members check pattern)
ALTER TABLE content_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_config ENABLE ROW LEVEL SECURITY;

-- Users can only access content_hashes for workspaces they belong to
CREATE POLICY content_hashes_workspace_access ON content_hashes
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

-- Users can only access monitoring_config for workspaces they belong to
CREATE POLICY monitoring_config_workspace_access ON monitoring_config
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );
