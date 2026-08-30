PRAGMA foreign_keys = ON;

-- `0050` is already applied to staging. Keep its historical checksum stable and
-- add the immutable object identity plus recoverable finalization journal here.
ALTER TABLE asset_storage_objects ADD COLUMN r2_version TEXT;
ALTER TABLE asset_storage_objects ADD COLUMN r2_etag TEXT;

ALTER TABLE asset_ingest_sessions ADD COLUMN finalization_state TEXT NOT NULL DEFAULT 'incomplete'
  CHECK(finalization_state IN ('incomplete','completing','completed_unreconciled','verifying','verified','failed','quarantined','expired','aborted'));
ALTER TABLE asset_ingest_sessions ADD COLUMN completed_r2_version TEXT;
ALTER TABLE asset_ingest_sessions ADD COLUMN completed_r2_etag TEXT;
ALTER TABLE asset_ingest_sessions ADD COLUMN completion_observed_at TEXT;
ALTER TABLE asset_ingest_sessions ADD COLUMN reconcile_attempts INTEGER NOT NULL DEFAULT 0 CHECK(reconcile_attempts >= 0);

CREATE INDEX IF NOT EXISTS asset_ingest_sessions_finalization
  ON asset_ingest_sessions(finalization_state,updated_at);

-- Cutover is global to a creator, so every source consumer must be deployed and
-- remotely reconciled before the switch can move away from Dropbox. The current
-- scheduler implementations remain explicitly blocked; a later reviewed
-- release must record its Worker version and proof rather than infer readiness.
CREATE TABLE IF NOT EXISTS source_media_consumer_capabilities (
  service_name TEXT PRIMARY KEY CHECK(service_name IN ('web','vault','instagram','reddit')),
  capability TEXT NOT NULL DEFAULT 'r2-source-v2' CHECK(capability='r2-source-v2'),
  status TEXT NOT NULL CHECK(status IN ('pending','compatible','blocked','revoked')),
  worker_version TEXT,
  evidence_sha256 TEXT CHECK(evidence_sha256 IS NULL OR length(evidence_sha256)=64),
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO source_media_consumer_capabilities (service_name,status) VALUES ('web','pending');
INSERT OR IGNORE INTO source_media_consumer_capabilities (service_name,status) VALUES ('vault','blocked');
INSERT OR IGNORE INTO source_media_consumer_capabilities (service_name,status) VALUES ('instagram','blocked');
INSERT OR IGNORE INTO source_media_consumer_capabilities (service_name,status) VALUES ('reddit','blocked');

-- Future verified R2 rows must be bound to an immutable version and ETag.
-- Existing `0050` rows remain untouched and deliberately fail the new cutover
-- and delivery gates until a later authenticated reconciliation records both.
CREATE TRIGGER IF NOT EXISTS asset_storage_object_r2_identity_insert
BEFORE INSERT ON asset_storage_objects
WHEN NEW.provider='r2' AND NEW.ingest_status='verified'
  AND (NEW.r2_version IS NULL OR length(NEW.r2_version)=0 OR NEW.r2_etag IS NULL OR length(NEW.r2_etag)=0)
BEGIN SELECT RAISE(ABORT,'verified_r2_identity_required'); END;

CREATE TRIGGER IF NOT EXISTS asset_storage_object_r2_identity_update
BEFORE UPDATE OF provider,ingest_status,r2_version,r2_etag ON asset_storage_objects
WHEN NEW.provider='r2' AND NEW.ingest_status='verified'
  AND (NEW.r2_version IS NULL OR length(NEW.r2_version)=0 OR NEW.r2_etag IS NULL OR length(NEW.r2_etag)=0)
BEGIN SELECT RAISE(ABORT,'verified_r2_identity_required'); END;

-- The existing web-to-Vault principal remains creator scoped. Extend only its
-- already-active grants so web can prove the Vault source-media capability.
INSERT OR IGNORE INTO service_principal_creator_grants
  (service_principal_id,creator_id,capability,status,created_at)
SELECT service_principal_id,creator_id,'vault.source_media.health','active',CURRENT_TIMESTAMP
FROM service_principal_creator_grants
WHERE capability='vault.catalogue.refresh' AND status='active';
