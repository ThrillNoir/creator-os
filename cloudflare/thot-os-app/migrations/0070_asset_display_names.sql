-- Creator-facing names are metadata. Keep original filenames and R2 object keys intact.
ALTER TABLE assets ADD COLUMN display_stem TEXT
  CHECK(display_stem IS NULL OR length(display_stem) BETWEEN 1 AND 120);
