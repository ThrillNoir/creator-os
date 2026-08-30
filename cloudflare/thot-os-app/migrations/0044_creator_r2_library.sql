PRAGMA foreign_keys = ON;

-- Canonical originals are private R2 objects.  This table deliberately keeps
-- object keys opaque: display names, handles, captions and bearer URLs never
-- belong in R2 keys or durable storage metadata.
CREATE TABLE IF NOT EXISTS asset_storage_objects (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('r2','dropbox')),
  storage_role TEXT NOT NULL CHECK(storage_role IN ('canonical_original','source_fallback','ephemeral_delivery')),
  bucket_role TEXT NOT NULL CHECK(bucket_role IN ('library_media','dropbox_source','delivery_ephemeral')),
  object_key TEXT NOT NULL CHECK(length(object_key) BETWEEN 1 AND 1024),
  original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 512),
  byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
  verified_mime_type TEXT NOT NULL CHECK(length(verified_mime_type) BETWEEN 1 AND 160),
  sha256 TEXT NOT NULL CHECK(sha256 GLOB '[0-9a-f]*' AND length(sha256)=64),
  source_provider TEXT NOT NULL CHECK(source_provider IN ('dropbox','m1_direct')),
  source_revision TEXT,
  ingest_status TEXT NOT NULL CHECK(ingest_status IN ('pending','uploading','verified','failed','archived')),
  storage_class TEXT NOT NULL DEFAULT 'Standard' CHECK(storage_class IN ('Standard','InfrequentAccess')),
  uploaded_at TEXT,
  verified_at TEXT,
  archived_at TEXT,
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, asset_id, storage_role, sha256),
  UNIQUE(bucket_role, object_key)
);

CREATE INDEX IF NOT EXISTS asset_storage_objects_creator_asset_status
  ON asset_storage_objects(creator_id, asset_id, storage_role, ingest_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS asset_storage_objects_asset_source_revision
  ON asset_storage_objects(creator_id, asset_id, source_provider, source_revision, sha256);

-- Upload sessions are deliberately metadata-only.  Temporary credentials,
-- signed URLs, multipart upload IDs and bearer tickets must remain ephemeral.
CREATE TABLE IF NOT EXISTS asset_ingest_sessions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT REFERENCES asset_storage_objects(id) ON DELETE SET NULL,
  source_revision TEXT,
  expected_sha256 TEXT NOT NULL CHECK(expected_sha256 GLOB '[0-9a-f]*' AND length(expected_sha256)=64),
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes >= 0),
  expected_mime_type TEXT NOT NULL CHECK(length(expected_mime_type) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK(status IN ('created','uploading','finalized','aborted','expired','failed')),
  expires_at TEXT NOT NULL,
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, asset_id, source_revision, expected_sha256)
);

CREATE INDEX IF NOT EXISTS asset_ingest_sessions_expiry
  ON asset_ingest_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS media_fetch_tickets (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('instagram_container','telegram_private_download')),
  platform TEXT NOT NULL CHECK(platform IN ('instagram','telegram')),
  receipt_correlation_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  max_fetches INTEGER NOT NULL DEFAULT 1 CHECK(max_fetches BETWEEN 1 AND 20),
  fetch_count INTEGER NOT NULL DEFAULT 0 CHECK(fetch_count >= 0),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS media_fetch_tickets_lookup
  ON media_fetch_tickets(token_hash, expires_at, revoked_at);

-- This is a durable intent/receipt ledger only.  No Telegram media transport is
-- enabled until the configured Composio account proves a binary file-reference
-- capability (or an administrator explicitly configures a bot secret).
CREATE TABLE IF NOT EXISTS telegram_media_handoffs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('blocked','queued','sending','sent','failed','uncertain','cancelled')),
  provider_message_id TEXT,
  sha256 TEXT NOT NULL CHECK(sha256 GLOB '[0-9a-f]*' AND length(sha256)=64),
  byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, asset_id, storage_object_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS telegram_media_handoffs_creator_status
  ON telegram_media_handoffs(creator_id, status, created_at DESC);

CREATE TRIGGER IF NOT EXISTS asset_storage_object_creator_scope_insert
BEFORE INSERT ON asset_storage_objects
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'asset_storage_object_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_storage_object_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id ON asset_storage_objects
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'asset_storage_object_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_ingest_session_creator_scope_insert
BEFORE INSERT ON asset_ingest_sessions
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR (NEW.storage_object_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id))
BEGIN SELECT RAISE(ABORT,'asset_ingest_session_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_ingest_session_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id ON asset_ingest_sessions
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR (NEW.storage_object_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id))
BEGIN SELECT RAISE(ABORT,'asset_ingest_session_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS media_fetch_ticket_creator_scope_insert
BEFORE INSERT ON media_fetch_tickets
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified')
BEGIN SELECT RAISE(ABORT,'media_fetch_ticket_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS media_fetch_ticket_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id ON media_fetch_tickets
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified')
BEGIN SELECT RAISE(ABORT,'media_fetch_ticket_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS telegram_media_handoff_creator_scope_insert
BEFORE INSERT ON telegram_media_handoffs
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified' AND o.sha256=NEW.sha256 AND o.byte_count=NEW.byte_count)
BEGIN SELECT RAISE(ABORT,'telegram_media_handoff_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS telegram_media_handoff_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id,sha256,byte_count ON telegram_media_handoffs
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified' AND o.sha256=NEW.sha256 AND o.byte_count=NEW.byte_count)
BEGIN SELECT RAISE(ABORT,'telegram_media_handoff_creator_mismatch'); END;

