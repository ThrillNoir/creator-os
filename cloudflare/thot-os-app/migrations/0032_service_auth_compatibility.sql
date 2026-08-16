PRAGMA foreign_keys = ON;

-- Phase 2A.3 COMPATIBILITY: SQLite has no ALTER TRIGGER, so this explicit
-- boundary replaces the legacy audit trigger only after the EXPAND release has
-- been independently verified. The legacy predicate remains byte-for-byte
-- equivalent in logic; the second branch accepts only a scoped canonical
-- principal. No principal, credential, grant, or secret is created here.
DROP TRIGGER IF EXISTS identity_audit_service_scope;
CREATE TRIGGER identity_audit_service_scope
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role='service'
  AND NOT EXISTS (
    SELECT 1 FROM service_credentials s
    JOIN service_creator_grants g ON g.service_credential_id=s.id
    WHERE lower(NEW.actor_email)=lower('service:' || s.service_name)
      AND g.creator_id=NEW.creator_id
      AND s.status='active'
      AND g.status='active'
      AND (s.expires_at IS NULL OR unixepoch(s.expires_at)>unixepoch(CURRENT_TIMESTAMP))
  )
  AND NOT EXISTS (
    SELECT 1 FROM service_principal_credentials c
    JOIN service_principals p ON p.id=c.service_principal_id
    JOIN service_principal_creator_grants g ON g.service_principal_id=p.id
    WHERE lower(NEW.actor_email)=lower('service:' || p.principal_name)
      AND g.creator_id=NEW.creator_id
      AND c.status='active'
      AND p.status='active'
      AND g.status='active'
      AND (c.expires_at IS NULL OR unixepoch(c.expires_at)>unixepoch(CURRENT_TIMESTAMP))
  )
BEGIN
  SELECT RAISE(ABORT, 'audit_service_actor_scope_invalid');
END;
