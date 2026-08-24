PRAGMA foreign_keys = ON;

UPDATE bridge_credentials
SET status='revoked',revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
WHERE platform='reddit' AND status='active';

UPDATE social_posts
SET device_claimed_at=NULL,updated_at=CURRENT_TIMESTAMP
WHERE platform='reddit' AND device_claimed_at IS NOT NULL AND status<>'publishing';
