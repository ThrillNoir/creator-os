PRAGMA foreign_keys = ON;

ALTER TABLE social_posts ADD COLUMN device_claimed_at TEXT;
ALTER TABLE social_posts ADD COLUMN device_receipt TEXT NOT NULL DEFAULT '{}';

CREATE TABLE reddit_bridge_tokens (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX reddit_bridge_tokens_lookup
  ON reddit_bridge_tokens(token_hash,status,expires_at);

UPDATE operational_accounts
SET publishing_mode='local_bridge',publishing_authority='device_only',warning_level='attention',
    warning_message='Pair Adelaide’s signed Reddit browser to enable native scheduled image posts. Video remains disabled until its separate composer is verified.',
    last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE id='adelaide-reddit-main';
