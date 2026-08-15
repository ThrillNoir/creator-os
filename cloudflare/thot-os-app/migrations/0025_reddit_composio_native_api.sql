PRAGMA foreign_keys = ON;

UPDATE operational_accounts
SET connection_status=CASE WHEN EXISTS (
      SELECT 1 FROM provider_connections pc
      WHERE pc.creator_id=operational_accounts.creator_id AND pc.service='reddit' AND pc.status='active'
    ) THEN 'connected' ELSE 'needs_reconnection' END,
    publishing_mode='scheduled_api',
    publishing_authority=CASE WHEN EXISTS (
      SELECT 1 FROM provider_connections pc
      WHERE pc.creator_id=operational_accounts.creator_id AND pc.service='reddit' AND pc.status='active'
    ) THEN 'confirmed' ELSE 'blocked' END,
    warning_level=CASE WHEN EXISTS (
      SELECT 1 FROM provider_connections pc
      WHERE pc.creator_id=operational_accounts.creator_id AND pc.service='reddit' AND pc.status='active'
    ) THEN 'none' ELSE 'attention' END,
    warning_message=CASE WHEN EXISTS (
      SELECT 1 FROM provider_connections pc
      WHERE pc.creator_id=operational_accounts.creator_id AND pc.service='reddit' AND pc.status='active'
    ) THEN '' ELSE 'Reconnect Reddit through Composio before direct native image publishing.' END,
    last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE platform='reddit';

UPDATE social_posts
SET status='failed',
    error='Outcome uncertain; verify Reddit before retrying. This post was still assigned to the retired browser publisher when Composio native API delivery was enabled.',
    updated_at=CURRENT_TIMESTAMP
WHERE platform='reddit' AND status='publishing';
