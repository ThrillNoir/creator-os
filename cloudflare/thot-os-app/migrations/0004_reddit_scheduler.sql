PRAGMA foreign_keys = ON;

ALTER TABLE social_posts ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_posts ADD COLUMN claimed_at TEXT;
ALTER TABLE social_posts ADD COLUMN last_attempt_at TEXT;

CREATE TABLE provider_connections (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  connected_account_id TEXT NOT NULL,
  composio_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','expired','pending','failed')),
  external_account_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  identity_confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(creator_id, service)
);

CREATE TABLE provider_connection_attempts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  connected_account_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','expired')),
  expires_at TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX provider_connection_attempts_pending
  ON provider_connection_attempts(creator_id, service, status, expires_at);

CREATE TABLE scheduler_runs (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  error TEXT
);

INSERT INTO provider_connections
  (creator_id,service,connected_account_id,composio_user_id,status,display_name,last_error)
VALUES
  ('adelaide','reddit','expired-local-connection','creator-os:adelaide:service:reddit','expired','u/AdelaideSuede','Connect and verify Adelaide’s current Reddit account before publishing.')
ON CONFLICT(creator_id,service) DO NOTHING;
