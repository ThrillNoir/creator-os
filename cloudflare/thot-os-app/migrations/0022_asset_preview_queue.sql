PRAGMA foreign_keys = ON;

-- Queue delivery is at-least-once. This creator-scoped job record makes preview
-- generation idempotent and gives the live library an explicit progress source.
CREATE TABLE IF NOT EXISTS asset_preview_jobs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_revision TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','processing','ready','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, asset_id)
);

CREATE INDEX IF NOT EXISTS asset_preview_jobs_creator_status
  ON asset_preview_jobs(creator_id, status, updated_at DESC);
