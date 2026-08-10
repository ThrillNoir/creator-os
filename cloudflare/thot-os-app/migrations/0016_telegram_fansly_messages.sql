PRAGMA foreign_keys = ON;

CREATE TABLE premium_message_drafts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('fansly','onlyfans')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','claimed','sent','failed','cancelled')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  error TEXT,
  receipt TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX premium_message_drafts_creator_thread
  ON premium_message_drafts(creator_id,thread_id,created_at DESC);

CREATE TABLE premium_thread_sync_state (
  thread_id TEXT PRIMARY KEY REFERENCES message_threads(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','complete','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_requested_at TEXT,
  last_completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE messaging_connections
SET last_error='Open and pair Fansly Messages to begin creator-scoped collection.',updated_at=CURRENT_TIMESTAMP
WHERE id='adelaide-messages-fansly' AND creator_id='adelaide';

INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail)
VALUES ('fansly-cloud-message-bridge','adelaide','adelaide-messages-fansly','fansly_cloud_bridge_enabled','migration','{"browserMediated":true,"automaticSend":false,"liveMessagesSent":false}');
