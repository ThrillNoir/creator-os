PRAGMA foreign_keys = ON;

ALTER TABLE social_posts ADD COLUMN failure_reviewed_at TEXT;
ALTER TABLE social_posts ADD COLUMN failure_reviewed_by TEXT;

CREATE INDEX social_posts_creator_failure_review
  ON social_posts(creator_id, platform, status, failure_reviewed_at);
