-- Wrangler 4.120.0 local migrations accept this nested compound trigger.
-- The remote D1 migration query splits at the CASE terminator and reports
-- `incomplete input` before the trigger's outer END is reached.
CREATE TABLE creator_memberships_repro (
  creator_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TRIGGER creator_memberships_nested_case_repro
BEFORE INSERT ON creator_memberships_repro WHEN NEW.status='active'
BEGIN
  SELECT CASE
    WHEN NEW.role='creator' AND EXISTS (
      SELECT 1 FROM creator_memberships_repro
      WHERE user_email=NEW.user_email AND creator_id<>NEW.creator_id
    ) THEN RAISE(ABORT, 'creator_identity_must_be_single_workspace')
    WHEN NEW.role<>'creator' AND EXISTS (
      SELECT 1 FROM creator_memberships_repro
      WHERE user_email=NEW.user_email AND role='creator' AND creator_id<>NEW.creator_id
    ) THEN RAISE(ABORT, 'creator_identity_cannot_be_staff')
  END;
END;
