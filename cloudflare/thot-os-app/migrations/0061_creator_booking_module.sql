PRAGMA foreign_keys = ON;

-- Booking settings are private, version-bound draft data. They are never a
-- projection of the safe public profile.
CREATE TABLE IF NOT EXISTS creator_booking_configs (
  profile_version_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS creator_booking_config_draft_only
BEFORE INSERT ON creator_booking_configs
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'booking_config_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_booking_config_draft_update_only
BEFORE UPDATE ON creator_booking_configs
WHEN NEW.profile_version_id<>OLD.profile_version_id
  OR NEW.creator_id<>OLD.creator_id
  OR NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
  OR NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'booking_config_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_booking_config_draft_delete_only
BEFORE DELETE ON creator_booking_configs
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'booking_config_requires_draft_version'); END;
