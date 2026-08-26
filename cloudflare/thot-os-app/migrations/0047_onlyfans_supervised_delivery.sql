PRAGMA foreign_keys = ON;

-- A delivery job is immutable once the creator authorizes it.  The encrypted
-- R2 object is private to the bridge; the catalogue path remains only an audit
-- reference and is never used for native delivery after this migration.
ALTER TABLE onlyfans_upload_jobs ADD COLUMN frozen_media_key TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN frozen_media_sha256 TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN frozen_media_bytes INTEGER;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN frozen_media_content_type TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN media_staged_at TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN native_attachment_verified_at TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN awaiting_human_send_at TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN native_message_id TEXT;
ALTER TABLE onlyfans_upload_jobs ADD COLUMN attempt_id TEXT;

CREATE INDEX onlyfans_upload_jobs_frozen_media
  ON onlyfans_upload_jobs(creator_id,account_id,status,frozen_media_key);

-- Staging defaults to supervised delivery.  Automatic mode remains an explicit
-- administrator feature and is never inferred from a previous enabled queue.
ALTER TABLE onlyfans_delivery_controls ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'supervised'
  CHECK(delivery_mode IN ('supervised','automatic'));
ALTER TABLE onlyfans_delivery_controls ADD COLUMN minimum_bridge_version TEXT NOT NULL DEFAULT '0.22.0';

-- Last-seen client metadata is operational evidence only; no browser session
-- material is retained.
ALTER TABLE bridge_credentials ADD COLUMN last_extension_version TEXT;
ALTER TABLE bridge_credentials ADD COLUMN last_protocol_version TEXT;

