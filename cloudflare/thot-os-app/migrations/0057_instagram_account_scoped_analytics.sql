PRAGMA foreign_keys = ON;

-- Keep instagram_sync_state creator-keyed for older Workers. New collection
-- state lives here so two active Instagram accounts cannot overwrite each other.
CREATE TABLE IF NOT EXISTS instagram_account_sync_state (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  last_messages_sync_at TEXT,
  last_analytics_sync_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id, account_id),
  FOREIGN KEY (creator_id, account_id) REFERENCES operational_accounts(creator_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS instagram_account_sync_state_due
  ON instagram_account_sync_state(creator_id, last_analytics_sync_at, account_id);

-- Backfill only the legacy row whose messaging connection identifies exactly
-- one operational account. Ambiguous historical rows remain in the legacy table.
INSERT OR IGNORE INTO instagram_account_sync_state
  (creator_id,account_id,last_messages_sync_at,last_analytics_sync_at,last_error,updated_at)
SELECT state.creator_id,connection.account_id,state.last_messages_sync_at,state.last_analytics_sync_at,state.last_error,state.updated_at
FROM instagram_sync_state state
JOIN messaging_connections connection
  ON connection.id=state.connection_id AND connection.creator_id=state.creator_id
JOIN operational_accounts account
  ON account.id=connection.account_id AND account.creator_id=connection.creator_id
WHERE connection.platform='instagram' AND account.platform='instagram';

ALTER TABLE instagram_analytics_collection_runs ADD COLUMN account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS instagram_analytics_collection_runs_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS instagram_analytics_collection_runs_one_active_account
  ON instagram_analytics_collection_runs(creator_id, account_id)
  WHERE status='running' AND account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS instagram_analytics_collection_runs_one_active_legacy
  ON instagram_analytics_collection_runs(creator_id)
  WHERE status='running' AND account_id IS NULL;
CREATE INDEX IF NOT EXISTS instagram_analytics_collection_runs_account_time
  ON instagram_analytics_collection_runs(creator_id, account_id, started_at DESC);

ALTER TABLE instagram_media_metrics ADD COLUMN account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS instagram_media_metrics_account_time
  ON instagram_media_metrics(creator_id, account_id, collected_at DESC);

ALTER TABLE instagram_media_metric_observations ADD COLUMN account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS instagram_media_metric_observations_account_time
  ON instagram_media_metric_observations(creator_id, account_id, media_id, collected_at DESC);
