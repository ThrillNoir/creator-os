PRAGMA foreign_keys = ON;

-- Appearance is restricted to a fixed design contract. The public Worker only
-- receives validated tokens, never creator-authored CSS, classes, URLs, or
-- original media keys.
ALTER TABLE creator_public_profile_details ADD COLUMN theme_key TEXT NOT NULL DEFAULT 'thot-noir';
ALTER TABLE creator_public_profile_details ADD COLUMN button_style TEXT NOT NULL DEFAULT 'solid-rounded';
ALTER TABLE creator_public_profile_details ADD COLUMN background_mode TEXT NOT NULL DEFAULT 'gradient';
ALTER TABLE creator_public_profile_details ADD COLUMN background_color TEXT NOT NULL DEFAULT '#0c0911';
ALTER TABLE creator_public_profile_details ADD COLUMN primary_color TEXT NOT NULL DEFAULT '#7655f6';
ALTER TABLE creator_public_profile_details ADD COLUMN text_color TEXT NOT NULL DEFAULT '#f8f5ff';
ALTER TABLE creator_public_profile_details ADD COLUMN card_color TEXT NOT NULL DEFAULT '#211a29';
ALTER TABLE creator_public_profile_details ADD COLUMN radius_scale TEXT NOT NULL DEFAULT 'comfortable';

CREATE TABLE IF NOT EXISTS creator_adult_profile_appearances (
  profile_version_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  theme_key TEXT NOT NULL DEFAULT 'thot-noir',
  button_style TEXT NOT NULL DEFAULT 'solid-rounded',
  background_mode TEXT NOT NULL DEFAULT 'gradient',
  background_color TEXT NOT NULL DEFAULT '#0c0911',
  primary_color TEXT NOT NULL DEFAULT '#7655f6',
  text_color TEXT NOT NULL DEFAULT '#f8f5ff',
  card_color TEXT NOT NULL DEFAULT '#211a29',
  radius_scale TEXT NOT NULL DEFAULT 'comfortable',
  inherit_sfw_theme INTEGER NOT NULL DEFAULT 0 CHECK(inherit_sfw_theme IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_appearance_draft_only
BEFORE INSERT ON creator_adult_profile_appearances
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_profile_appearance_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_appearance_draft_update_only
BEFORE UPDATE ON creator_adult_profile_appearances
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_profile_appearance_requires_draft_version'); END;
