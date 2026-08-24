PRAGMA foreign_keys = ON;

-- Profile interaction data is deliberately outside the safe public snapshot.
-- The existing public-profile version remains the release root and historical
-- immutable versions are not rebuilt by this additive migration.
CREATE TABLE IF NOT EXISTS creator_public_profile_details (
  profile_version_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  public_display_name TEXT NOT NULL DEFAULT '' CHECK(length(public_display_name) <= 120),
  public_bio TEXT NOT NULL DEFAULT '' CHECK(length(public_bio) <= 2000),
  profile_media_id TEXT,
  banner_media_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS creator_public_contact_methods (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_version_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('sms','email')),
  contact_value TEXT NOT NULL CHECK(length(contact_value) BETWEEN 3 AND 320),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, channel),
  UNIQUE(id, creator_id),
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

-- Entity IDs remain stable when a destination is changed in a later profile
-- version. Revisions are the approved, immutable records rendered publicly.
CREATE TABLE IF NOT EXISTS creator_public_link_entities (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  retired_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id)
);

CREATE TABLE IF NOT EXISTS creator_public_link_revisions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL,
  profile_version_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  destination_url TEXT NOT NULL CHECK(destination_url LIKE 'https://%'),
  destination_host TEXT NOT NULL CHECK(length(destination_host) BETWEEN 1 AND 253),
  icon_key TEXT NOT NULL DEFAULT 'link' CHECK(icon_key IN ('link','instagram','tiktok','x','reddit','fansly','onlyfans','email','phone')),
  category TEXT NOT NULL DEFAULT 'social' CHECK(category IN ('social','creator','custom')),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, link_id),
  UNIQUE(profile_version_id, sort_order),
  FOREIGN KEY(link_id, creator_id) REFERENCES creator_public_link_entities(id, creator_id) ON DELETE RESTRICT,
  FOREIGN KEY(profile_version_id, creator_id) REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS creator_public_link_revisions_redirect
  ON creator_public_link_revisions(profile_version_id, link_id, enabled);

CREATE TABLE IF NOT EXISTS creator_adult_profiles (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL UNIQUE REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','retired')),
  published_version_id TEXT,
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_adult_profile_versions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES creator_adult_profiles(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  adult_bio TEXT NOT NULL DEFAULT '' CHECK(length(adult_bio) <= 2000),
  content_checksum TEXT NOT NULL CHECK(length(content_checksum)=64),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','published','superseded','revoked')),
  approved_by TEXT COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, version_number),
  UNIQUE(id, creator_id),
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS creator_adult_link_entities (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  retired_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id)
);

