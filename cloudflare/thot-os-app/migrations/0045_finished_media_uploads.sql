PRAGMA foreign_keys = ON;

-- The existing web-to-vault principal already owns each creator-specific
-- catalogue grant. Extend only those same creator scopes to finished-library
-- ingest and authenticated media reads; no new credential or cross-creator
-- grant is created here.
INSERT OR IGNORE INTO service_principal_creator_grants
  (service_principal_id,creator_id,capability,status,created_at)
SELECT service_principal_id,creator_id,'vault.library.manage','active',CURRENT_TIMESTAMP
FROM service_principal_creator_grants
WHERE capability='vault.catalogue.refresh' AND status='active';

INSERT OR IGNORE INTO service_principal_creator_grants
  (service_principal_id,creator_id,capability,status,created_at)
SELECT service_principal_id,creator_id,'vault.library.read','active',CURRENT_TIMESTAMP
FROM service_principal_creator_grants
WHERE capability='vault.catalogue.refresh' AND status='active';

