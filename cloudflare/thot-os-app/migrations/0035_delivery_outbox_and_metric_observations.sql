PRAGMA foreign_keys = ON;

-- D1 is the durable intent ledger.  Queue sends occur after this record is
-- committed and may be repeated; consumers must be idempotent by key.
CREATE TABLE IF NOT EXISTS operation_outbox (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('preview_dispatch','public_profile_publish','social_publish','message_send')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatching','delivered','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS operation_outbox_dispatch
  ON operation_outbox(operation_type, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS operation_outbox_creator_created
  ON operation_outbox(creator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS external_operation_receipts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL REFERENCES operation_outbox(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_operation_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','uncertain','confirmed','failed','cancelled')),
  verification_detail TEXT NOT NULL DEFAULT '{}',
  first_attempt_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(operation_id, provider)
);

CREATE INDEX IF NOT EXISTS external_operation_receipts_reconcile
  ON external_operation_receipts(provider, status, updated_at);

-- Keep the legacy latest-value table for compatibility while collecting the
-- append-only observations required for velocity and recommendation analysis.
CREATE TABLE IF NOT EXISTS instagram_media_metric_observations (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  permalink TEXT,
  media_type TEXT,
  media_product_type TEXT,
  published_at TEXT,
  like_count INTEGER,
  comments_count INTEGER,
  view_count INTEGER,
  saved_count INTEGER,
  shares_count INTEGER,
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'instagram_api' CHECK(source IN ('instagram_api','creator_import')),
  UNIQUE(creator_id, media_id, collected_at)
);

CREATE INDEX IF NOT EXISTS instagram_media_metric_observations_time
  ON instagram_media_metric_observations(creator_id, media_id, collected_at DESC);

CREATE TABLE IF NOT EXISTS public_link_conversion_receipts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  public_link_id TEXT NOT NULL,
  source TEXT NOT NULL,
  external_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('verified','rejected')),
  observed_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_reference)
);

CREATE TRIGGER IF NOT EXISTS external_operation_receipt_creator_insert
BEFORE INSERT ON external_operation_receipts
WHEN NOT EXISTS (SELECT 1 FROM operation_outbox o WHERE o.id=NEW.operation_id AND o.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'external_operation_receipt_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS external_operation_receipt_creator_update
BEFORE UPDATE OF operation_id, creator_id ON external_operation_receipts
WHEN NOT EXISTS (SELECT 1 FROM operation_outbox o WHERE o.id=NEW.operation_id AND o.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'external_operation_receipt_creator_mismatch');
END;
