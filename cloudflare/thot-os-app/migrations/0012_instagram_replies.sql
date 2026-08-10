PRAGMA foreign_keys = ON;

ALTER TABLE message_threads ADD COLUMN participant_external_id TEXT NOT NULL DEFAULT '';

CREATE TABLE instagram_reply_drafts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','approved','sending','sent','failed','uncertain','cancelled')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  provider_message_id TEXT,
  error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX instagram_reply_drafts_creator_thread_time
  ON instagram_reply_drafts(creator_id, thread_id, created_at DESC);

CREATE UNIQUE INDEX instagram_reply_drafts_one_active_body
  ON instagram_reply_drafts(creator_id, thread_id, body)
  WHERE status IN ('draft','approved','sending');

INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail)
VALUES (
  'instagram-replies-cloud-foundation',
  'adelaide',
  'adelaide-messages-instagram',
  'instagram_replies_foundation_created',
  'migration',
  '{"outboundEnabled":false,"liveMessagesSent":false,"approvalRequired":true}'
);
