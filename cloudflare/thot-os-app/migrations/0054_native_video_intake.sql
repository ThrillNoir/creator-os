PRAGMA foreign_keys = ON;

-- Video ingestion is isolated from the image session protocol so the existing
-- image authority remains stable while large uploads receive their own bounded
-- lifecycle, retry, and provider-readiness state.
CREATE TABLE IF NOT EXISTS asset_video_ingest_sessions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE RESTRICT,
  source_revision TEXT NOT NULL,
  expected_sha256 TEXT NOT NULL CHECK(expected_sha256 GLOB '[0-9a-f]*' AND length(expected_sha256)=64),
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes > 0 AND expected_bytes <= 5368709120),
  expected_mime_type TEXT NOT NULL CHECK(expected_mime_type IN ('video/mp4','video/quicktime')),
  status TEXT NOT NULL CHECK(status IN ('created','uploading','finalized','aborted','expired','failed')),
  finalization_state TEXT NOT NULL DEFAULT 'incomplete' CHECK(finalization_state IN ('incomplete','completing','completed_unreconciled','verifying','verified','quarantined','failed','expired','aborted')),
  expires_at TEXT NOT NULL,
  object_key TEXT NOT NULL CHECK(length(object_key) BETWEEN 1 AND 1024),
  multipart_upload_id TEXT,
  chunk_bytes INTEGER NOT NULL CHECK(chunk_bytes BETWEEN 5242880 AND 214748364),
  uploaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(uploaded_bytes >= 0),
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service')),
  client_upload_id TEXT NOT NULL CHECK(length(client_upload_id)=36),
  completed_r2_version TEXT,
  completed_r2_etag TEXT,
  completion_observed_at TEXT,
  reconcile_attempts INTEGER NOT NULL DEFAULT 0 CHECK(reconcile_attempts BETWEEN 0 AND 20),
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id,client_upload_id)
);

CREATE INDEX IF NOT EXISTS asset_video_ingest_sessions_creator_status
  ON asset_video_ingest_sessions(creator_id,status,expires_at);

CREATE TABLE IF NOT EXISTS asset_video_ingest_parts (
  session_id TEXT NOT NULL REFERENCES asset_video_ingest_sessions(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS asset_video_ingest_parts_session_status
  ON asset_video_ingest_parts(session_id,status,part_number);

CREATE TABLE IF NOT EXISTS asset_video_playback_states (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  canonical_storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','canonical_verified','processing_queued','processing','playback_ready','processing_failed','archived')),
  source_codec TEXT CHECK(source_codec IN ('h264','h265')),
  playback_provider TEXT NOT NULL DEFAULT 'none' CHECK(playback_provider IN ('none','stream')),
  playback_external_id TEXT,
  playback_manifest_path TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 20),
  next_retry_at TEXT,
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((playback_provider='none' AND playback_external_id IS NULL AND playback_manifest_path IS NULL)
    OR playback_provider='stream')
);

CREATE INDEX IF NOT EXISTS asset_video_playback_states_creator_state
  ON asset_video_playback_states(creator_id,state,updated_at DESC);

CREATE TABLE IF NOT EXISTS asset_video_ingest_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES asset_video_ingest_sessions(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service')),
  event_type TEXT NOT NULL CHECK(event_type IN ('intent_created','part_uploaded','ingest_verified','ingest_failed','processing_queued','processing_failed','playback_ready')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS asset_video_ingest_events_creator_created
  ON asset_video_ingest_events(creator_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS asset_video_ingest_session_creator_scope_insert
BEFORE INSERT ON asset_video_ingest_sessions
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.asset_id=NEW.asset_id AND o.creator_id=NEW.creator_id AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media')
BEGIN SELECT RAISE(ABORT,'asset_video_ingest_session_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_video_ingest_session_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id ON asset_video_ingest_sessions
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.asset_id=NEW.asset_id AND o.creator_id=NEW.creator_id AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media')
BEGIN SELECT RAISE(ABORT,'asset_video_ingest_session_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_video_ingest_part_creator_scope_insert
BEFORE INSERT ON asset_video_ingest_parts
WHEN NOT EXISTS (SELECT 1 FROM asset_video_ingest_sessions s WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'asset_video_ingest_part_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_video_ingest_part_creator_scope_update
BEFORE UPDATE OF session_id,creator_id ON asset_video_ingest_parts
WHEN NOT EXISTS (SELECT 1 FROM asset_video_ingest_sessions s WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'asset_video_ingest_part_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_video_playback_creator_scope_insert
BEFORE INSERT ON asset_video_playback_states
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.canonical_storage_object_id AND o.asset_id=NEW.asset_id AND o.creator_id=NEW.creator_id AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media')
BEGIN SELECT RAISE(ABORT,'asset_video_playback_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_video_playback_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,canonical_storage_object_id ON asset_video_playback_states
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.canonical_storage_object_id AND o.asset_id=NEW.asset_id AND o.creator_id=NEW.creator_id AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media')
BEGIN SELECT RAISE(ABORT,'asset_video_playback_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_video_ingest_event_creator_scope_insert
BEFORE INSERT ON asset_video_ingest_events
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR (NEW.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_video_ingest_sessions s WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id AND s.asset_id=NEW.asset_id))
BEGIN SELECT RAISE(ABORT,'asset_video_ingest_event_creator_mismatch'); END;
