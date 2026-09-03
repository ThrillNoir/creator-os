PRAGMA foreign_keys = ON;

-- A reply may reference one immutable, creator-owned library asset.  The
-- snapshot fields make the explicit send intent stable if the asset later
-- receives a new source revision.
ALTER TABLE instagram_reply_drafts ADD COLUMN asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE instagram_reply_drafts ADD COLUMN asset_sha256 TEXT;
ALTER TABLE instagram_reply_drafts ADD COLUMN asset_bytes INTEGER;
ALTER TABLE instagram_reply_drafts ADD COLUMN asset_mime_type TEXT;
ALTER TABLE instagram_reply_drafts ADD COLUMN asset_r2_version TEXT;
ALTER TABLE instagram_reply_drafts ADD COLUMN asset_r2_etag TEXT;
ALTER TABLE message_attachments ADD COLUMN asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE message_attachments ADD COLUMN asset_sha256 TEXT;
ALTER TABLE message_attachments ADD COLUMN asset_bytes INTEGER;
ALTER TABLE message_attachments ADD COLUMN asset_mime_type TEXT;
ALTER TABLE message_attachments ADD COLUMN asset_r2_version TEXT;
ALTER TABLE message_attachments ADD COLUMN asset_r2_etag TEXT;

CREATE INDEX message_attachments_creator_asset
  ON message_attachments(creator_id,asset_id,created_at DESC);

DROP INDEX IF EXISTS instagram_reply_drafts_one_active_body;
CREATE UNIQUE INDEX instagram_reply_drafts_one_active_body_asset
  ON instagram_reply_drafts(creator_id,thread_id,body,COALESCE(asset_id,''))
  WHERE status IN ('draft','approved','sending');

CREATE INDEX instagram_reply_drafts_creator_asset
  ON instagram_reply_drafts(creator_id,asset_id,created_at DESC);
