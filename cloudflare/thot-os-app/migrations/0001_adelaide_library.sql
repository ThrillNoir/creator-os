PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  initials TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '#6f4df6',
  status TEXT NOT NULL DEFAULT 'active',
  dropbox_root TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  basename TEXT NOT NULL,
  extension TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  filename_class TEXT NOT NULL,
  repeated_basename INTEGER NOT NULL DEFAULT 0 CHECK(repeated_basename IN (0,1)),
  source_available INTEGER NOT NULL DEFAULT 1 CHECK(source_available IN (0,1)),
  creator_notes TEXT NOT NULL DEFAULT '',
  safety_level TEXT NOT NULL DEFAULT 'unreviewed',
  workflow_status TEXT NOT NULL DEFAULT 'available',
  indexed_at TEXT NOT NULL,
  dropbox_revision TEXT,
  preview_r2_key TEXT,
  media_r2_key TEXT,
  UNIQUE(creator_id, relative_path)
);

CREATE INDEX IF NOT EXISTS assets_creator_available_modified
  ON assets(creator_id, source_available, modified_at DESC);

CREATE TABLE IF NOT EXISTS asset_classifications (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  safety TEXT CHECK(safety IN ('sfw','nsfw')),
  is_teaser INTEGER NOT NULL DEFAULT 0 CHECK(is_teaser IN (0,1)),
  is_multi INTEGER NOT NULL DEFAULT 0 CHECK(is_multi IN (0,1)),
  teaser_for_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS asset_classifications_creator_safety
  ON asset_classifications(creator_id, safety, is_teaser, is_multi);

CREATE TABLE IF NOT EXISTS asset_destinations (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  destination TEXT NOT NULL CHECK(destination IN ('instagram','facebook','tiktok','threads','x','reddit','subscription','ppv')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(asset_id, destination)
);

CREATE INDEX IF NOT EXISTS asset_destinations_creator_destination
  ON asset_destinations(creator_id, destination, asset_id);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  stage_name TEXT,
  consent_status TEXT NOT NULL DEFAULT 'not_recorded',
  tagging_preference TEXT NOT NULL DEFAULT 'ask_each_time',
  private_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asset_people (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'creator_friend',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(asset_id, person_id)
);

CREATE INDEX IF NOT EXISTS asset_people_creator_asset
  ON asset_people(creator_id, asset_id);

CREATE TABLE IF NOT EXISTS asset_paid_consent_attestations (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  evidence_platform TEXT NOT NULL CHECK(evidence_platform IN ('onlyfans','fansly')),
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  PRIMARY KEY(asset_id, person_id)
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detail TEXT NOT NULL DEFAULT '{}'
);
