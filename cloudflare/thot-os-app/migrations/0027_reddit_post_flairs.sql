PRAGMA foreign_keys = ON;

ALTER TABLE reddit_communities ADD COLUMN flairs_checked_at TEXT;

ALTER TABLE social_posts ADD COLUMN reddit_flair_id TEXT;
ALTER TABLE social_posts ADD COLUMN reddit_flair_text TEXT;

CREATE TABLE reddit_community_flairs (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  community_id INTEGER NOT NULL REFERENCES reddit_communities(id) ON DELETE CASCADE,
  flair_id TEXT NOT NULL,
  flair_text TEXT NOT NULL,
  text_editable INTEGER NOT NULL DEFAULT 0 CHECK(text_editable IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id,community_id,flair_id)
);

CREATE INDEX reddit_community_flairs_available
  ON reddit_community_flairs(creator_id,community_id,active,flair_text);

CREATE TRIGGER reddit_community_flairs_creator_insert
BEFORE INSERT ON reddit_community_flairs
WHEN NOT EXISTS (
  SELECT 1 FROM reddit_communities c
  WHERE c.id=NEW.community_id AND c.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'reddit_flair_creator_scope');
END;

CREATE TRIGGER reddit_community_flairs_creator_update
BEFORE UPDATE OF creator_id,community_id ON reddit_community_flairs
WHEN NOT EXISTS (
  SELECT 1 FROM reddit_communities c
  WHERE c.id=NEW.community_id AND c.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'reddit_flair_creator_scope');
END;
