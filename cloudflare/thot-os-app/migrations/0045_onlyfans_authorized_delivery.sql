PRAGMA foreign_keys = ON;

-- A creator's approval to classify content is intentionally distinct from an
-- authorization to make a native device send.  This control is scoped to the
-- existing OnlyFans account and defaults to disabled until an administrator
-- enables unattended delivery for the verified M1 profile.
CREATE TABLE onlyfans_delivery_controls (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','enabled','paused','emergency_stopped')),
  changed_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  PRIMARY KEY (creator_id, account_id)
);

CREATE TRIGGER onlyfans_delivery_control_scope_insert
BEFORE INSERT ON onlyfans_delivery_controls
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_delivery_control_scope_mismatch'); END;

CREATE TRIGGER onlyfans_delivery_control_scope_update
BEFORE UPDATE OF creator_id,account_id ON onlyfans_delivery_controls
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_delivery_control_scope_mismatch'); END;

ALTER TABLE onlyfans_upload_jobs ADD COLUMN send_authorized_by TEXT COLLATE NOCASE REFERENCES users(email);
ALTER TABLE onlyfans_upload_jobs ADD COLUMN attachment_attempt_started_at TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN send_attempt_started_at TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN send_attempt_installation_id TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN message_verified_at TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN vault_verified_at TEXT;

CREATE INDEX onlyfans_upload_jobs_authorized_queue
  ON onlyfans_upload_jobs(creator_id,account_id,status,send_authorized_at,created_at);

