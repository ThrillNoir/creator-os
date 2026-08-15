PRAGMA foreign_keys = ON;

CREATE TABLE finance_imports (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly','stripe')),
  source_name TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  row_count INTEGER NOT NULL CHECK(row_count > 0 AND row_count <= 400),
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, platform, content_hash)
);

CREATE INDEX finance_imports_creator_time
  ON finance_imports(creator_id, imported_at DESC);

CREATE TABLE finance_daily_metrics (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly','stripe')),
  period_date TEXT NOT NULL CHECK(period_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  gross_revenue_minor INTEGER,
  refunds_minor INTEGER,
  net_revenue_minor INTEGER NOT NULL,
  subscribers INTEGER,
  import_id TEXT NOT NULL REFERENCES finance_imports(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id, platform, period_date, currency)
);

CREATE INDEX finance_daily_metrics_creator_period
  ON finance_daily_metrics(creator_id, period_date DESC, platform, currency);

CREATE TABLE creator_finance_settings (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  agency_split_bps INTEGER NOT NULL DEFAULT 0 CHECK(agency_split_bps BETWEEN 0 AND 10000),
  revenue_basis TEXT NOT NULL DEFAULT 'imported_net_earnings' CHECK(revenue_basis = 'imported_net_earnings'),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE finance_audit_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator')),
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX finance_audit_creator_time
  ON finance_audit_events(creator_id, created_at DESC);
