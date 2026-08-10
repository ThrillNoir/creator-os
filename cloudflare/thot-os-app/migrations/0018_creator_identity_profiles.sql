PRAGMA foreign_keys = ON;

-- Access proves an email identity. These tables, not the Access policy, grant creator access.
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_memberships (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('agency_admin','operator','creator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id, user_email)
);

CREATE INDEX IF NOT EXISTS creator_memberships_user
  ON creator_memberships(user_email, status, creator_id);

CREATE TABLE IF NOT EXISTS browser_profiles (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  installation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','paired','revoked')),
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, label),
  UNIQUE(id, creator_id)
);

CREATE TABLE IF NOT EXISTS account_browser_profiles (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  PRIMARY KEY (creator_id, account_id),
  UNIQUE (profile_id, platform),
  FOREIGN KEY (profile_id, creator_id) REFERENCES browser_profiles(id, creator_id) ON DELETE RESTRICT
);

-- Browser credentials are scoped to a creator, account and named M1 Chrome profile.
-- Only hashes are stored; revocation is immediate and independent per creator/profile.
CREATE TABLE IF NOT EXISTS bridge_credentials (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  issued_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id, creator_id) REFERENCES browser_profiles(id, creator_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS bridge_credentials_scope
  ON bridge_credentials(creator_id, account_id, profile_id, platform, status, expires_at);

-- Automated Workers authenticate as services. A service principal never inherits a human email session.
CREATE TABLE IF NOT EXISTS service_credentials (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS identity_audit_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT REFERENCES creators(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL COLLATE NOCASE,
  event_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS identity_audit_creator_created
  ON identity_audit_events(creator_id, created_at DESC);

-- Telegram getUpdates is one ordered stream for the shared bot credential.
CREATE TABLE IF NOT EXISTS telegram_bot_state (
  id TEXT PRIMARY KEY,
  next_update_id INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  last_polled_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO telegram_bot_state (id) VALUES ('shared');

-- A human identity is either a creator locked to one workspace, or agency staff.
-- Enforce this in D1 as well as the server action so concurrent writes cannot create a mixed class.
CREATE TRIGGER IF NOT EXISTS creator_memberships_identity_class_insert
BEFORE INSERT ON creator_memberships WHEN NEW.status='active'
BEGIN
  SELECT CASE
    WHEN NEW.role='creator' AND EXISTS (
      SELECT 1 FROM creator_memberships WHERE lower(user_email)=lower(NEW.user_email) AND status='active' AND creator_id<>NEW.creator_id
    ) THEN RAISE(ABORT, 'creator_identity_must_be_single_workspace')
    WHEN NEW.role<>'creator' AND EXISTS (
      SELECT 1 FROM creator_memberships WHERE lower(user_email)=lower(NEW.user_email) AND status='active' AND role='creator' AND creator_id<>NEW.creator_id
    ) THEN RAISE(ABORT, 'creator_identity_cannot_be_staff')
  END;
END;

CREATE TRIGGER IF NOT EXISTS creator_memberships_identity_class_update
BEFORE UPDATE OF role,status ON creator_memberships WHEN NEW.status='active'
BEGIN
  SELECT CASE
    WHEN NEW.role='creator' AND EXISTS (
      SELECT 1 FROM creator_memberships WHERE lower(user_email)=lower(NEW.user_email) AND status='active' AND creator_id<>NEW.creator_id
    ) THEN RAISE(ABORT, 'creator_identity_must_be_single_workspace')
    WHEN NEW.role<>'creator' AND EXISTS (
      SELECT 1 FROM creator_memberships WHERE lower(user_email)=lower(NEW.user_email) AND status='active' AND role='creator' AND creator_id<>NEW.creator_id
    ) THEN RAISE(ABORT, 'creator_identity_cannot_be_staff')
  END;
END;

-- Preserve the current Adelaide operator and all existing data/functionality.
INSERT OR IGNORE INTO users (email, display_name)
VALUES ('connect@thrillnoir.com', 'THRILL NOIR');

INSERT OR IGNORE INTO creator_memberships (creator_id, user_email, role)
SELECT id, 'connect@thrillnoir.com', 'agency_admin' FROM creators WHERE id='adelaide';
