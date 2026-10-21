PRAGMA foreign_keys = ON;

-- A selected Library photo remains a reference to its verified canonical
-- original. Only processed display/preview derivatives live in profile MEDIA.
CREATE TABLE creator_profile_library_photo_derivatives (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE RESTRICT,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  source_r2_version TEXT NOT NULL,
  source_r2_etag TEXT NOT NULL,
  display_object_key TEXT NOT NULL UNIQUE,
  display_sha256 TEXT NOT NULL CHECK(length(display_sha256)=64),
  preview_object_key TEXT NOT NULL UNIQUE,
  preview_sha256 TEXT NOT NULL CHECK(length(preview_sha256)=64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,creator_id),
  UNIQUE(creator_id,storage_object_id,source_sha256)
);

CREATE TRIGGER creator_profile_library_derivative_source_insert
BEFORE INSERT ON creator_profile_library_photo_derivatives
WHEN NOT EXISTS (
  SELECT 1 FROM asset_storage_objects o
  JOIN asset_media_authorities ma ON ma.canonical_storage_object_id=o.id
    AND ma.asset_id=o.asset_id AND ma.creator_id=o.creator_id
  JOIN assets a ON a.id=o.asset_id AND a.creator_id=o.creator_id
  WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id
    AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
    AND o.ingest_status='verified' AND o.sha256=NEW.source_sha256
    AND o.r2_version=NEW.source_r2_version AND o.r2_etag=NEW.source_r2_etag
    AND o.object_key=a.media_r2_key AND a.source_available=1
    AND ma.authority_kind='r2_native' AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
)
BEGIN SELECT RAISE(ABORT,'profile_library_source_invalid'); END;

-- Classification and destination tags are filters, never permission grants.
-- Every surface gets its own explicit grant. Revocation is rechecked at release.
CREATE TABLE creator_profile_library_photo_grants (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY(creator_id,asset_id,surface)
);

CREATE TRIGGER creator_profile_library_grant_scope_insert
BEFORE INSERT ON creator_profile_library_photo_grants
WHEN NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.asset_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'profile_library_grant_scope_invalid'); END;
CREATE TRIGGER creator_profile_library_grant_scope_update
BEFORE UPDATE OF creator_id,asset_id,surface ON creator_profile_library_photo_grants
WHEN NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.asset_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'profile_library_grant_scope_invalid'); END;

CREATE TABLE creator_profile_library_subject_grants (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  evidence_note TEXT NOT NULL CHECK(length(evidence_note) BETWEEN 1 AND 1000),
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY(creator_id,asset_id,person_id,surface)
);

CREATE TRIGGER creator_profile_library_subject_scope_insert
BEFORE INSERT ON creator_profile_library_subject_grants
WHEN NOT EXISTS (SELECT 1 FROM asset_people ap WHERE ap.creator_id=NEW.creator_id
  AND ap.asset_id=NEW.asset_id AND ap.person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT,'profile_library_subject_scope_invalid'); END;
CREATE TRIGGER creator_profile_library_subject_scope_update
BEFORE UPDATE OF creator_id,asset_id,person_id,surface ON creator_profile_library_subject_grants
WHEN NOT EXISTS (SELECT 1 FROM asset_people ap WHERE ap.creator_id=NEW.creator_id
  AND ap.asset_id=NEW.asset_id AND ap.person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT,'profile_library_subject_scope_invalid'); END;

CREATE TABLE creator_profile_library_photo_selections (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  public_profile_version_id TEXT,
  adult_profile_version_id TEXT,
  derivative_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 5),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(derivative_id,creator_id) REFERENCES creator_profile_library_photo_derivatives(id,creator_id) ON DELETE RESTRICT,
  FOREIGN KEY(public_profile_version_id,creator_id) REFERENCES creator_public_profile_versions(id,creator_id) ON DELETE CASCADE,
  FOREIGN KEY(adult_profile_version_id,creator_id) REFERENCES creator_adult_profile_versions(id,creator_id) ON DELETE CASCADE,
  CHECK((surface='public_sfw' AND public_profile_version_id IS NOT NULL AND adult_profile_version_id IS NULL)
    OR (surface='adult_profile' AND adult_profile_version_id IS NOT NULL AND public_profile_version_id IS NULL))
);

