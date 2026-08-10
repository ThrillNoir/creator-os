PRAGMA foreign_keys = ON;

CREATE TABLE messaging_connections (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'observe' CHECK(mode IN ('observe','assist','operate')),
  read_enabled INTEGER NOT NULL DEFAULT 0 CHECK(read_enabled IN (0,1)),
  write_enabled INTEGER NOT NULL DEFAULT 0 CHECK(write_enabled IN (0,1)),
  outbound_validated INTEGER NOT NULL DEFAULT 0 CHECK(outbound_validated IN (0,1)),
  emergency_paused INTEGER NOT NULL DEFAULT 0 CHECK(emergency_paused IN (0,1)),
  status TEXT NOT NULL DEFAULT 'not_connected',
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, platform, display_name)
);

CREATE INDEX messaging_connections_creator_platform
  ON messaging_connections(creator_id, platform, status);

CREATE TABLE message_threads (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  external_thread_id TEXT NOT NULL,
  participant_name TEXT NOT NULL DEFAULT '',
  participant_handle TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(connection_id, external_thread_id)
);

CREATE INDEX message_threads_creator_activity
  ON message_threads(creator_id, last_message_at DESC, updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  external_message_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  sender_type TEXT NOT NULL DEFAULT 'unknown',
  body TEXT NOT NULL,
  sent_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'observed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, external_message_id)
);

CREATE INDEX messages_creator_thread_time
  ON messages(creator_id, thread_id, sent_at, created_at);

CREATE TABLE telegram_send_log (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES messaging_connections(id) ON DELETE SET NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','cancelled')),
  provider_message_id TEXT,
  requested_by TEXT NOT NULL,
  error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX telegram_send_log_creator_time
  ON telegram_send_log(creator_id, created_at DESC);

CREATE TABLE messaging_audit_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES messaging_connections(id) ON DELETE SET NULL,
  thread_id TEXT REFERENCES message_threads(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX messaging_audit_creator_time
  ON messaging_audit_events(creator_id, created_at DESC);

INSERT INTO messaging_connections
  (id,creator_id,account_id,platform,display_name,handle,mode,read_enabled,write_enabled,outbound_validated,status,last_error)
VALUES
  ('adelaide-messages-telegram','adelaide',NULL,'telegram','Agency Telegram bot','','observe',0,0,0,'migration_pending','Cloud Telegram delivery and reply collection are not connected yet.'),
  ('adelaide-messages-onlyfans','adelaide',NULL,'onlyfans','Adelaide OnlyFans','','observe',0,0,0,'not_connected','Add a signed creator browser connection before collecting messages.')
ON CONFLICT(id) DO NOTHING;

INSERT INTO messaging_connections
  (id,creator_id,account_id,platform,display_name,handle,mode,read_enabled,write_enabled,outbound_validated,status,last_error)
SELECT 'adelaide-messages-instagram','adelaide',id,'instagram',label,handle,'observe',0,0,0,
  CASE WHEN connection_status='connected' THEN 'connected' ELSE connection_status END,
  CASE WHEN connection_status='connected' THEN 'Instagram Messaging permissions still need separate validation.' ELSE warning_message END
FROM operational_accounts WHERE id='adelaide-instagram-main'
ON CONFLICT(id) DO NOTHING;

INSERT INTO messaging_connections
  (id,creator_id,account_id,platform,display_name,handle,mode,read_enabled,write_enabled,outbound_validated,status,last_error)
SELECT 'adelaide-messages-fansly','adelaide',id,'fansly',label,handle,'observe',0,0,0,
  'device_bridge_ready','Message collection has not moved to the Cloudflare bridge yet.'
FROM operational_accounts WHERE id='adelaide-fansly-main'
ON CONFLICT(id) DO NOTHING;

INSERT INTO messaging_audit_events (id,creator_id,event_type,actor,detail)
VALUES ('messages-cloud-foundation','adelaide','cloud_foundation_created','migration','{"outboundEnabled":false,"liveMessagesSent":false}');
