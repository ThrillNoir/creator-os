PRAGMA foreign_keys = ON;

-- These are private, manually entered CRM records. Public booking delivery
-- receipts and aggregate platform earnings never create or identify a client.
CREATE TABLE creator_clients (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
  contact_channel TEXT NOT NULL CHECK(contact_channel IN ('none','email','telegram','other')),
  contact_value TEXT NOT NULL DEFAULT '' CHECK(length(contact_value) <= 200),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,creator_id)
);
CREATE INDEX creator_clients_name ON creator_clients(creator_id,display_name);

CREATE TABLE creator_client_bookings (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  booked_on TEXT NOT NULL CHECK(booked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('requested','confirmed','completed','cancelled')),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 200),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id,creator_id) REFERENCES creator_clients(id,creator_id) ON DELETE RESTRICT,
  UNIQUE(id,creator_id,client_id)
);
CREATE INDEX creator_client_bookings_date ON creator_client_bookings(creator_id,booked_on DESC);

-- Positive manual payment evidence is the only source of the per-client total.
-- No booking price or aggregate platform revenue is counted as client spend.
CREATE TABLE creator_client_payments (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  booking_id TEXT,
  received_on TEXT NOT NULL CHECK(received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]'),
  source TEXT NOT NULL DEFAULT 'manual_report' CHECK(source='manual_report'),
  reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 160),
  reported_by TEXT NOT NULL,
  voided_at TEXT,
  voided_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id,creator_id) REFERENCES creator_clients(id,creator_id) ON DELETE RESTRICT,
  FOREIGN KEY(booking_id,creator_id,client_id) REFERENCES creator_client_bookings(id,creator_id,client_id) ON DELETE RESTRICT
);
CREATE INDEX creator_client_payments_date ON creator_client_payments(creator_id,received_on DESC);
CREATE INDEX creator_client_payments_client ON creator_client_payments(creator_id,client_id,currency);

CREATE TABLE creator_client_audit_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator')),
  event_type TEXT NOT NULL CHECK(event_type IN ('client_created','booking_created','booking_status_changed','payment_reported','payment_voided')),
  subject_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX creator_client_audit_time ON creator_client_audit_events(creator_id,created_at DESC);
