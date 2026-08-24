PRAGMA foreign_keys = ON;

-- A profile can be authoritative in D1 before its read projection reaches KV.
-- The projection is replayable by this stable operation ID; KV is never the
-- first durable record of a release.
CREATE TABLE IF NOT EXISTS creator_profile_projection_deliveries (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation_outbox(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  action TEXT NOT NULL CHECK(action IN ('publish','withdraw')),
  profile_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  snapshot_key TEXT NOT NULL CHECK(length(snapshot_key) BETWEEN 1 AND 512),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error_code TEXT,
  projected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(surface, action, profile_id, version_id)
);

CREATE INDEX IF NOT EXISTS creator_profile_projection_deliveries_pending
  ON creator_profile_projection_deliveries(status, updated_at);

CREATE TRIGGER IF NOT EXISTS creator_profile_projection_delivery_scope_insert
BEFORE INSERT ON creator_profile_projection_deliveries
WHEN (NEW.surface='public_sfw' AND NOT EXISTS (
  SELECT 1 FROM creator_public_profiles p
  JOIN creator_public_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)) OR (NEW.surface='adult_profile' AND NOT EXISTS (
  SELECT 1 FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
))
BEGIN SELECT RAISE(ABORT,'creator_profile_projection_delivery_scope_invalid'); END;

CREATE TRIGGER IF NOT EXISTS creator_profile_projection_delivery_scope_update
BEFORE UPDATE OF creator_id, surface, profile_id, version_id ON creator_profile_projection_deliveries
WHEN (NEW.surface='public_sfw' AND NOT EXISTS (
  SELECT 1 FROM creator_public_profiles p
  JOIN creator_public_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)) OR (NEW.surface='adult_profile' AND NOT EXISTS (
  SELECT 1 FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
))
BEGIN SELECT RAISE(ABORT,'creator_profile_projection_delivery_scope_invalid'); END;
