PRAGMA foreign_keys = ON;

-- A provider service may have more than one operational account per creator.
-- Rebuild the legacy table so the account is part of its durable identity.
ALTER TABLE provider_connections RENAME TO provider_connections_legacy;

CREATE TABLE provider_connections (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  connected_account_id TEXT NOT NULL,
  composio_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','expired','pending','failed')),
  external_account_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  identity_confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(creator_id, service, account_id),
  FOREIGN KEY(account_id, creator_id) REFERENCES operational_accounts(id, creator_id) ON DELETE CASCADE
);

INSERT INTO provider_connections
  (creator_id, service, account_id, connected_account_id, composio_user_id, status,
   external_account_id, display_name, last_error, identity_confirmed_at, updated_at)
SELECT legacy.creator_id,
       legacy.service,
       COALESCE(
         (SELECT MAX(account.id)
          FROM operational_accounts account
          WHERE account.creator_id=legacy.creator_id
            AND account.platform=legacy.service
            AND lower(trim(account.handle))=lower(trim(legacy.display_name))
          HAVING COUNT(*)=1),
         (SELECT MAX(account.id)
          FROM operational_accounts account
          WHERE account.creator_id=legacy.creator_id
            AND account.platform=legacy.service
          HAVING COUNT(*)=1)
       ),
       legacy.connected_account_id, legacy.composio_user_id, legacy.status,
       legacy.external_account_id, legacy.display_name, legacy.last_error,
       legacy.identity_confirmed_at, legacy.updated_at
FROM provider_connections_legacy legacy;

DROP TABLE provider_connections_legacy;

CREATE INDEX provider_connections_account_lookup
  ON provider_connections(creator_id, service, account_id, status);

-- Attempts historically had no account target. Preserve them where the
-- connected provider identity or a unique creator account makes it safe.
ALTER TABLE provider_connection_attempts RENAME TO provider_connection_attempts_legacy;

CREATE TABLE provider_connection_attempts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  account_id TEXT REFERENCES operational_accounts(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  connected_account_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','expired')),
  expires_at TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id, creator_id) REFERENCES operational_accounts(id, creator_id) ON DELETE CASCADE
);

INSERT INTO provider_connection_attempts
  (id, creator_id, service, account_id, state_hash, connected_account_id, status,
   expires_at, error, created_at, updated_at)
SELECT legacy.id, legacy.creator_id, legacy.service,
       COALESCE(
         (SELECT MAX(connection.account_id)
          FROM provider_connections connection
          WHERE connection.creator_id=legacy.creator_id
            AND connection.service=legacy.service
            AND legacy.connected_account_id IS NOT NULL
            AND connection.connected_account_id=legacy.connected_account_id
          HAVING COUNT(*)=1),
         (SELECT MAX(account.id)
          FROM operational_accounts account
          WHERE account.creator_id=legacy.creator_id
            AND account.platform=legacy.service
          HAVING COUNT(*)=1)
       ),
       legacy.state_hash, legacy.connected_account_id, legacy.status,
       legacy.expires_at, legacy.error, legacy.created_at, legacy.updated_at
FROM provider_connection_attempts_legacy legacy;

DROP TABLE provider_connection_attempts_legacy;

CREATE INDEX provider_connection_attempts_pending
  ON provider_connection_attempts(creator_id, service, account_id, status, expires_at);

CREATE TRIGGER provider_connections_account_scope_insert
BEFORE INSERT ON provider_connections
WHEN NOT EXISTS (
  SELECT 1 FROM operational_accounts account
  WHERE account.id=NEW.account_id
    AND account.creator_id=NEW.creator_id
    AND account.platform=NEW.service
)
BEGIN
  SELECT RAISE(ABORT, 'provider_connection_account_scope_invalid');
END;

CREATE TRIGGER provider_connections_account_scope_update
BEFORE UPDATE OF creator_id, service, account_id ON provider_connections
WHEN NOT EXISTS (
  SELECT 1 FROM operational_accounts account
  WHERE account.id=NEW.account_id
    AND account.creator_id=NEW.creator_id
    AND account.platform=NEW.service
)
BEGIN
  SELECT RAISE(ABORT, 'provider_connection_account_scope_invalid');
END;

CREATE TRIGGER provider_connection_attempts_account_scope_insert
BEFORE INSERT ON provider_connection_attempts
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM operational_accounts account
  WHERE account.id=NEW.account_id
    AND account.creator_id=NEW.creator_id
    AND account.platform=NEW.service
)
BEGIN
  SELECT RAISE(ABORT, 'provider_connection_attempt_account_scope_invalid');
END;

CREATE TRIGGER provider_connection_attempts_account_scope_update
BEFORE UPDATE OF creator_id, service, account_id ON provider_connection_attempts
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM operational_accounts account
  WHERE account.id=NEW.account_id
    AND account.creator_id=NEW.creator_id
    AND account.platform=NEW.service
)
BEGIN
  SELECT RAISE(ABORT, 'provider_connection_attempt_account_scope_invalid');
END;
