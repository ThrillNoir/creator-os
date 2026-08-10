PRAGMA foreign_keys = ON;

CREATE TABLE vault_upload_jobs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('fansly','myroomz')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','claimed','staged','verified','failed','cancelled')),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  completed_at TEXT,
  error TEXT,
  receipt TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX vault_upload_jobs_active_asset
  ON vault_upload_jobs(creator_id,account_id,asset_id)
  WHERE status IN ('approved','claimed','staged','verified');

CREATE INDEX vault_upload_jobs_queue
  ON vault_upload_jobs(creator_id,platform,status,created_at);

CREATE TABLE vault_upload_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES vault_upload_jobs(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vault_bridge_tokens (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform='fansly'),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX vault_bridge_tokens_lookup
  ON vault_bridge_tokens(token_hash,status,expires_at);

UPDATE operational_accounts
SET warning_level='none',warning_message='',last_success_at='2026-08-06 03:38:51',last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE id='adelaide-fansly-main';

INSERT INTO operational_accounts
  (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority,warning_level,warning_message,last_checked_at)
VALUES
  ('adelaide-myroomz-vault','adelaide','myroomz','Adelaide MyRoomz Vault','','needs_check','direct_api','blocked','attention','Upload link is valid and targets Vault. Complete one controlled upload and confirm it appears under Adelaide before enabling direct delivery.',CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;
