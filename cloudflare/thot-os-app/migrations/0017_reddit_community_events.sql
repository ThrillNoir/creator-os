CREATE TABLE IF NOT EXISTS reddit_community_events (
  id TEXT PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES reddit_communities(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reddit_community_events_creator_created
  ON reddit_community_events(creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reddit_community_events_community_created
  ON reddit_community_events(community_id, created_at DESC);
