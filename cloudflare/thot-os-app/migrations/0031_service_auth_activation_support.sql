PRAGMA foreign_keys = ON;

-- Phase 2A.3 EXPAND: activation bookkeeping and telemetry are dormant schema.
-- This migration deliberately does not read, drop, recreate, or otherwise
-- change identity_audit_service_scope. Compatibility behaviour belongs solely
-- to the separately reviewed 0032 migration.
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
