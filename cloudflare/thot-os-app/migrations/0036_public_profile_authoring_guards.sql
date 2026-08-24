PRAGMA foreign_keys = ON;

-- The public slug becomes a stable social-facing identifier once a profile has
-- been published. Changing it later would silently strand the previously
-- distributed creator URL, so withdrawal must be explicit before a change.
CREATE TRIGGER IF NOT EXISTS creator_public_profile_slug_immutable_after_publication
BEFORE UPDATE OF slug ON creator_public_profiles
WHEN OLD.published_version_id IS NOT NULL AND NEW.slug<>OLD.slug
BEGIN
  SELECT RAISE(ABORT, 'public_profile_slug_is_immutable_after_publication');
END;

-- Authoring has exactly one mutable draft per creator. This prevents a second
-- browser tab or retry from creating competing approval candidates.
CREATE TRIGGER IF NOT EXISTS creator_public_profile_single_draft
BEFORE INSERT ON creator_public_profile_versions
WHEN NEW.status='draft'
 AND EXISTS (
   SELECT 1 FROM creator_public_profile_versions v
   WHERE v.profile_id=NEW.profile_id AND v.creator_id=NEW.creator_id AND v.status='draft'
 )
BEGIN
  SELECT RAISE(ABORT, 'public_profile_already_has_a_draft_version');
END;

-- Approval is one-way. A published/superseded/revoked version cannot be
-- reopened and edited; authoring always creates a new draft version.
CREATE TRIGGER IF NOT EXISTS creator_public_profile_version_no_reopen
BEFORE UPDATE OF status ON creator_public_profile_versions
WHEN OLD.status<>'draft' AND NEW.status='draft'
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_cannot_return_to_draft');
END;
