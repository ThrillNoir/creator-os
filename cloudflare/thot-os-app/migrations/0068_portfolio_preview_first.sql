PRAGMA foreign_keys = ON;

-- A draft card is its public-safe preview asset. The optional full-length
-- association stays in private D1 authoring state; it is never a public URL.
ALTER TABLE creator_portfolio_items ADD COLUMN full_length_asset_id TEXT REFERENCES assets(id);
-- Existing rows were authored under a full-video-first contract. Keep their
-- asset and preview IDs unchanged while the old Web Worker is still serving.
-- The new Web UI leaves legacy full-video rows private for creator review.
-- A newly selected Library preview sets this to 1 explicitly.
ALTER TABLE creator_portfolio_items ADD COLUMN preview_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(preview_confirmed IN (0,1));
CREATE TRIGGER creator_portfolio_full_asset_insert BEFORE INSERT ON creator_portfolio_items
WHEN NEW.full_length_asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM assets WHERE id=NEW.full_length_asset_id AND creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT, 'portfolio_full_asset_creator_mismatch'); END;
CREATE TRIGGER creator_portfolio_full_asset_update BEFORE UPDATE OF full_length_asset_id,creator_id ON creator_portfolio_items
WHEN NEW.full_length_asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM assets WHERE id=NEW.full_length_asset_id AND creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT, 'portfolio_full_asset_creator_mismatch'); END;

-- An existing image card already represented its public preview. Keep that
-- choice; an old video without a teaser still requires a fresh selection.
UPDATE creator_portfolio_items SET preview_confirmed=1
WHERE preview_confirmed=0 AND preview_asset_id IS NULL
  AND EXISTS (SELECT 1 FROM assets a WHERE a.id=creator_portfolio_items.asset_id
    AND a.creator_id=creator_portfolio_items.creator_id
    AND lower(a.extension) IN ('jpg','jpeg','png','webp'));

CREATE TABLE creator_portfolio_draft_state (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO creator_portfolio_draft_state (creator_id) SELECT id FROM creators;
CREATE TRIGGER creator_portfolio_draft_state_new_creator AFTER INSERT ON creators
BEGIN
  INSERT INTO creator_portfolio_draft_state (creator_id) VALUES (NEW.id);
END;
