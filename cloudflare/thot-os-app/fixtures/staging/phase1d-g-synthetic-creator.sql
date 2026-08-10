PRAGMA foreign_keys = ON;

-- STAGING ONLY. Apply explicitly to thot-os-staging after migration 0019 review.
-- The QA email is intentionally absent and must be added interactively later.
INSERT OR IGNORE INTO creators (id,name,slug,initials,accent,status,dropbox_root)
VALUES ('staging-authz-fixture','Staging Authorization Fixture','staging-authz-fixture','QA','#7a6cf6','active',NULL);

-- Existing agency administrators can switch to the fixture without embedding an email.
INSERT OR IGNORE INTO creator_memberships (creator_id,user_email,role,status)
SELECT 'staging-authz-fixture',m.user_email,'agency_admin','active'
FROM creator_memberships m
WHERE m.creator_id='adelaide' AND m.role='agency_admin' AND m.status='active';
