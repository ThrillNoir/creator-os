PRAGMA foreign_keys = ON;

-- Service credentials authenticate machines; grants authorise a service for one creator.
CREATE TABLE service_creator_grants (
  service_credential_id TEXT NOT NULL REFERENCES service_credentials(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY (service_credential_id, creator_id)
);

CREATE INDEX service_creator_grants_creator
  ON service_creator_grants(creator_id, status, service_credential_id);

-- Expand step: existing operational audit rows and rollback writers predate role
-- snapshots. Backfill/default them to legacy so the currently deployed code can
-- continue writing throughout the migration-to-code interval. Phase 1D-G writers
-- always supply the server-derived role. A later contract migration may remove
-- these defaults only after every rollback version also supplies actor_role.
ALTER TABLE asset_classification_events ADD COLUMN actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy'));
ALTER TABLE social_post_events ADD COLUMN actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy'));
ALTER TABLE reddit_community_events ADD COLUMN actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy'));
ALTER TABLE vault_upload_events ADD COLUMN actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy'));
ALTER TABLE messaging_audit_events ADD COLUMN actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy'));

-- Rebuild the audit table so actor_role is required and rollback writers receive
-- the temporary legacy provenance default during the expand interval.
-- Historical actor roles were not recorded and cannot be reconstructed safely
-- from mutable current memberships or actor naming conventions. Every legacy row
-- is therefore backfilled as legacy, a provenance value that is never an
-- authorization role; event detail and the original actor identity remain
-- unchanged for historical interpretation.
CREATE TABLE identity_audit_events_v2 (
  id TEXT PRIMARY KEY,
  creator_id TEXT REFERENCES creators(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL COLLATE NOCASE,
  actor_role TEXT NOT NULL DEFAULT 'legacy'
    CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy')),
  event_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO identity_audit_events_v2
  (id,creator_id,actor_email,actor_role,event_type,subject,detail,created_at)
SELECT
  e.id,
  e.creator_id,
  e.actor_email,
  'legacy',
  e.event_type,
  e.subject,
  e.detail,
  e.created_at
FROM identity_audit_events e;

DROP TABLE identity_audit_events;
ALTER TABLE identity_audit_events_v2 RENAME TO identity_audit_events;

CREATE INDEX identity_audit_creator_created
  ON identity_audit_events(creator_id, created_at DESC);

-- New audit rows must always name an effective creator.
CREATE TRIGGER identity_audit_creator_required
BEFORE INSERT ON identity_audit_events
WHEN NEW.creator_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'audit_effective_creator_required');
END;

-- A browser session cannot assert a verified role that differs from its active
-- membership. Legacy is the expand-phase audit-provenance sentinel for rollback
-- writers and backfilled rows. It is intentionally absent from memberships and
-- the application authorization-role type.
CREATE TRIGGER identity_audit_human_scope
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role NOT IN ('service','legacy') AND NOT EXISTS (
  SELECT 1 FROM creator_memberships m
  JOIN users u ON lower(u.email)=lower(m.user_email)
  WHERE m.creator_id=NEW.creator_id
    AND lower(m.user_email)=lower(NEW.actor_email)
    AND m.role=NEW.actor_role
    AND m.status='active'
    AND u.status='active'
)
BEGIN
  SELECT RAISE(ABORT, 'audit_human_actor_scope_invalid');
END;

-- A machine can claim service only after credential validation and creator grant.
CREATE TRIGGER identity_audit_service_scope
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role='service' AND NOT EXISTS (
  SELECT 1 FROM service_credentials s
  JOIN service_creator_grants g ON g.service_credential_id=s.id
  WHERE lower(NEW.actor_email)=lower('service:' || s.service_name)
    AND g.creator_id=NEW.creator_id
    AND s.status='active'
    AND g.status='active'
    AND (s.expires_at IS NULL OR unixepoch(s.expires_at)>unixepoch(CURRENT_TIMESTAMP))
)
BEGIN
  SELECT RAISE(ABORT, 'audit_service_actor_scope_invalid');
END;
