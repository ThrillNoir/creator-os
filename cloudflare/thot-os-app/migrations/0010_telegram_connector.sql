PRAGMA foreign_keys = ON;

ALTER TABLE telegram_send_log ADD COLUMN claimed_at TEXT;
ALTER TABLE telegram_send_log ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE telegram_connector_state (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  expected_bot_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_validation' CHECK(status IN ('pending_validation','connected','failed','revoked')),
  next_update_id INTEGER NOT NULL DEFAULT 0,
  identity_confirmed_at TEXT,
  last_polled_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE telegram_poll_runs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  updates_seen INTEGER NOT NULL DEFAULT 0,
  messages_imported INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX telegram_poll_runs_creator_time
  ON telegram_poll_runs(creator_id, started_at DESC);
