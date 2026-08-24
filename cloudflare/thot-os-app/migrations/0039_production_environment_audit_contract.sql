PRAGMA foreign_keys = ON;

-- The original staging-only audit tables were created before a production
-- environment existed. Preserve every immutable staging record while allowing
-- a later, explicitly recorded production release. Historical migrations stay
-- unchanged because their checksums are already part of the staging history.

CREATE TABLE migration_ledger_runs_next (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK(environment IN ('staging','production')),
  source_snapshot_label TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64),
  target_database_id TEXT NOT NULL,
  target_snapshot_sha256 TEXT NOT NULL CHECK(length(target_snapshot_sha256)=64),
  target_migration_state_sha256 TEXT NOT NULL CHECK(length(target_migration_state_sha256)=64),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  tool_git_sha TEXT NOT NULL,
  approval_ref TEXT NOT NULL,
  operator_identity TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, source_snapshot_sha256, manifest_sha256)
);

CREATE TABLE migration_ledger_records_next (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES migration_ledger_runs_next(id) ON DELETE RESTRICT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_record_ref TEXT NOT NULL,
  source_record_checksum TEXT NOT NULL CHECK(length(source_record_checksum)=64),
  target_table TEXT,
  target_record_id TEXT,
  target_before_checksum TEXT CHECK(target_before_checksum IS NULL OR length(target_before_checksum)=64),
  target_after_checksum TEXT CHECK(target_after_checksum IS NULL OR length(target_after_checksum)=64),
  operation TEXT NOT NULL CHECK(operation IN ('INSERT','SKIP','ARCHIVE','MANUAL_REVIEW','VERIFY')),
  result TEXT NOT NULL CHECK(result IN ('PLANNED','APPLIED','SKIPPED','ARCHIVED','VERIFIED','FAILED','REJECTED')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, domain, source_table, source_record_ref)
);

CREATE TABLE migration_ledger_events_next (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES migration_ledger_runs_next(id) ON DELETE RESTRICT,
  record_id TEXT REFERENCES migration_ledger_records_next(id) ON DELETE RESTRICT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'RUN_CREATED',
    'RECORD_PLANNED',
    'RECORD_APPLIED',
    'RECORD_SKIPPED',
    'RECORD_REJECTED',
    'VERIFICATION_PASSED',
    'VERIFICATION_FAILED',
    'KILL_SWITCH_BLOCKED'
  )),
  actor_identity TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO migration_ledger_runs_next (
  id, creator_id, environment, source_snapshot_label, source_snapshot_sha256,
  target_database_id, target_snapshot_sha256, target_migration_state_sha256,
  manifest_sha256, tool_git_sha, approval_ref, operator_identity, created_at
)
SELECT
  id, creator_id, environment, source_snapshot_label, source_snapshot_sha256,
  target_database_id, target_snapshot_sha256, target_migration_state_sha256,
  manifest_sha256, tool_git_sha, approval_ref, operator_identity, created_at
FROM migration_ledger_runs;

INSERT INTO migration_ledger_records_next (
  id, run_id, creator_id, domain, source_table, source_record_ref,
  source_record_checksum, target_table, target_record_id,
  target_before_checksum, target_after_checksum, operation, result, detail,
  created_at
)
SELECT
  id, run_id, creator_id, domain, source_table, source_record_ref,
  source_record_checksum, target_table, target_record_id,
  target_before_checksum, target_after_checksum, operation, result, detail,
  created_at
FROM migration_ledger_records;

INSERT INTO migration_ledger_events_next (
  id, run_id, record_id, creator_id, event_type, actor_identity, detail,
  created_at
)
SELECT
  id, run_id, record_id, creator_id, event_type, actor_identity, detail,
  created_at
FROM migration_ledger_events;

DROP TRIGGER migration_ledger_records_creator_scope;
DROP TRIGGER migration_ledger_events_creator_scope;
DROP TRIGGER migration_ledger_events_record_scope;
DROP TRIGGER migration_ledger_runs_immutable_update;
DROP TRIGGER migration_ledger_runs_immutable_delete;
DROP TRIGGER migration_ledger_records_immutable_update;
DROP TRIGGER migration_ledger_records_immutable_delete;
DROP TRIGGER migration_ledger_events_immutable_update;
DROP TRIGGER migration_ledger_events_immutable_delete;

