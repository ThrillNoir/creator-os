PRAGMA foreign_keys = ON;

-- A download link records an immutable verified original. Bearer and resume
-- tokens are deliberately stored as hashes only; neither token is durable
-- application data.
CREATE TABLE IF NOT EXISTS content_download_links (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  object_key TEXT NOT NULL CHECK(length(object_key) BETWEEN 1 AND 1024),
  byte_count INTEGER NOT NULL CHECK(byte_count > 0),
  mime_type TEXT NOT NULL CHECK(mime_type LIKE 'video/%'),
  sha256 TEXT NOT NULL CHECK(sha256 GLOB '[0-9a-f]*' AND length(sha256)=64),
  r2_version TEXT NOT NULL,
  r2_etag TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  session_id TEXT UNIQUE,
  session_token_hash TEXT UNIQUE,
  session_expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((session_id IS NULL AND session_token_hash IS NULL AND session_expires_at IS NULL)
    OR (session_id IS NOT NULL AND session_token_hash IS NOT NULL AND session_expires_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS content_download_links_token_state
  ON content_download_links(token_hash, expires_at, redeemed_at, revoked_at);
CREATE INDEX IF NOT EXISTS content_download_links_creator_asset_created
  ON content_download_links(creator_id, asset_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS content_download_link_creator_scope_insert
BEFORE INSERT ON content_download_links
WHEN NOT EXISTS (
  SELECT 1 FROM asset_storage_objects o
  WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id
    AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
    AND o.ingest_status='verified' AND o.object_key=NEW.object_key AND o.byte_count=NEW.byte_count
    AND o.verified_mime_type=NEW.mime_type AND o.sha256=NEW.sha256 AND o.r2_version=NEW.r2_version AND o.r2_etag=NEW.r2_etag
)
BEGIN SELECT RAISE(ABORT,'content_download_link_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS content_download_link_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id,object_key,byte_count,mime_type,sha256,r2_version,r2_etag ON content_download_links
WHEN NOT EXISTS (
  SELECT 1 FROM asset_storage_objects o
  WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id
    AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
    AND o.ingest_status='verified' AND o.object_key=NEW.object_key AND o.byte_count=NEW.byte_count
    AND o.verified_mime_type=NEW.mime_type AND o.sha256=NEW.sha256 AND o.r2_version=NEW.r2_version AND o.r2_etag=NEW.r2_etag
)
BEGIN SELECT RAISE(ABORT,'content_download_link_creator_mismatch'); END;
