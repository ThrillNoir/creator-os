PRAGMA foreign_keys = ON;

-- Creator identity details are deliberately separated from the general creators
-- table. General workspace lists continue to expose only the stage/workspace
-- identity, never legal identity or date of birth.
CREATE TABLE IF NOT EXISTS creator_onboarding_profiles (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL DEFAULT '',
  preferred_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  time_zone TEXT NOT NULL DEFAULT '',
  uses_chrome INTEGER NOT NULL DEFAULT 0 CHECK(uses_chrome IN (0,1)),
  adult_verification_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK(adult_verification_status IN ('not_started','submitted','verified','rejected')),
  contract_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK(contract_status IN ('not_started','pending','active','expired','terminated')),
  consent_status TEXT NOT NULL DEFAULT 'not_recorded'
    CHECK(consent_status IN ('not_recorded','pending','recorded','withdrawn')),
  restricted_admin_notes TEXT NOT NULL DEFAULT '',
  workflow_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(workflow_state IN ('draft','creator_review','admin_review','active')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_compliance_records (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL DEFAULT '',
  date_of_birth TEXT NOT NULL DEFAULT '',
  adult_verified_at TEXT,
  activated_by TEXT COLLATE NOCASE REFERENCES users(email),
  activated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_onboarding_sections (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL CHECK(section_key IN ('identity','social_profiles','paid_platforms','chrome_access','brand_voice','positioning','about_me')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','creator_review','admin_review','complete')),
  updated_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  PRIMARY KEY(creator_id,section_key)
);

CREATE TABLE IF NOT EXISTS creator_brand_positioning (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  current_positioning TEXT NOT NULL DEFAULT '', desired_positioning TEXT NOT NULL DEFAULT '',
  primary_audience TEXT NOT NULL DEFAULT '', niches_themes TEXT NOT NULL DEFAULT '', differentiators TEXT NOT NULL DEFAULT '',
  visual_style TEXT NOT NULL DEFAULT '', content_pillars TEXT NOT NULL DEFAULT '', paid_content_proposition TEXT NOT NULL DEFAULT '',
  growth_priorities TEXT NOT NULL DEFAULT '', hard_boundaries TEXT NOT NULL DEFAULT '', inspiration_references TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_about_profiles (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  short_bio TEXT NOT NULL DEFAULT '', long_bio TEXT NOT NULL DEFAULT '', interests TEXT NOT NULL DEFAULT '',
  approved_background_facts TEXT NOT NULL DEFAULT '', location_disclosure_preference TEXT NOT NULL DEFAULT 'private',
  relationship_disclosure_preference TEXT NOT NULL DEFAULT 'private', approved_identifying_features TEXT NOT NULL DEFAULT '',
  public_talking_points TEXT NOT NULL DEFAULT '', private_facts TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_brand_voice_profiles (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  voice_summary TEXT NOT NULL DEFAULT '', tone_personality TEXT NOT NULL DEFAULT '', common_vocabulary TEXT NOT NULL DEFAULT '',
  phrases_to_avoid TEXT NOT NULL DEFAULT '', emoji_style TEXT NOT NULL DEFAULT '', caption_length_preference TEXT NOT NULL DEFAULT '',
  humour_style TEXT NOT NULL DEFAULT '', flirting_intensity TEXT NOT NULL DEFAULT '', forbidden_topics_claims TEXT NOT NULL DEFAULT '',
  creator_examples TEXT NOT NULL DEFAULT '', platform_variations TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE operational_accounts ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'social' CHECK(account_kind IN ('social','paid','other'));
ALTER TABLE operational_accounts ADD COLUMN login_email TEXT NOT NULL DEFAULT '';
ALTER TABLE operational_accounts ADD COLUMN profile_url TEXT NOT NULL DEFAULT '';
ALTER TABLE operational_accounts ADD COLUMN account_purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE operational_accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1));
ALTER TABLE operational_accounts ADD COLUMN connection_method TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE operational_accounts ADD COLUMN creator_visible INTEGER NOT NULL DEFAULT 1 CHECK(creator_visible IN (0,1));
ALTER TABLE operational_accounts ADD COLUMN administrator_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE operational_accounts ADD COLUMN native_identity_verified_at TEXT;
ALTER TABLE operational_accounts ADD COLUMN pairing_state TEXT NOT NULL DEFAULT 'not_paired';
ALTER TABLE operational_accounts ADD COLUMN bridge_last_seen_at TEXT;
ALTER TABLE operational_accounts ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE operational_accounts ADD COLUMN private_upload_destination TEXT NOT NULL DEFAULT '';
ALTER TABLE browser_profiles ADD COLUMN chrome_login_email TEXT NOT NULL DEFAULT '';
ALTER TABLE browser_profiles ADD COLUMN device_label TEXT NOT NULL DEFAULT '';
ALTER TABLE browser_profiles ADD COLUMN expected_platforms_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE browser_profiles ADD COLUMN native_identity_verified_at TEXT;

CREATE TABLE IF NOT EXISTS vault_credentials (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL,
  credential_group TEXT NOT NULL CHECK(credential_group IN ('social','paid','chrome','other')),
  label TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '', login_email TEXT NOT NULL DEFAULT '',
  wrapped_dek BLOB NOT NULL, wrapped_dek_nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL, ciphertext_nonce BLOB NOT NULL,
  key_version INTEGER NOT NULL CHECK(key_version > 0),
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  shared_with_creator INTEGER NOT NULL DEFAULT 0 CHECK(shared_with_creator IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  last_native_password_confirmation_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE(id,creator_id)
);
CREATE INDEX IF NOT EXISTS vault_credentials_creator_group ON vault_credentials(creator_id,credential_group,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS vault_credentials_creator_account ON vault_credentials(creator_id,account_id,status);
CREATE TRIGGER IF NOT EXISTS vault_credentials_account_scope_insert BEFORE INSERT ON vault_credentials
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'vault_credential_creator_scope_invalid'); END;
CREATE TRIGGER IF NOT EXISTS vault_credentials_account_scope_update BEFORE UPDATE OF creator_id,account_id ON vault_credentials
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'vault_credential_creator_scope_invalid'); END;

CREATE TABLE IF NOT EXISTS vault_pin_verifiers (
  id TEXT PRIMARY KEY,
  identity_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
  creator_id TEXT REFERENCES creators(id) ON DELETE CASCADE,
  pin_scope TEXT NOT NULL CHECK(pin_scope IN ('creator','administrator')),
  salt BLOB NOT NULL, verifier BLOB NOT NULL, kdf_iterations INTEGER NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0, failure_cycles INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((pin_scope='creator' AND creator_id IS NOT NULL) OR (pin_scope='administrator' AND creator_id IS NULL)),
  UNIQUE(identity_email,creator_id,pin_scope)
);
CREATE UNIQUE INDEX IF NOT EXISTS vault_pin_creator_identity ON vault_pin_verifiers(identity_email,creator_id) WHERE pin_scope='creator';
CREATE UNIQUE INDEX IF NOT EXISTS vault_pin_admin_identity ON vault_pin_verifiers(identity_email) WHERE pin_scope='administrator';

CREATE TABLE IF NOT EXISTS vault_step_up_sessions (
  id TEXT PRIMARY KEY,
  identity_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator')),
  pin_scope TEXT NOT NULL CHECK(pin_scope IN ('creator','administrator')),
  expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS vault_step_up_scope ON vault_step_up_sessions(identity_email,creator_id,expires_at);
CREATE TRIGGER IF NOT EXISTS vault_step_up_membership_scope BEFORE INSERT ON vault_step_up_sessions
WHEN NOT EXISTS (SELECT 1 FROM creator_memberships WHERE creator_id=NEW.creator_id AND lower(user_email)=lower(NEW.identity_email) AND role=NEW.actor_role AND status='active')
BEGIN SELECT RAISE(ABORT,'vault_step_up_actor_scope_invalid'); END;

-- Append-only, safe event stream. The payload deliberately excludes secrets,
-- legal identity, DOB, ciphertext and PIN material.
CREATE TABLE IF NOT EXISTS creator_access_audit_events (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL COLLATE NOCASE, actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS creator_access_audit_scope ON creator_access_audit_events(creator_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS creator_access_audit_immutable_update BEFORE UPDATE ON creator_access_audit_events BEGIN SELECT RAISE(ABORT,'creator_access_audit_append_only'); END;
CREATE TRIGGER IF NOT EXISTS creator_access_audit_immutable_delete BEFORE DELETE ON creator_access_audit_events BEGIN SELECT RAISE(ABORT,'creator_access_audit_append_only'); END;
CREATE TRIGGER IF NOT EXISTS creator_access_audit_actor_scope BEFORE INSERT ON creator_access_audit_events
WHEN NOT EXISTS (SELECT 1 FROM creator_memberships WHERE creator_id=NEW.creator_id AND lower(user_email)=lower(NEW.actor_email) AND role=NEW.actor_role AND status='active')
BEGIN SELECT RAISE(ABORT,'creator_access_audit_actor_scope_invalid'); END;
