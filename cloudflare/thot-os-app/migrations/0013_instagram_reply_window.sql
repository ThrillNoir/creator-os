PRAGMA foreign_keys = ON;

UPDATE instagram_reply_drafts
SET status='failed',
    error=REPLACE(error, 'Outcome uncertain; check Instagram before sending again. ', ''),
    updated_at=CURRENT_TIMESTAMP
WHERE creator_id='adelaide'
  AND status='uncertain'
  AND error LIKE '%status 403%outside of allowed window%';

INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail)
VALUES (
  'instagram-reply-window-reclassification',
  'adelaide',
  'adelaide-messages-instagram',
  'instagram_reply_rejections_reclassified',
  'migration',
  '{"reason":"provider_403_outside_allowed_window","liveMessagesSent":false}'
);
