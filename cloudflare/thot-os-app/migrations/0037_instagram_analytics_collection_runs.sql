PRAGMA foreign_keys = ON;

-- Analytics collection is a read-only provider operation, but it still needs
-- a durable per-creator receipt.  This is deliberately separate from
-- scheduler_runs, which records outbound publishing work.
CREATE TABLE IF NOT EXISTS instagram_analytics_collection_runs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual','cron')),
  status TEXT NOT NULL CHECK(status IN ('running','completed','skipped','failed')),
  force_requested INTEGER NOT NULL DEFAULT 0 CHECK(force_requested IN (0,1)),
  media_count INTEGER NOT NULL DEFAULT 0 CHECK(media_count >= 0),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS instagram_analytics_collection_runs_creator_time
  ON instagram_analytics_collection_runs(creator_id, started_at DESC);

CREATE INDEX IF NOT EXISTS instagram_analytics_collection_runs_recovery
  ON instagram_analytics_collection_runs(status, started_at, creator_id);

-- A scheduled trigger can be delivered more than once.  Only one provider
-- read for a creator may be in progress; abandoned claims are recovered by
-- the scheduler after its bounded timeout.
CREATE UNIQUE INDEX IF NOT EXISTS instagram_analytics_collection_runs_one_active
  ON instagram_analytics_collection_runs(creator_id)
  WHERE status='running';
