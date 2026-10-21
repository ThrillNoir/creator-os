-- A hidden card stays in the creator's private draft but is omitted from a new public release.
-- Existing draft cards keep their prior visible behavior until the creator changes them.
ALTER TABLE creator_portfolio_items ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0,1));

-- Creator-entered contact choices remain private until a separate approved release.
ALTER TABLE creator_portfolio_draft_state ADD COLUMN contact_telegram TEXT NOT NULL DEFAULT '';
ALTER TABLE creator_portfolio_draft_state ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE creator_portfolio_draft_state ADD COLUMN contact_message TEXT NOT NULL DEFAULT '';
