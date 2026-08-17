PRAGMA foreign_keys = ON;

-- Public profiles are a distinct publication domain.  Their source records
-- are stored in D1, but a public Worker receives only an approved projection.
CREATE TABLE IF NOT EXISTS creator_public_profiles (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL UNIQUE REFERENCES creators(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK(slug GLOB '[a-z0-9][a-z0-9-]*'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','retired')),
  published_version_id TEXT,
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_public_profile_versions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES creator_public_profiles(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  headline TEXT NOT NULL DEFAULT '' CHECK(length(headline) <= 280),
  bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 2000),
  avatar_media_id TEXT,
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

CREATE INDEX IF NOT EXISTS creator_public_profile_versions_profile_status
  ON creator_public_profile_versions(profile_id, status, version_number DESC);

CREATE TABLE IF NOT EXISTS creator_public_links (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_version_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  destination_url TEXT NOT NULL CHECK(destination_url LIKE 'https://%'),
  destination_host TEXT NOT NULL CHECK(length(destination_host) BETWEEN 1 AND 253),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, sort_order),
  UNIQUE(id, creator_id),
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS creator_public_links_version_order
  ON creator_public_links(profile_version_id, sort_order);

-- A public derivative must be explicitly approved.  It is never inferred from
-- a social handle, a Dropbox file, or a private preview.
CREATE TABLE IF NOT EXISTS creator_public_media (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  public_object_key TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text) <= 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','revoked')),
  approved_by TEXT COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id),
  FOREIGN KEY(asset_id, creator_id) REFERENCES assets(id, creator_id) ON DELETE RESTRICT,
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS creator_public_profile_publications (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES creator_public_profiles(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('published','rolled_back','failed')),
  published_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  public_snapshot_key TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, version_id, status),
  FOREIGN KEY(version_id, creator_id) REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS creator_public_profile_publications_creator_created
  ON creator_public_profile_publications(creator_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS public_profile_version_creator_insert
BEFORE INSERT ON creator_public_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS public_profile_version_creator_update
BEFORE UPDATE OF profile_id, creator_id ON creator_public_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS public_profile_version_approval_transition
BEFORE UPDATE OF status, approved_by, approved_at ON creator_public_profile_versions
WHEN OLD.status='draft' AND NEW.status IN ('approved','published')
 AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_requires_explicit_approval');
END;

CREATE TRIGGER IF NOT EXISTS public_profile_version_immutable_after_approval
BEFORE UPDATE OF display_name, headline, bio, avatar_media_id, content_checksum ON creator_public_profile_versions
WHEN OLD.status<>'draft'
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS creator_public_links_version_creator_insert
BEFORE INSERT ON creator_public_links
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN
  SELECT RAISE(ABORT, 'public_link_requires_draft_version_for_creator');
END;

CREATE TRIGGER IF NOT EXISTS creator_public_links_version_creator_update
BEFORE UPDATE OF profile_version_id, creator_id, label, destination_url, destination_host, sort_order ON creator_public_links
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN
  SELECT RAISE(ABORT, 'public_link_requires_draft_version_for_creator');
END;

CREATE TRIGGER IF NOT EXISTS creator_public_media_sfw_asset_insert
BEFORE INSERT ON creator_public_media
WHEN NOT EXISTS (SELECT 1 FROM assets a JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
                 WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1 AND c.safety='sfw')
BEGIN
  SELECT RAISE(ABORT, 'public_media_requires_approved_sfw_asset');
END;

CREATE TRIGGER IF NOT EXISTS creator_public_media_sfw_asset_update
BEFORE UPDATE OF asset_id, creator_id ON creator_public_media
WHEN NOT EXISTS (SELECT 1 FROM assets a JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
                 WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1 AND c.safety='sfw')
BEGIN
  SELECT RAISE(ABORT, 'public_media_requires_approved_sfw_asset');
END;

CREATE TRIGGER IF NOT EXISTS creator_public_profile_published_version
BEFORE UPDATE OF published_version_id, status ON creator_public_profiles
WHEN NEW.published_version_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.published_version_id AND v.profile_id=NEW.id AND v.creator_id=NEW.creator_id AND v.status IN ('approved','published'))
BEGIN
  SELECT RAISE(ABORT, 'public_profile_requires_approved_version');
END;

CREATE TRIGGER IF NOT EXISTS creator_public_profile_publication_creator_insert
BEFORE INSERT ON creator_public_profile_publications
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.version_id AND v.profile_id=NEW.profile_id AND v.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_publication_creator_mismatch');
END;
