PRAGMA foreign_keys = ON;

-- An explicit, immutable approval of a private draft. The public gateway never
-- reads authoring tables; the control Worker projects only approved versions.
CREATE TABLE creator_portfolio_release_versions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  adult_profile_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('approved','publishing','published','withdrawing','withdrawn','failed')),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(manifest_json) BETWEEN 2 AND 32768),
  approved_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  withdrawn_at TEXT,
  failure_code TEXT,
  UNIQUE(id, creator_id),
  FOREIGN KEY(adult_profile_version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id)
);
CREATE INDEX creator_portfolio_release_creator_status ON creator_portfolio_release_versions(creator_id,status,approved_at DESC);
CREATE UNIQUE INDEX creator_portfolio_release_one_transition ON creator_portfolio_release_versions(creator_id)
  WHERE status IN ('publishing','withdrawing');

CREATE TRIGGER creator_portfolio_release_approval_immutable
BEFORE UPDATE OF creator_id,adult_profile_version_id,manifest_json,approved_by,approved_at ON creator_portfolio_release_versions
BEGIN SELECT RAISE(ABORT,'portfolio_release_approval_immutable'); END;

CREATE TABLE creator_portfolio_release_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  release_version_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('approved','publish_requested','published','publish_failed','withdraw_requested','withdrawn','withdraw_failed')),
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(release_version_id, creator_id) REFERENCES creator_portfolio_release_versions(id, creator_id)
);
CREATE INDEX creator_portfolio_release_events_recent ON creator_portfolio_release_events(creator_id,created_at DESC,id DESC);
