PRAGMA foreign_keys = ON;

-- OnlyFans uses a distinct queue because its native message workflow has a
-- stricter lifecycle than the existing Fansly vault staging queue.  Keeping
-- it separate prevents a new status from weakening Fansly's proven contract.
CREATE TABLE onlyfans_upload_targets (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES browser_profiles(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK(platform='onlyfans'),
  expected_recipient_handle TEXT NOT NULL,
  native_thread_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  configured_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  configured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by TEXT COLLATE NOCASE REFERENCES users(email),
  verified_at TEXT,
  revoked_by TEXT COLLATE NOCASE REFERENCES users(email),
  revoked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, account_id),
  UNIQUE(creator_id, native_thread_path),
  FOREIGN KEY (profile_id, creator_id) REFERENCES browser_profiles(id, creator_id) ON DELETE RESTRICT
);

CREATE INDEX onlyfans_upload_targets_scope ON onlyfans_upload_targets(creator_id,account_id,status);

CREATE TRIGGER onlyfans_target_account_scope_insert
BEFORE INSERT ON onlyfans_upload_targets
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_target_scope_mismatch'); END;

CREATE TRIGGER onlyfans_target_account_scope_update
BEFORE UPDATE OF creator_id,account_id,profile_id,platform ON onlyfans_upload_targets
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_target_scope_mismatch'); END;

CREATE TABLE onlyfans_upload_jobs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES onlyfans_upload_targets(id) ON DELETE RESTRICT,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform='onlyfans'),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','claimed','attaching','send_authorized','staged','verified','failed','outcome_uncertain','cancelled')),
  approved_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  send_authorized_at TEXT,
  sent_at TEXT,
  completed_at TEXT,
  verified_by TEXT COLLATE NOCASE REFERENCES users(email),
  verified_at TEXT,
  error TEXT,
  receipt TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id,account_id,asset_id)
);

CREATE INDEX onlyfans_upload_jobs_queue ON onlyfans_upload_jobs(creator_id,account_id,status,created_at);

CREATE TABLE onlyfans_upload_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES onlyfans_upload_jobs(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX onlyfans_upload_events_scope ON onlyfans_upload_events(creator_id,job_id,created_at);

CREATE TRIGGER onlyfans_job_scope_insert
BEFORE INSERT ON onlyfans_upload_jobs
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id AND status='active')
  OR NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.asset_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_scope_mismatch'); END;

CREATE TRIGGER onlyfans_job_scope_update
BEFORE UPDATE OF creator_id,account_id,target_id,asset_id,platform ON onlyfans_upload_jobs
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id)
  OR NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.asset_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_scope_mismatch'); END;

