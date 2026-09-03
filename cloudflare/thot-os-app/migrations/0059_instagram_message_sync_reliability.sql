PRAGMA foreign_keys = ON;

-- Message collection has a separate lease, attempt clock and error from the
-- analytics state so one path cannot make the other look healthy.
ALTER TABLE instagram_account_sync_state ADD COLUMN last_messages_attempt_at TEXT;
ALTER TABLE instagram_account_sync_state ADD COLUMN last_messages_error TEXT;
ALTER TABLE instagram_account_sync_state ADD COLUMN last_messages_attachment_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instagram_account_sync_state ADD COLUMN messages_sync_lease_id TEXT;
ALTER TABLE instagram_account_sync_state ADD COLUMN messages_sync_lease_at TEXT;
ALTER TABLE messaging_connections ADD COLUMN last_sync_error TEXT;

CREATE INDEX IF NOT EXISTS instagram_account_message_sync_due
  ON instagram_account_sync_state(creator_id, last_messages_attempt_at, account_id);
