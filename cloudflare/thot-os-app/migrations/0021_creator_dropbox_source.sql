PRAGMA foreign_keys = ON;

-- The link is a human-facing reference only. Catalogue reads always use the
-- creator-scoped Dropbox path, never a browser session or a shared-link token.
ALTER TABLE creators ADD COLUMN dropbox_link TEXT;
