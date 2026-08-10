UPDATE messaging_connections
SET outbound_validated = 0,
    last_error = 'Instagram messaging events are now subscribed. Ask the person to send one new DM, refresh messages, then validate the conversation before the next test.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'adelaide-messages-instagram'
  AND creator_id = 'adelaide';

INSERT INTO messaging_audit_events
  (id, creator_id, connection_id, event_type, actor, detail)
VALUES
  (
    lower(hex(randomblob(16))),
    'adelaide',
    'adelaide-messages-instagram',
    'instagram_webhook_subscription_repaired',
    'instagram-scheduler',
    '{"subscribedFields":["messages","messaging_postbacks","messaging_seen","message_reactions","messaging_referral"],"liveMessageSent":false}'
  );
