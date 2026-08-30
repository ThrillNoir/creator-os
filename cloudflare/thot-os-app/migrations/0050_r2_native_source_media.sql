PRAGMA foreign_keys = ON;

-- `0044_creator_r2_library.sql` introduced the canonical-object catalogue.
-- This additive migration supplies the short-lived multipart state and the
-- explicit per-creator cutover switch required to make it safe to use as an
-- authoritative source. Dropbox remains the initial and rollback backend.
CREATE TABLE IF NOT EXISTS creator_media_source_states (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  active_backend TEXT NOT NULL DEFAULT 'dropbox' CHECK(active_backend IN ('dropbox','r2')),
  migration_state TEXT NOT NULL DEFAULT 'dropbox' CHECK(migration_state IN ('dropbox','planned','transferring','verified','r2_active','rollback','retired')),
  dropbox_fallback_enabled INTEGER NOT NULL DEFAULT 1 CHECK(dropbox_fallback_enabled IN (0,1)),
  cutover_by TEXT,
  cutover_at TEXT,
  rollback_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO creator_media_source_states (creator_id,active_backend,migration_state,dropbox_fallback_enabled)
SELECT id,'dropbox','dropbox',1 FROM creators;

CREATE TRIGGER IF NOT EXISTS creator_media_source_state_creator_insert
AFTER INSERT ON creators
BEGIN
  INSERT OR IGNORE INTO creator_media_source_states (creator_id,active_backend,migration_state,dropbox_fallback_enabled)
  VALUES (NEW.id,'dropbox','dropbox',1);
END;

-- Multipart identifiers are intentionally short-lived operational state. They
-- are never returned by a route, logged, or retained after finalization.
ALTER TABLE asset_ingest_sessions ADD COLUMN object_key TEXT;
ALTER TABLE asset_ingest_sessions ADD COLUMN multipart_upload_id TEXT;
ALTER TABLE asset_ingest_sessions ADD COLUMN chunk_bytes INTEGER;
ALTER TABLE asset_ingest_sessions ADD COLUMN uploaded_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE asset_ingest_sessions ADD COLUMN actor_email TEXT;
ALTER TABLE asset_ingest_sessions ADD COLUMN actor_role TEXT CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service'));

CREATE TABLE IF NOT EXISTS asset_ingest_parts (
  session_id TEXT NOT NULL REFERENCES asset_ingest_sessions(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK(part_number BETWEEN 1 AND 10000),
  byte_count INTEGER NOT NULL CHECK(byte_count > 0),
  etag TEXT,
  status TEXT NOT NULL CHECK(status IN ('uploading','uploaded','failed')),
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(session_id,part_number)
);

CREATE INDEX IF NOT EXISTS asset_ingest_parts_session_status
  ON asset_ingest_parts(session_id,status,part_number);

CREATE TABLE IF NOT EXISTS creator_media_source_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES asset_ingest_sessions(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service')),
  event_type TEXT NOT NULL CHECK(event_type IN ('intent_created','part_uploaded','ingest_verified','ingest_failed','cutover_requested','cutover_completed','rollback_completed')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS creator_media_source_events_creator_created
  ON creator_media_source_events(creator_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS asset_ingest_part_creator_scope_insert
BEFORE INSERT ON asset_ingest_parts
WHEN NOT EXISTS (
  SELECT 1 FROM asset_ingest_sessions s
  WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'asset_ingest_part_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_ingest_part_creator_scope_update
BEFORE UPDATE OF session_id,creator_id ON asset_ingest_parts
WHEN NOT EXISTS (
  SELECT 1 FROM asset_ingest_sessions s
  WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'asset_ingest_part_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS creator_media_source_event_creator_scope_insert
BEFORE INSERT ON creator_media_source_events
WHEN (NEW.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id))
  OR (NEW.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_ingest_sessions s WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id))
BEGIN SELECT RAISE(ABORT,'creator_media_source_event_creator_mismatch'); END;
