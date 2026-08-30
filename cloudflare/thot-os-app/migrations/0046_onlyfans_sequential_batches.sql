PRAGMA foreign_keys = ON;

-- Batch records are deliberately scoped to the creator, OnlyFans account,
-- verified target, and assigned Chrome profile.  A batch is a delivery plan,
-- not a publishing record: each linked job remains one media-only message.
CREATE TABLE onlyfans_upload_batches (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES onlyfans_upload_targets(id) ON DELETE RESTRICT,
  profile_id TEXT NOT NULL REFERENCES browser_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','paused','emergency_stopped','blocked','message_delivery_complete','vault_verified')),
  asset_count INTEGER NOT NULL CHECK(asset_count BETWEEN 1 AND 50),
  authorized_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  authorized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paused_by TEXT COLLATE NOCASE REFERENCES users(email),
  paused_at TEXT,
  stopped_by TEXT COLLATE NOCASE REFERENCES users(email),
  stopped_at TEXT,
  blocked_at TEXT,
  message_delivery_completed_at TEXT,
  vault_verified_by TEXT COLLATE NOCASE REFERENCES users(email),
  vault_verified_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX onlyfans_upload_batches_scope_queue
  ON onlyfans_upload_batches(creator_id,account_id,profile_id,status,created_at);

CREATE TRIGGER onlyfans_batch_scope_insert
BEFORE INSERT ON onlyfans_upload_batches
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND status='active' AND verified_at IS NOT NULL)
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_batch_scope_mismatch'); END;

CREATE TRIGGER onlyfans_batch_scope_update
BEFORE UPDATE OF creator_id,account_id,target_id,profile_id ON onlyfans_upload_batches
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id)
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_batch_scope_mismatch'); END;

ALTER TABLE onlyfans_upload_jobs ADD COLUMN batch_id TEXT REFERENCES onlyfans_upload_batches(id) ON DELETE RESTRICT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN batch_sequence INTEGER;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN asset_source_revision TEXT;

CREATE INDEX onlyfans_upload_jobs_batch_queue
  ON onlyfans_upload_jobs(batch_id,batch_sequence,status,created_at);

CREATE TRIGGER onlyfans_job_batch_scope_insert
BEFORE INSERT ON onlyfans_upload_jobs
WHEN NEW.batch_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM onlyfans_upload_batches b
  WHERE b.id=NEW.batch_id AND b.creator_id=NEW.creator_id AND b.account_id=NEW.account_id AND b.target_id=NEW.target_id
)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_batch_scope_mismatch'); END;

CREATE TRIGGER onlyfans_job_batch_scope_update
BEFORE UPDATE OF batch_id,creator_id,account_id,target_id ON onlyfans_upload_jobs
WHEN NEW.batch_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM onlyfans_upload_batches b
  WHERE b.id=NEW.batch_id AND b.creator_id=NEW.creator_id AND b.account_id=NEW.account_id AND b.target_id=NEW.target_id
)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_batch_scope_mismatch'); END;

-- Native single-item success must be explicitly recorded by an administrator
-- before a batch containing more than one asset can be claimed.  This avoids
-- inferring that a live OnlyFans DOM contract has been verified.
ALTER TABLE onlyfans_delivery_controls ADD COLUMN batch_delivery_verified_by TEXT COLLATE NOCASE REFERENCES users(email);
ALTER TABLE onlyfans_delivery_controls ADD COLUMN batch_delivery_verified_at TEXT;