CREATE UNIQUE INDEX creator_profile_library_public_position
  ON creator_profile_library_photo_selections(creator_id,public_profile_version_id,position)
  WHERE surface='public_sfw';
CREATE UNIQUE INDEX creator_profile_library_adult_position
  ON creator_profile_library_photo_selections(creator_id,adult_profile_version_id,position)
  WHERE surface='adult_profile';
CREATE UNIQUE INDEX creator_profile_library_public_asset
  ON creator_profile_library_photo_selections(creator_id,public_profile_version_id,derivative_id)
  WHERE surface='public_sfw';
CREATE UNIQUE INDEX creator_profile_library_adult_asset
  ON creator_profile_library_photo_selections(creator_id,adult_profile_version_id,derivative_id)
  WHERE surface='adult_profile';

CREATE TRIGGER creator_profile_library_selection_insert
BEFORE INSERT ON creator_profile_library_photo_selections
WHEN NOT EXISTS (
  SELECT 1 FROM creator_profile_library_photo_derivatives d
  JOIN assets a ON a.id=d.asset_id AND a.creator_id=d.creator_id AND a.source_available=1
  JOIN asset_storage_objects o ON o.id=d.storage_object_id AND o.asset_id=d.asset_id AND o.creator_id=d.creator_id
  JOIN asset_media_authorities ma ON ma.asset_id=d.asset_id AND ma.creator_id=d.creator_id
    AND ma.canonical_storage_object_id=o.id AND ma.authority_kind='r2_native'
  JOIN creator_profile_library_photo_grants g ON g.creator_id=d.creator_id AND g.asset_id=d.asset_id
    AND g.surface=NEW.surface AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>CURRENT_TIMESTAMP)
  WHERE d.id=NEW.derivative_id AND d.creator_id=NEW.creator_id
    AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
    AND o.ingest_status='verified' AND o.object_key=a.media_r2_key AND o.sha256=d.source_sha256
    AND o.r2_version=d.source_r2_version AND o.r2_etag=d.source_r2_etag
    AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
    AND NOT EXISTS (
      SELECT 1 FROM asset_people ap WHERE ap.asset_id=d.asset_id AND ap.creator_id=d.creator_id
        AND NOT EXISTS (
          SELECT 1 FROM creator_profile_library_subject_grants sg
          WHERE sg.creator_id=d.creator_id AND sg.asset_id=d.asset_id AND sg.person_id=ap.person_id
            AND sg.surface=NEW.surface AND sg.revoked_at IS NULL
            AND (sg.expires_at IS NULL OR sg.expires_at>CURRENT_TIMESTAMP)
        )
    )
    AND ((NEW.surface='public_sfw' AND EXISTS (
      SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.public_profile_version_id
        AND v.creator_id=NEW.creator_id AND v.status='draft'
    )) OR (NEW.surface='adult_profile' AND EXISTS (
      SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=NEW.adult_profile_version_id
        AND v.creator_id=NEW.creator_id AND v.status='draft'
    )))
)
BEGIN SELECT RAISE(ABORT,'profile_library_selection_invalid'); END;

CREATE TRIGGER creator_profile_library_selection_update
BEFORE UPDATE ON creator_profile_library_photo_selections
BEGIN SELECT RAISE(ABORT,'profile_library_selection_immutable'); END;

CREATE TRIGGER creator_profile_library_selection_delete
BEFORE DELETE ON creator_profile_library_photo_selections
WHEN (OLD.surface='public_sfw' AND NOT EXISTS (
  SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.public_profile_version_id
    AND v.creator_id=OLD.creator_id AND v.status='draft'
)) OR (OLD.surface='adult_profile' AND NOT EXISTS (
  SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=OLD.adult_profile_version_id
    AND v.creator_id=OLD.creator_id AND v.status='draft'
))
BEGIN SELECT RAISE(ABORT,'profile_library_selection_requires_draft'); END;
