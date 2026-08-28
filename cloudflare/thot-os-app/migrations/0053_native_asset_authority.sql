PRAGMA foreign_keys = ON;

-- New uploads are authoritative per asset.  This is additive: legacy Dropbox
-- assets retain their existing rows and are never reinterpreted as native.
CREATE TABLE IF NOT EXISTS asset_media_authorities (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  authority_kind TEXT NOT NULL CHECK(authority_kind IN ('r2_native','dropbox_legacy')),
  ingest_channel TEXT NOT NULL CHECK(ingest_channel IN ('cloudflare_direct','dropbox_catalogue')),
  canonical_storage_object_id TEXT REFERENCES asset_storage_objects(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'ingesting' CHECK(state IN ('ingesting','canonical_verified','preview_ready','preview_failed','archived')),
  preview_failure_code TEXT CHECK(preview_failure_code IS NULL OR length(preview_failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((authority_kind='r2_native' AND ingest_channel='cloudflare_direct' AND canonical_storage_object_id IS NOT NULL)
    OR (authority_kind='dropbox_legacy' AND ingest_channel='dropbox_catalogue'))
);

CREATE INDEX IF NOT EXISTS asset_media_authorities_creator_state
  ON asset_media_authorities(creator_id,authority_kind,state,updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS asset_media_authorities_canonical_object
  ON asset_media_authorities(canonical_storage_object_id)
  WHERE canonical_storage_object_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS asset_media_authority_creator_scope_insert
BEFORE INSERT ON asset_media_authorities
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR (NEW.canonical_storage_object_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM asset_storage_objects o
    WHERE o.id=NEW.canonical_storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id
      AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
  ))
BEGIN SELECT RAISE(ABORT,'asset_media_authority_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS asset_media_authority_creator_scope_update
BEFORE UPDATE OF asset_id,creator_id,canonical_storage_object_id ON asset_media_authorities
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR (NEW.canonical_storage_object_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM asset_storage_objects o
    WHERE o.id=NEW.canonical_storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id
      AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
  ))
BEGIN SELECT RAISE(ABORT,'asset_media_authority_creator_mismatch'); END;

-- Existing source-media sessions are preserved as legacy direct-fallback
-- sessions. Native sessions carry a client-generated idempotency key only;
-- multipart IDs and R2 keys remain server-side operational state.
ALTER TABLE asset_ingest_sessions ADD COLUMN ingest_kind TEXT NOT NULL DEFAULT 'legacy_direct'
  CHECK(ingest_kind IN ('legacy_direct','native_image'));
ALTER TABLE asset_ingest_sessions ADD COLUMN client_upload_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS asset_ingest_sessions_native_client_upload
  ON asset_ingest_sessions(creator_id,client_upload_id)
  WHERE client_upload_id IS NOT NULL;
