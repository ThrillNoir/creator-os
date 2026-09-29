-- Enquiry payloads are never retained. Receipts expire after seven days.
CREATE TABLE creator_booking_receipts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id),
  profile_version_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending','accepted','uncertain')),
  FOREIGN KEY (profile_version_id,creator_id) REFERENCES creator_public_profile_versions(id,creator_id),
  CHECK (expires_at = acknowledged_at + 604800000)
);
CREATE INDEX creator_booking_receipts_scope_time ON creator_booking_receipts(creator_id,acknowledged_at);
CREATE INDEX creator_booking_receipts_expiry ON creator_booking_receipts(expires_at);
