PRAGMA foreign_keys = ON;

ALTER TABLE social_posts ADD COLUMN provider_container_id TEXT;
ALTER TABLE social_posts ADD COLUMN provider_container_type TEXT;

INSERT INTO provider_connections
  (creator_id,service,connected_account_id,composio_user_id,status,display_name,last_error)
VALUES
  ('adelaide','instagram','expired-local-connection','creator-os:adelaide:adelaide-instagram-main','expired','@adelaide.suede','Reconnect and verify Adelaide’s Instagram account before publishing.')
ON CONFLICT(creator_id,service) DO NOTHING;
