PRAGMA foreign_keys = ON;

-- A creator selection is now one private OnlyFans message containing every
-- selected photo/video. Bridge v0.23.0 and protocol v4 claim, attach, attempt,
-- and receipt the whole creator-scoped batch atomically.
UPDATE onlyfans_delivery_controls
SET minimum_bridge_version='0.23.0',
    changed_at=CURRENT_TIMESTAMP,
    reason='grouped OnlyFans private-message delivery requires bridge v0.23.0'
WHERE minimum_bridge_version<>'0.23.0';

