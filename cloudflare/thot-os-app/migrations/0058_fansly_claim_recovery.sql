PRAGMA foreign_keys = ON;

-- Browser work can outlive a worker request. A per-claim token lets a late
-- worker report only its own result after a stale claim has been reclaimed.
ALTER TABLE premium_thread_sync_state ADD COLUMN claim_token TEXT;
ALTER TABLE premium_message_drafts ADD COLUMN claim_token TEXT;

CREATE INDEX premium_thread_sync_claim_recovery
  ON premium_thread_sync_state(creator_id,status,last_requested_at,attempts);
CREATE INDEX premium_message_draft_claim_recovery
  ON premium_message_drafts(creator_id,status,claimed_at);
