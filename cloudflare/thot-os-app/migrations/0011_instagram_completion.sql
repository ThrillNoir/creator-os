PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS instagram_sync_state (
  creator_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  last_messages_sync_at TEXT,
  last_analytics_sync_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instagram_analytics_snapshots (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  reach INTEGER,
  follower_count INTEGER,
  accounts_engaged INTEGER,
  total_interactions INTEGER,
  profile_views INTEGER,
  website_clicks INTEGER,
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_instagram_analytics_creator_time
  ON instagram_analytics_snapshots (creator_id, collected_at DESC);

CREATE TABLE IF NOT EXISTS instagram_media_metrics (
  creator_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  permalink TEXT,
  media_type TEXT,
  media_product_type TEXT,
  published_at TEXT,
  like_count INTEGER,
  comments_count INTEGER,
  view_count INTEGER,
  saved_count INTEGER,
  shares_count INTEGER,
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id, media_id)
);

INSERT INTO instagram_sync_state (creator_id, connection_id)
VALUES ('adelaide', 'adelaide-messages-instagram')
ON CONFLICT(creator_id) DO NOTHING;
