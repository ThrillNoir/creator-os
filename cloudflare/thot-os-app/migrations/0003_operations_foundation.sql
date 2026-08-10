PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS operational_accounts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  connection_status TEXT NOT NULL CHECK(connection_status IN ('connected','needs_reconnection','needs_check','not_connected')),
  publishing_mode TEXT NOT NULL CHECK(publishing_mode IN ('direct_api','scheduled_api','finish_on_device','local_bridge','not_configured')),
  publishing_authority TEXT NOT NULL CHECK(publishing_authority IN ('confirmed','blocked','device_only','not_configured')),
  warning_level TEXT NOT NULL DEFAULT 'none' CHECK(warning_level IN ('none','attention','blocked')),
  warning_message TEXT NOT NULL DEFAULT '',
  external_identity_confirmed_at TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  source_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, platform, label)
);

CREATE INDEX IF NOT EXISTS operational_accounts_creator_platform
  ON operational_accounts(creator_id, platform);

CREATE TABLE IF NOT EXISTS reddit_communities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rules_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  allows_nsfw INTEGER NOT NULL DEFAULT 0 CHECK(allows_nsfw IN (0,1)),
  creator_verified INTEGER NOT NULL DEFAULT 0 CHECK(creator_verified IN (0,1)),
  verification_required INTEGER NOT NULL DEFAULT 0 CHECK(verification_required IN (0,1)),
  flair_required INTEGER NOT NULL DEFAULT 0 CHECK(flair_required IN (0,1)),
  allowed_post_types TEXT NOT NULL DEFAULT 'image',
  minimum_account_age_days INTEGER NOT NULL DEFAULT 0,
  minimum_karma INTEGER NOT NULL DEFAULT 0,
  cooldown_hours INTEGER NOT NULL DEFAULT 24,
  title_guidance TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  last_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, name)
);

CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  community_id INTEGER REFERENCES reddit_communities(id) ON DELETE SET NULL,
  source_local_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  content_rating TEXT CHECK(content_rating IN ('sfw','nsfw')),
  status TEXT NOT NULL CHECK(status IN ('draft','scheduled','publishing','published','failed','cancelled')),
  scheduled_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  published_at TEXT,
  external_post_id TEXT,
  external_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, platform, source_local_id)
);

CREATE INDEX IF NOT EXISTS social_posts_creator_platform_status
  ON social_posts(creator_id, platform, status, scheduled_at);

CREATE TABLE IF NOT EXISTS social_post_events (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS social_post_events_creator_post
  ON social_post_events(creator_id, post_id, created_at DESC);

INSERT OR IGNORE INTO creators (id,name,slug,initials,accent,status)
VALUES ('adelaide','Adelaide','adelaide','A','#d66f92','active');

INSERT INTO operational_accounts
  (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority,warning_level,warning_message,external_identity_confirmed_at,last_checked_at,last_success_at,source_updated_at)
VALUES
  ('adelaide-instagram-main','adelaide','instagram','Adelaide IG Main','@adelaide.suede','needs_reconnection','direct_api','blocked','blocked','Meta access token was invalidated. Reconnect before publishing.','2026-08-06 03:56:49','2026-08-06 03:56:49','2026-08-06 03:57:43','2026-08-06 03:57:43'),
  ('adelaide-reddit-main','adelaide','reddit','Adelaide Reddit','u/AdelaideSuede','needs_reconnection','scheduled_api','blocked','blocked','Connect and verify Adelaide’s current Reddit account before publishing.',NULL,'2026-08-09 03:00:00',NULL,'2026-08-09 03:00:00'),
  ('adelaide-fansly-main','adelaide','fansly','Adelaide Fansly','@AdelaideSuede','not_connected','local_bridge','device_only','attention','Native vault delivery remains on the signed device bridge.',NULL,NULL,NULL,'2026-08-09 00:15:45'),
  ('adelaide-youtube-main','adelaide','youtube','Adelaide YouTube','@adelaidesuede','needs_check','not_configured','not_configured','attention','Identity was previously confirmed; publishing authority has not been verified.','2026-08-01 04:59:35','2026-08-01 04:59:35',NULL,'2026-08-01 04:59:35')
ON CONFLICT(id) DO UPDATE SET
  label=excluded.label,handle=excluded.handle,connection_status=excluded.connection_status,
  publishing_mode=excluded.publishing_mode,publishing_authority=excluded.publishing_authority,
  warning_level=excluded.warning_level,warning_message=excluded.warning_message,
  external_identity_confirmed_at=excluded.external_identity_confirmed_at,last_checked_at=excluded.last_checked_at,
  last_success_at=excluded.last_success_at,source_updated_at=excluded.source_updated_at,updated_at=CURRENT_TIMESTAMP;

INSERT INTO reddit_communities
  (id,creator_id,name,rules_url,status,allows_nsfw,creator_verified,verification_required,flair_required,allowed_post_types,minimum_account_age_days,minimum_karma,cooldown_hours,title_guidance,notes,last_verified_at)
VALUES
  (1,'adelaide','GirlsInBathtubs','https://www.reddit.com/r/GirlsInBathtubs/about/rules','active',1,0,0,0,'image',0,0,24,'','Imported from the local Reddit Ops workspace.','2026-08-04'),
  (2,'adelaide','Footfetishforfemales','https://www.reddit.com/r/Footfetishforfemales/about/rules','active',1,0,0,0,'image',0,0,24,'','Imported from the local Reddit Ops workspace.','2026-08-06')
ON CONFLICT(creator_id,name) DO UPDATE SET
  rules_url=excluded.rules_url,status=excluded.status,allows_nsfw=excluded.allows_nsfw,
  creator_verified=excluded.creator_verified,verification_required=excluded.verification_required,
  flair_required=excluded.flair_required,allowed_post_types=excluded.allowed_post_types,
  minimum_account_age_days=excluded.minimum_account_age_days,minimum_karma=excluded.minimum_karma,
  cooldown_hours=excluded.cooldown_hours,title_guidance=excluded.title_guidance,notes=excluded.notes,
  last_verified_at=excluded.last_verified_at,updated_at=CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO social_posts
  (id,creator_id,platform,account_id,asset_id,community_id,source_local_id,title,caption,content_rating,status,approved_at,published_at,external_post_id,external_url,error,created_at,updated_at)
SELECT 'reddit-local-1','adelaide','reddit','adelaide-reddit-main',a.id,1,'1','The bath was taking so long to fill up.','The bath was taking so long to fill up.','nsfw','published','2026-08-04 05:07:24','2026-08-04 05:14:36','t3_1vf0z32','https://www.reddit.com/r/GirlsInBathtubs/comments/1vf0z32/the_bath_was_taking_so_long_to_fill_up/',NULL,'2026-08-04 05:07:14','2026-08-04 05:14:36'
FROM assets a WHERE a.id='local:adelaide:STILLS/Capture-THRILL NOIR-20231015_120446-retouched.jpg' AND a.creator_id='adelaide'
UNION ALL
SELECT 'reddit-local-2','adelaide','reddit','adelaide-reddit-main',a.id,2,'2','Right where I belong.','Right where I belong.','nsfw','failed','2026-08-06 07:42:56',NULL,NULL,NULL,'Connected Reddit account expired before publishing.','2026-08-06 07:42:47','2026-08-06 07:42:58'
FROM assets a WHERE a.id='local:adelaide:STILLS/web opti/_Z623264-retouched.jpg' AND a.creator_id='adelaide';
