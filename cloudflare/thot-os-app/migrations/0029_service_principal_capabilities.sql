PRAGMA foreign_keys = ON;

-- Phase 2A: replace the one-credential-per-service compatibility model with
-- named principals, independently revocable credential rotations, and explicit
-- per-creator capabilities. The Phase 0018/0019 tables remain untouched for
-- historical compatibility and are not an authorization fallback.
CREATE TABLE IF NOT EXISTS service_principals (
  id TEXT PRIMARY KEY,
  principal_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS service_principal_credentials (
  id TEXT PRIMARY KEY,
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS service_principal_credentials_lookup
  ON service_principal_credentials(service_principal_id, status, expires_at);

CREATE TABLE IF NOT EXISTS service_principal_creator_grants (
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY (service_principal_id, creator_id, capability)
);

CREATE INDEX IF NOT EXISTS service_principal_creator_grants_scope
  ON service_principal_creator_grants(creator_id, capability, status, service_principal_id);

-- Lifecycle receipts are immutable. Provisioning and revocation tooling must
-- record an event rather than rewriting history.
CREATE TABLE IF NOT EXISTS service_principal_audit_events (
  id TEXT PRIMARY KEY,
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  credential_id TEXT REFERENCES service_principal_credentials(id) ON DELETE RESTRICT,
  creator_id TEXT REFERENCES creators(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS service_principal_audit_events_principal_created
  ON service_principal_audit_events(service_principal_id, created_at DESC);

CREATE TRIGGER service_principal_audit_events_append_only_update
BEFORE UPDATE ON service_principal_audit_events
BEGIN
  SELECT RAISE(ABORT,'service_principal_audit_events_append_only');
END;

CREATE TRIGGER service_principal_audit_events_append_only_delete
BEFORE DELETE ON service_principal_audit_events
BEGIN
  SELECT RAISE(ABORT,'service_principal_audit_events_append_only');
END;

-- The Phase 0019 trigger protected service provenance against the retired
-- one-credential-per-name model. Rebind it atomically to the capability model
-- so a verified request can continue to write its required identity receipt.
DROP TRIGGER IF EXISTS identity_audit_service_scope;
CREATE TRIGGER identity_audit_service_scope
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role='service' AND NOT EXISTS (
  SELECT 1 FROM service_principal_credentials c
  JOIN service_principals p ON p.id=c.service_principal_id
  JOIN service_principal_creator_grants g ON g.service_principal_id=p.id
  WHERE lower(NEW.actor_email)=lower('service:' || p.principal_name)
    AND g.creator_id=NEW.creator_id
    AND p.status='active'
    AND c.status='active'
    AND g.status='active'
    AND (c.expires_at IS NULL OR unixepoch(c.expires_at)>unixepoch(CURRENT_TIMESTAMP))
)
BEGIN
  SELECT RAISE(ABORT, 'audit_service_actor_scope_invalid');
END;
