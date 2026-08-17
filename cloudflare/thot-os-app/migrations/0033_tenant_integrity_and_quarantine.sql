PRAGMA foreign_keys = ON;

-- Existing migration history is preserved.  These additive guards make the
-- creator column authoritative whenever an existing table links two
-- creator-owned records.  SQLite cannot add a composite foreign key to an
-- already-created table, so the guards are deliberately implemented as
-- fail-closed triggers rather than rewriting applied history.
CREATE TABLE IF NOT EXISTS tenant_integrity_exceptions (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  creator_id TEXT,
  related_creator_id TEXT,
  reason TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  UNIQUE(table_name, record_key, reason)
);

CREATE UNIQUE INDEX IF NOT EXISTS assets_id_creator_pair
  ON assets(id, creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS operational_accounts_id_creator_pair
  ON operational_accounts(id, creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS reddit_communities_id_creator_pair
  ON reddit_communities(id, creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS people_id_creator_pair
  ON people(id, creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS social_posts_id_creator_pair
  ON social_posts(id, creator_id);

-- Record any pre-existing inconsistencies without changing user data.  They
-- must be resolved explicitly before a record can be used operationally.
INSERT OR IGNORE INTO tenant_integrity_exceptions (id, table_name, record_key, creator_id, related_creator_id, reason)
SELECT 'tenant-integrity:asset-classification:' || ac.asset_id,
       'asset_classifications', ac.asset_id, ac.creator_id, a.creator_id,
       'asset_creator_mismatch'
FROM asset_classifications ac JOIN assets a ON a.id=ac.asset_id
WHERE a.creator_id<>ac.creator_id;

INSERT OR IGNORE INTO tenant_integrity_exceptions (id, table_name, record_key, creator_id, related_creator_id, reason)
SELECT 'tenant-integrity:asset-destination:' || ad.asset_id || ':' || ad.destination,
       'asset_destinations', ad.asset_id || ':' || ad.destination, ad.creator_id, a.creator_id,
       'asset_creator_mismatch'
FROM asset_destinations ad JOIN assets a ON a.id=ad.asset_id
WHERE a.creator_id<>ad.creator_id;

INSERT OR IGNORE INTO tenant_integrity_exceptions (id, table_name, record_key, creator_id, related_creator_id, reason)
SELECT 'tenant-integrity:asset-person:' || ap.asset_id || ':' || ap.person_id,
       'asset_people', ap.asset_id || ':' || ap.person_id, ap.creator_id, a.creator_id,
       'asset_creator_mismatch'
FROM asset_people ap JOIN assets a ON a.id=ap.asset_id
WHERE a.creator_id<>ap.creator_id;

INSERT OR IGNORE INTO tenant_integrity_exceptions (id, table_name, record_key, creator_id, related_creator_id, reason)
SELECT 'tenant-integrity:asset-person-record:' || ap.asset_id || ':' || ap.person_id,
       'asset_people', ap.asset_id || ':' || ap.person_id, ap.creator_id, p.creator_id,
       'person_creator_mismatch'
FROM asset_people ap JOIN people p ON p.id=ap.person_id
WHERE p.creator_id<>ap.creator_id;

INSERT OR IGNORE INTO tenant_integrity_exceptions (id, table_name, record_key, creator_id, related_creator_id, reason)
SELECT 'tenant-integrity:social-post-account:' || sp.id,
       'social_posts', sp.id, sp.creator_id, oa.creator_id,
       'account_creator_mismatch'
FROM social_posts sp JOIN operational_accounts oa ON oa.id=sp.account_id
WHERE oa.creator_id<>sp.creator_id;

INSERT OR IGNORE INTO tenant_integrity_exceptions (id, table_name, record_key, creator_id, related_creator_id, reason)
SELECT 'tenant-integrity:social-post-asset:' || sp.id,
       'social_posts', sp.id, sp.creator_id, a.creator_id,
       'asset_creator_mismatch'
FROM social_posts sp JOIN assets a ON a.id=sp.asset_id
WHERE a.creator_id<>sp.creator_id;

CREATE TRIGGER IF NOT EXISTS asset_classifications_asset_creator_insert
BEFORE INSERT ON asset_classifications
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_classifications_asset_creator_update
BEFORE UPDATE OF asset_id, creator_id ON asset_classifications
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_classifications_teaser_creator_insert
BEFORE INSERT ON asset_classifications
WHEN NEW.teaser_for_asset_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.teaser_for_asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_teaser_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_classifications_teaser_creator_update
BEFORE UPDATE OF teaser_for_asset_id, creator_id ON asset_classifications
WHEN NEW.teaser_for_asset_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.teaser_for_asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_teaser_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_destinations_asset_creator_insert
BEFORE INSERT ON asset_destinations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_destination_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_destinations_asset_creator_update
BEFORE UPDATE OF asset_id, creator_id ON asset_destinations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_destination_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_people_creator_insert
BEFORE INSERT ON asset_people
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_person_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_people_creator_update
BEFORE UPDATE OF asset_id, person_id, creator_id ON asset_people
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_person_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_paid_consent_creator_insert
BEFORE INSERT ON asset_paid_consent_attestations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_paid_consent_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS asset_paid_consent_creator_update
BEFORE UPDATE OF asset_id, person_id, creator_id ON asset_paid_consent_attestations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_paid_consent_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS social_posts_related_creator_insert
BEFORE INSERT ON social_posts
WHEN (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts oa WHERE oa.id=NEW.account_id AND oa.creator_id=NEW.creator_id))
  OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id))
  OR (NEW.community_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reddit_communities rc WHERE rc.id=NEW.community_id AND rc.creator_id=NEW.creator_id))
BEGIN
  SELECT RAISE(ABORT, 'social_post_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS social_posts_related_creator_update
BEFORE UPDATE OF creator_id, account_id, asset_id, community_id ON social_posts
WHEN (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts oa WHERE oa.id=NEW.account_id AND oa.creator_id=NEW.creator_id))
  OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id))
  OR (NEW.community_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reddit_communities rc WHERE rc.id=NEW.community_id AND rc.creator_id=NEW.creator_id))
BEGIN
  SELECT RAISE(ABORT, 'social_post_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS social_post_events_creator_insert
BEFORE INSERT ON social_post_events
WHEN NOT EXISTS (SELECT 1 FROM social_posts sp WHERE sp.id=NEW.post_id AND sp.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'social_post_event_creator_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS social_post_events_creator_update
BEFORE UPDATE OF post_id, creator_id ON social_post_events
WHEN NOT EXISTS (SELECT 1 FROM social_posts sp WHERE sp.id=NEW.post_id AND sp.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'social_post_event_creator_mismatch');
END;