DROP TABLE migration_ledger_events;
DROP TABLE migration_ledger_records;
DROP TABLE migration_ledger_runs;

ALTER TABLE migration_ledger_runs_next RENAME TO migration_ledger_runs;
ALTER TABLE migration_ledger_records_next RENAME TO migration_ledger_records;
ALTER TABLE migration_ledger_events_next RENAME TO migration_ledger_events;

CREATE INDEX migration_ledger_runs_creator_created
  ON migration_ledger_runs(creator_id, created_at DESC);
CREATE INDEX migration_ledger_records_creator_domain_created
  ON migration_ledger_records(creator_id, domain, created_at DESC);
CREATE INDEX migration_ledger_events_run_created
  ON migration_ledger_events(run_id, created_at DESC);

CREATE TRIGGER migration_ledger_records_creator_scope
BEFORE INSERT ON migration_ledger_records
WHEN NOT EXISTS (
  SELECT 1 FROM migration_ledger_runs run
  WHERE run.id=NEW.run_id AND run.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_creator_scope');
END;

CREATE TRIGGER migration_ledger_events_creator_scope
BEFORE INSERT ON migration_ledger_events
WHEN NOT EXISTS (
  SELECT 1 FROM migration_ledger_runs run
  WHERE run.id=NEW.run_id AND run.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_creator_scope');
END;

CREATE TRIGGER migration_ledger_events_record_scope
BEFORE INSERT ON migration_ledger_events
WHEN NEW.record_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM migration_ledger_records record
  WHERE record.id=NEW.record_id AND record.run_id=NEW.run_id AND record.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_record_scope');
END;

CREATE TRIGGER migration_ledger_runs_immutable_update
BEFORE UPDATE ON migration_ledger_runs
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_runs_immutable_delete
BEFORE DELETE ON migration_ledger_runs
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_records_immutable_update
BEFORE UPDATE ON migration_ledger_records
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_records_immutable_delete
BEFORE DELETE ON migration_ledger_records
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_events_immutable_update
BEFORE UPDATE ON migration_ledger_events
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_events_immutable_delete
BEFORE DELETE ON migration_ledger_events
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TABLE service_auth_activation_runs_next (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment IN ('staging','production')),
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

CREATE TABLE service_auth_activation_steps_next (
  id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES service_auth_activation_runs_next(id) ON DELETE RESTRICT,
  step TEXT NOT NULL CHECK(step IN ('PLANNED','SECRET_STAGED','D1_ACTIVE','VERIFIED','ACTIVE','FAILED','ROLLBACK_REQUIRED','REVOKED')),
  principal_name TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO service_auth_activation_runs_next (
  id, environment, plan_sha256, registry_sha256, backup_receipt_sha256,
  target_database_id, target_migration_state_sha256, git_sha, git_branch,
  operator_identity, created_at
)
SELECT
  id, environment, plan_sha256, registry_sha256, backup_receipt_sha256,
  target_database_id, target_migration_state_sha256, git_sha, git_branch,
  operator_identity, created_at
FROM service_auth_activation_runs;

INSERT INTO service_auth_activation_steps_next (
  id, activation_id, step, principal_name, detail, created_at
)
SELECT
  id, activation_id, step, principal_name, detail, created_at
FROM service_auth_activation_steps;

DROP TRIGGER service_auth_activation_runs_append_only_update;
DROP TRIGGER service_auth_activation_runs_append_only_delete;
DROP TRIGGER service_auth_activation_steps_append_only_update;
DROP TRIGGER service_auth_activation_steps_append_only_delete;

DROP TABLE service_auth_activation_steps;
DROP TABLE service_auth_activation_runs;

ALTER TABLE service_auth_activation_runs_next RENAME TO service_auth_activation_runs;
ALTER TABLE service_auth_activation_steps_next RENAME TO service_auth_activation_steps;

CREATE INDEX service_auth_activation_steps_run_created
  ON service_auth_activation_steps(activation_id, created_at DESC);

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
