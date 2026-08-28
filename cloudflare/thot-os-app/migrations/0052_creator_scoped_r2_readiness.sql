PRAGMA foreign_keys = ON;

-- `0051` retained one global row per Worker.  A Worker version is global, but
-- source coverage and an R2 cutover are per creator, so do not repurpose or
-- discard those historical rows.  This table is the authoritative per-creator
-- readiness record used by the bounded cutover coordinator.
CREATE TABLE IF NOT EXISTS creator_source_media_consumer_readiness (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL CHECK(service_name IN ('web','vault','instagram','reddit')),
  capability TEXT NOT NULL DEFAULT 'r2-source-v2' CHECK(capability='r2-source-v2'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','compatible','blocked','revoked')),
  worker_version TEXT,
  deployment_evidence_sha256 TEXT CHECK(deployment_evidence_sha256 IS NULL OR length(deployment_evidence_sha256)=64),
  health_evidence_sha256 TEXT CHECK(health_evidence_sha256 IS NULL OR length(health_evidence_sha256)=64),
  asset_coverage_sha256 TEXT CHECK(asset_coverage_sha256 IS NULL OR length(asset_coverage_sha256)=64),
  reason_code TEXT NOT NULL DEFAULT 'not_verified' CHECK(length(reason_code) BETWEEN 1 AND 120),
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(creator_id,service_name),
  CHECK(status <> 'compatible' OR (worker_version IS NOT NULL AND deployment_evidence_sha256 IS NOT NULL AND health_evidence_sha256 IS NOT NULL AND asset_coverage_sha256 IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS creator_source_media_readiness_creator_status
  ON creator_source_media_consumer_readiness(creator_id,status,service_name);

INSERT OR IGNORE INTO creator_source_media_consumer_readiness (creator_id,service_name,status,reason_code)
SELECT c.id, services.service_name,
  CASE services.service_name WHEN 'web' THEN 'pending' ELSE 'blocked' END,
  CASE services.service_name WHEN 'web' THEN 'awaiting_creator_coverage' ELSE 'consumer_not_verified' END
FROM creators c
CROSS JOIN (SELECT 'web' AS service_name UNION ALL SELECT 'vault' UNION ALL SELECT 'instagram' UNION ALL SELECT 'reddit') services;

CREATE TABLE IF NOT EXISTS creator_media_source_cutover_receipts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  plan_sha256 TEXT NOT NULL UNIQUE CHECK(length(plan_sha256)=64),
  git_sha TEXT NOT NULL CHECK(length(git_sha)=40),
  asset_coverage_sha256 TEXT NOT NULL CHECK(length(asset_coverage_sha256)=64),
  readiness_evidence_sha256 TEXT NOT NULL CHECK(length(readiness_evidence_sha256)=64),
  applied_by TEXT NOT NULL,
  rollback_of_plan_sha256 TEXT CHECK(rollback_of_plan_sha256 IS NULL OR length(rollback_of_plan_sha256)=64),
  action TEXT NOT NULL CHECK(action IN ('r2_cutover','dropbox_rollback')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS creator_media_source_cutover_receipts_creator_created
  ON creator_media_source_cutover_receipts(creator_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS creator_source_media_readiness_creator_insert
AFTER INSERT ON creators
BEGIN
  INSERT OR IGNORE INTO creator_source_media_consumer_readiness (creator_id,service_name,status,reason_code)
  VALUES
    (NEW.id,'web','pending','awaiting_creator_coverage'),
    (NEW.id,'vault','blocked','consumer_not_verified'),
    (NEW.id,'instagram','blocked','consumer_not_verified'),
    (NEW.id,'reddit','blocked','consumer_not_verified');
END;
