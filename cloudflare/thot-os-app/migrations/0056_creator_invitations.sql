PRAGMA foreign_keys = ON;

CREATE TABLE creator_invitations (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked','expired')),
  expires_at TEXT NOT NULL,
  sent_at TEXT,
  accepted_at TEXT,
  accepted_by TEXT COLLATE NOCASE REFERENCES users(email),
  revoked_at TEXT,
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX creator_invitations_pending_email
  ON creator_invitations(creator_id, invited_email) WHERE status='pending';
CREATE INDEX creator_invitations_creator_status
  ON creator_invitations(creator_id, status, created_at DESC);
