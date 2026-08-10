CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('shared_post','story','image','video','audio','file')),
  external_url TEXT,
  object_key TEXT,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','unavailable','failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(creator_id,message_id,source_key)
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments(creator_id,message_id,status);

INSERT INTO messaging_audit_events
  (id,creator_id,connection_id,event_type,actor,detail)
VALUES
  (lower(hex(randomblob(16))),'adelaide','adelaide-messages-instagram','message_attachments_enabled','migration','{"privateR2Media":true,"liveMessagesSent":false}');
