PRAGMA foreign_keys = ON;

-- Phase 2A.2 EXPAND: activation bookkeeping and telemetry are separate from
-- identity_audit_events. These records contain no bearer values or credential
-- hashes. The trigger below is a reviewed compatibility change (SQLite cannot
-- alter a trigger in place): it preserves the Phase 0019 legacy branch and
-- adds a separately scoped canonical branch. It is not a legacy contract.
CREATE TABLE IF NOT EXISTS service_auth_activation_runs (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment='staging'),
  plan_sha256 TEXT NOT NULL CHECK(length(plan_sha256)=64),
  registry_sha256 TEXT NOT NULL CHECK(length(registry_sha256)=64),
  backup_receipt_sha256 TEXT NOT NULL CHECK(length(backup_receipt_sha256)=64),
  target_database_id TEXT NOT NULL,
  target_migration_state_sha256 TEXT NOT NULL CHECK(length(target_migration_state_sha256)=64),
  git_sha TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  operator_identity TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(environment, plan_sha256)
);

CREATE TABLE IF NOT EXISTS service_auth_activation_steps (
  id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES service_auth_activation_runs(id) ON DELETE RESTRICT,
  step TEXT NOT NULL CHECK(step IN ('PLANNED','SECRET_STAGED','D1_ACTIVE','VERIFIED','ACTIVE','FAILED','ROLLBACK_REQUIRED','REVOKED')),
  principal_name TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS service_auth_activation_steps_run_created
  ON service_auth_activation_steps(activation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_auth_telemetry (
  id TEXT PRIMARY KEY,
  creator_id TEXT REFERENCES creators(id) ON DELETE RESTRICT,
  principal_name TEXT,
  auth_path TEXT NOT NULL CHECK(auth_path IN ('legacy','canonical')),
  capability TEXT,
  route TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('allowed','denied')),
  detail TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS service_auth_telemetry_path_observed
  ON service_auth_telemetry(auth_path, observed_at DESC);

CREATE INDEX IF NOT EXISTS service_auth_telemetry_creator_observed
  ON service_auth_telemetry(creator_id, observed_at DESC);

-- During the overlap a service audit actor is valid only through one of the
-- two explicitly scoped credential models. Neither branch grants global
-- creator authority; receiver code still verifies the route capability before
-- it writes an audit event. A later CONTRACT migration may remove the legacy
-- branch only after the documented zero-usage window.
DROP TRIGGER IF EXISTS identity_audit_service_scope;
CREATE TRIGGER identity_audit_service_scope
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role='service'
  AND NOT EXISTS (
    SELECT 1 FROM service_credentials s
    JOIN service_creator_grants g ON g.service_credential_id=s.id
    WHERE lower(NEW.actor_email)=lower('service:' || s.service_name)
      AND g.creator_id=NEW.creator_id
      AND s.status='active'
      AND g.status='active'
      AND (s.expires_at IS NULL OR unixepoch(s.expires_at)>unixepoch(CURRENT_TIMESTAMP))
  )
  AND NOT EXISTS (
    SELECT 1 FROM service_principal_credentials c
    JOIN service_principals p ON p.id=c.service_principal_id
    JOIN service_principal_creator_grants g ON g.service_principal_id=p.id
    WHERE lower(NEW.actor_email)=lower('service:' || p.principal_name)
      AND g.creator_id=NEW.creator_id
      AND c.status='active'
      AND p.status='active'
      AND g.status='active'
      AND (c.expires_at IS NULL OR unixepoch(c.expires_at)>unixepoch(CURRENT_TIMESTAMP))
  )
BEGIN
  SELECT RAISE(ABORT, 'audit_service_actor_scope_invalid');
END;

CREATE TRIGGER service_auth_activation_runs_append_only_update
BEFORE UPDATE ON service_auth_activation_runs
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_runs_append_only');
END;

CREATE TRIGGER service_auth_activation_runs_append_only_delete
BEFORE DELETE ON service_auth_activation_runs
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_runs_append_only');
END;

CREATE TRIGGER service_auth_activation_steps_append_only_update
BEFORE UPDATE ON service_auth_activation_steps
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_steps_append_only');
END;

CREATE TRIGGER service_auth_activation_steps_append_only_delete
BEFORE DELETE ON service_auth_activation_steps
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_steps_append_only');
END;

CREATE TRIGGER service_auth_telemetry_append_only_update
BEFORE UPDATE ON service_auth_telemetry
BEGIN
  SELECT RAISE(ABORT,'service_auth_telemetry_append_only');
END;

CREATE TRIGGER service_auth_telemetry_append_only_delete
BEFORE DELETE ON service_auth_telemetry
BEGIN
  SELECT RAISE(ABORT,'service_auth_telemetry_append_only');
END;
