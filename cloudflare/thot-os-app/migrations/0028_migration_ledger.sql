PRAGMA foreign_keys = ON;

-- Phase 1C.5: immutable provenance for a future, separately approved migration executor.
-- This migration creates no executor and authorizes no application, user, or Worker write.

CREATE TABLE migration_ledger_runs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK(environment='staging'),
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

CREATE INDEX migration_ledger_runs_creator_created
  ON migration_ledger_runs(creator_id, created_at DESC);

CREATE TABLE migration_ledger_records (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES migration_ledger_runs(id) ON DELETE RESTRICT,
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

CREATE INDEX migration_ledger_records_creator_domain_created
  ON migration_ledger_records(creator_id, domain, created_at DESC);

CREATE TABLE migration_ledger_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES migration_ledger_runs(id) ON DELETE RESTRICT,
  record_id TEXT REFERENCES migration_ledger_records(id) ON DELETE RESTRICT,
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