CREATE TABLE IF NOT EXISTS creator_adult_link_revisions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL,
  profile_version_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  destination_url TEXT NOT NULL CHECK(destination_url LIKE 'https://%'),
  destination_host TEXT NOT NULL CHECK(length(destination_host) BETWEEN 1 AND 253),
  icon_key TEXT NOT NULL DEFAULT 'link' CHECK(icon_key IN ('link','instagram','tiktok','x','reddit','fansly','onlyfans','email','phone')),
  category TEXT NOT NULL DEFAULT 'creator' CHECK(category IN ('social','creator','custom')),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, link_id),
  UNIQUE(profile_version_id, sort_order),
  FOREIGN KEY(link_id, creator_id) REFERENCES creator_adult_link_entities(id, creator_id) ON DELETE RESTRICT,
  FOREIGN KEY(profile_version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS creator_media_release_attestations (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','revoked')),
  approved_by TEXT COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, surface),
  UNIQUE(id, creator_id),
  FOREIGN KEY(asset_id, creator_id) REFERENCES assets(id, creator_id) ON DELETE RESTRICT,
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS creator_adult_profile_media (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_version_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  derivative_object_key TEXT NOT NULL UNIQUE CHECK(length(derivative_object_key) BETWEEN 1 AND 1024),
  alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text) <= 500),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, sort_order),
  UNIQUE(id, creator_id),
  FOREIGN KEY(profile_version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id, creator_id) REFERENCES assets(id, creator_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS creator_adult_profile_media_render
  ON creator_adult_profile_media(profile_version_id, enabled, sort_order);

CREATE TABLE IF NOT EXISTS creator_adult_profile_publications (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES creator_adult_profiles(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('published','rolled_back','failed')),
  published_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  adult_snapshot_key TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, version_id, status),
  FOREIGN KEY(version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS creator_public_profile_details_draft_only
BEFORE INSERT ON creator_public_profile_details
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_profile_details_require_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_public_profile_details_draft_update_only
BEFORE UPDATE ON creator_public_profile_details
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_profile_details_require_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_public_contact_method_draft_only
BEFORE INSERT ON creator_public_contact_methods
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_contact_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_public_contact_method_draft_update_only
BEFORE UPDATE ON creator_public_contact_methods
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_contact_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_public_link_revision_draft_only
BEFORE INSERT ON creator_public_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_link_revision_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_public_link_revision_draft_update_only
BEFORE UPDATE ON creator_public_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_link_revision_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_version_creator_scope
BEFORE INSERT ON creator_adult_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'adult_profile_version_creator_mismatch'); END;

-- Composite foreign keys ensure the version owner exists, but the profile ID
-- also needs to remain owned by that creator whenever either scope column is
-- changed. Without this update guard, a draft version could be re-parented to
-- another creator's profile after insertion.
CREATE TRIGGER IF NOT EXISTS creator_adult_profile_version_creator_scope_update
BEFORE UPDATE OF profile_id, creator_id ON creator_adult_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'adult_profile_version_creator_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_single_draft
BEFORE INSERT ON creator_adult_profile_versions
WHEN NEW.status='draft' AND EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.profile_id=NEW.profile_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_profile_already_has_a_draft'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_version_immutable
BEFORE UPDATE OF adult_bio,content_checksum ON creator_adult_profile_versions
WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'adult_profile_version_is_immutable'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_version_no_draft_reopen
BEFORE UPDATE OF status ON creator_adult_profile_versions
WHEN OLD.status<>'draft' AND NEW.status='draft'
BEGIN SELECT RAISE(ABORT,'adult_profile_version_cannot_reopen_draft'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_version_requires_approval
BEFORE UPDATE OF status,approved_by,approved_at ON creator_adult_profile_versions
WHEN OLD.status='draft' AND NEW.status IN ('approved','published') AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL)
BEGIN SELECT RAISE(ABORT,'adult_profile_version_requires_explicit_approval'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_link_revision_draft_only
BEFORE INSERT ON creator_adult_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_link_revision_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_link_revision_draft_update_only
BEFORE UPDATE ON creator_adult_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_link_revision_requires_draft_version'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_media_requires_release
BEFORE INSERT ON creator_adult_profile_media
WHEN NOT EXISTS (
  SELECT 1 FROM creator_adult_profile_versions v
  JOIN assets a ON a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1
  JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id AND c.safety='nsfw'
  JOIN creator_media_release_attestations r ON r.asset_id=a.id AND r.creator_id=a.creator_id AND r.surface='adult_profile' AND r.status='approved'
  WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft'
    AND NOT EXISTS (
      SELECT 1 FROM asset_people ap
      LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
      WHERE ap.asset_id=a.id AND ap.creator_id=a.creator_id AND pc.person_id IS NULL
    )
)
BEGIN SELECT RAISE(ABORT,'adult_media_requires_approved_release'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_media_requires_release_update
BEFORE UPDATE OF asset_id,profile_version_id,derivative_object_key,enabled ON creator_adult_profile_media
WHEN NOT EXISTS (
  SELECT 1 FROM creator_adult_profile_versions v
  JOIN assets a ON a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1
  JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id AND c.safety='nsfw'
  JOIN creator_media_release_attestations r ON r.asset_id=a.id AND r.creator_id=a.creator_id AND r.surface='adult_profile' AND r.status='approved'
  WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft'
    AND NOT EXISTS (
      SELECT 1 FROM asset_people ap
      LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
      WHERE ap.asset_id=a.id AND ap.creator_id=a.creator_id AND pc.person_id IS NULL
    )
)
BEGIN SELECT RAISE(ABORT,'adult_media_requires_approved_release'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_published_version
BEFORE UPDATE OF published_version_id,status ON creator_adult_profiles
WHEN NEW.published_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM creator_adult_profile_versions v
  WHERE v.id=NEW.published_version_id AND v.profile_id=NEW.id AND v.creator_id=NEW.creator_id AND v.status IN ('approved','published')
)
BEGIN SELECT RAISE(ABORT,'adult_profile_requires_approved_version'); END;

-- The two foreign keys below independently prove that a profile and a
-- version exist, but neither proves that they belong together. Keep the
-- publication receipt bound to one creator/profile/version tuple on both
-- write paths.
CREATE TRIGGER IF NOT EXISTS creator_adult_profile_publication_scope
BEFORE INSERT ON creator_adult_profile_publications
WHEN NOT EXISTS (
  SELECT 1
  FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v
    ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'adult_profile_publication_scope_invalid'); END;

CREATE TRIGGER IF NOT EXISTS creator_adult_profile_publication_scope_update
BEFORE UPDATE OF profile_id, creator_id, version_id ON creator_adult_profile_publications
WHEN NOT EXISTS (
  SELECT 1
  FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v
    ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'adult_profile_publication_scope_invalid'); END;
