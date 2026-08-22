PRAGMA foreign_keys = ON;

-- Originals remain private. Only derivative records can be attached to a
-- profile draft; public projections use controlled identifiers, never keys.
CREATE TABLE creator_profile_image_uploads (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  image_role TEXT NOT NULL CHECK(image_role IN ('avatar','background')),
  original_object_key TEXT NOT NULL UNIQUE CHECK(length(original_object_key) BETWEEN 1 AND 1024),
  declared_content_type TEXT NOT NULL CHECK(length(declared_content_type) BETWEEN 1 AND 120),
  detected_content_type TEXT,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 12582912),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL CHECK(status IN ('uploaded','processing','processed','rejected','detached')),
  reason_code TEXT NOT NULL DEFAULT '' CHECK(length(reason_code) <= 80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id)
);

CREATE TABLE creator_profile_image_derivatives (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL,
  derivative_kind TEXT NOT NULL CHECK(derivative_kind IN ('display','preview')),
  object_key TEXT NOT NULL UNIQUE CHECK(length(object_key) BETWEEN 1 AND 1024),
  content_type TEXT NOT NULL CHECK(content_type='image/webp'),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1280),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1280),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(upload_id, derivative_kind),
  UNIQUE(id, creator_id),
  FOREIGN KEY(upload_id, creator_id) REFERENCES creator_profile_image_uploads(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_profile_image_attachments (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  image_role TEXT NOT NULL CHECK(image_role IN ('avatar','background')),
  public_profile_version_id TEXT,
  adult_profile_version_id TEXT,
  derivative_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'attached' CHECK(status IN ('attached','detached')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detached_at TEXT,
  UNIQUE(id, creator_id),
  FOREIGN KEY(public_profile_version_id, creator_id) REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE,
  FOREIGN KEY(adult_profile_version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE,
  FOREIGN KEY(derivative_id, creator_id) REFERENCES creator_profile_image_derivatives(id, creator_id) ON DELETE RESTRICT,
  CHECK((surface='public_sfw' AND public_profile_version_id IS NOT NULL AND adult_profile_version_id IS NULL) OR (surface='adult_profile' AND adult_profile_version_id IS NOT NULL AND public_profile_version_id IS NULL))
);

-- Separate indexes are required because SQLite treats NULLs as distinct in a
-- composite UNIQUE index. One mixed-surface index would therefore allow more
-- than one active attachment whenever the unused version column is NULL.
CREATE UNIQUE INDEX creator_profile_image_attachment_active_public_role
  ON creator_profile_image_attachments(creator_id,public_profile_version_id,image_role)
  WHERE status='attached' AND surface='public_sfw';

CREATE UNIQUE INDEX creator_profile_image_attachment_active_adult_role
  ON creator_profile_image_attachments(creator_id,adult_profile_version_id,image_role)
  WHERE status='attached' AND surface='adult_profile';

CREATE TRIGGER creator_profile_image_attachment_scope
BEFORE INSERT ON creator_profile_image_attachments
WHEN NOT EXISTS (
  SELECT 1 FROM creator_profile_image_derivatives d
  JOIN creator_profile_image_uploads u ON u.id=d.upload_id AND u.creator_id=d.creator_id
  WHERE d.id=NEW.derivative_id AND d.creator_id=NEW.creator_id AND u.surface=NEW.surface
    AND u.image_role=NEW.image_role AND u.status='processed'
)
BEGIN SELECT RAISE(ABORT,'profile_image_attachment_scope_invalid'); END;

CREATE TRIGGER creator_profile_image_attachment_draft_only
BEFORE INSERT ON creator_profile_image_attachments
WHEN (NEW.surface='public_sfw' AND NOT EXISTS (SELECT 1 FROM creator_public_profile_versions WHERE id=NEW.public_profile_version_id AND creator_id=NEW.creator_id AND status='draft'))
  OR (NEW.surface='adult_profile' AND NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions WHERE id=NEW.adult_profile_version_id AND creator_id=NEW.creator_id AND status='draft'))
BEGIN SELECT RAISE(ABORT,'profile_image_attachment_requires_draft'); END;

CREATE TRIGGER creator_profile_image_attachment_detach_draft_only
BEFORE UPDATE OF status ON creator_profile_image_attachments
WHEN OLD.status='attached' AND NEW.status='detached' AND (
  (OLD.surface='public_sfw' AND NOT EXISTS (SELECT 1 FROM creator_public_profile_versions WHERE id=OLD.public_profile_version_id AND creator_id=OLD.creator_id AND status='draft'))
  OR (OLD.surface='adult_profile' AND NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions WHERE id=OLD.adult_profile_version_id AND creator_id=OLD.creator_id AND status='draft'))
)
BEGIN SELECT RAISE(ABORT,'profile_image_detach_requires_draft'); END;
