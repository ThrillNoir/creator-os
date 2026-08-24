PRAGMA foreign_keys = ON;

-- Canonical control-plane state. This is deliberately metadata-only: it does
-- not import legacy SQLite content, credentials, provider tokens, or jobs.
CREATE TABLE IF NOT EXISTS creator_onboarding_receipts (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL UNIQUE REFERENCES creators(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE RESTRICT,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS creator_onboarding_receipts_creator_created
  ON creator_onboarding_receipts(creator_id, created_at DESC);

-- Exceptions are control-plane metadata, not a licence to change canonical
-- records. Source evidence remains in the protected reconciliation reports.
CREATE TABLE IF NOT EXISTS creator_exceptions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical','high','medium','low')),
  status TEXT NOT NULL CHECK(status IN ('open','resolved','accepted')),
  summary TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  remediation TEXT NOT NULL,
  source TEXT NOT NULL,
  first_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  UNIQUE(creator_id, source, code)
);

CREATE INDEX IF NOT EXISTS creator_exceptions_open_scope
  ON creator_exceptions(creator_id, status, severity, last_observed_at DESC);

-- Materialised only from the reviewed Phase 1C.6 reconciliation report. These
-- are deliberately quarantined and do not alter target-authoritative records.
INSERT OR IGNORE INTO creator_exceptions
  (id,creator_id,domain,code,severity,status,summary,evidence_ref,remediation,source)
VALUES
  ('reconciliation-adelaide-classification-conflict','adelaide','classification','TARGET_AUTHORITATIVE_CONFLICT','high','open','Historical classification differs from canonical metadata.','docs/migration-reports/2026-08-15T132002Z-automated-reconciliation.json','Keep canonical data unchanged; require reviewed evidence before any future action.','phase1c6-reconciliation'),
  ('reconciliation-adelaide-reddit-identity','adelaide','account','IDENTITY_CONFLICT','high','open','Reddit account identity is ambiguous across legacy and canonical records.','docs/migration-reports/2026-08-15T132002Z-automated-reconciliation.json','Reconnect or obtain immutable provider identity; do not merge accounts by name or handle.','phase1c6-reconciliation'),
  ('reconciliation-adelaide-instagram-continuity','adelaide','account','IDENTITY_CONTINUITY_UNVERIFIED','medium','open','Instagram continuity is not proven by immutable provider evidence.','docs/migration-reports/2026-08-15T132002Z-automated-reconciliation.json','Verify provider identity before linking any historical state.','phase1c6-reconciliation');

-- Bryshanagy was created in staging by a reviewed predecessor operation, not by
-- the immutable schema history. Preserve fresh local migration replay while
-- materialising its reviewed exceptions whenever that workspace exists.
INSERT OR IGNORE INTO creator_exceptions
  (id,creator_id,domain,code,severity,status,summary,evidence_ref,remediation,source)
SELECT 'reconciliation-bryshanagy-fansly','bryshanagy','account','IDENTITY_MISMATCH','high','open','Fansly account mapping is not independently verified.','docs/migration-reports/2026-08-15T132002Z-automated-reconciliation.json','Require a verified provider identity; credentials remain excluded.','phase1c6-reconciliation'
WHERE EXISTS (SELECT 1 FROM creators WHERE id='bryshanagy');

INSERT OR IGNORE INTO creator_exceptions
  (id,creator_id,domain,code,severity,status,summary,evidence_ref,remediation,source)
SELECT 'reconciliation-bryshanagy-asset','bryshanagy','asset','SOURCE_MISSING_POSSIBLE_DUPLICATE','medium','open','A legacy asset is missing at its source and may duplicate protected canonical media.','docs/migration-reports/2026-08-15T132002Z-automated-reconciliation.json','Do not import; establish source-object identity before any reviewed action.','phase1c6-reconciliation'
WHERE EXISTS (SELECT 1 FROM creators WHERE id='bryshanagy');
