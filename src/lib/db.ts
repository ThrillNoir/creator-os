import "server-only";

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { thrillNoirPilot } from "./pilot-config";

const dataDirectory = path.resolve(".creator-os");
const databasePath = path.join(dataDirectory, "creator-os.sqlite");
const libraryIndexPath = path.join(dataDirectory, "library-index.json");

let database: Database.Database | undefined;

function openDatabase() {
  if (database) return database;
  database = new Database(databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(database);
  seedAccounts(database);
  syncIndexedAssets(database);
  return database;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      initials TEXT NOT NULL,
      accent TEXT NOT NULL DEFAULT '#6f4df6',
      status TEXT NOT NULL DEFAULT 'active',
      media_source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      label TEXT NOT NULL,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT NOT NULL,
      publishing_mode TEXT NOT NULL,
      connection_status TEXT NOT NULL DEFAULT 'not_connected',
      last_published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      basename TEXT NOT NULL,
      extension TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      modified_at TEXT NOT NULL,
      filename_class TEXT NOT NULL,
      repeated_basename INTEGER NOT NULL DEFAULT 0,
      creator_notes TEXT NOT NULL DEFAULT '',
      safety_level TEXT NOT NULL DEFAULT 'unreviewed',
      workflow_status TEXT NOT NULL DEFAULT 'available',
      source_available INTEGER NOT NULL DEFAULT 1,
      indexed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (asset_id, tag)
    );
    CREATE TABLE IF NOT EXISTS asset_classifications (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      safety TEXT CHECK(safety IN ('sfw','nsfw')),
      is_teaser INTEGER NOT NULL DEFAULT 0 CHECK(is_teaser IN (0,1)),
      is_multi INTEGER NOT NULL DEFAULT 0 CHECK(is_multi IN (0,1)),
      teaser_for_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT,
      reviewed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS asset_destinations (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (asset_id,destination)
    );
    CREATE TABLE IF NOT EXISTS asset_people (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'creator_friend',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (asset_id,person_id)
    );
    CREATE TABLE IF NOT EXISTS asset_paid_consent_attestations (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      evidence_platform TEXT NOT NULL CHECK(evidence_platform IN ('onlyfans','fansly')),
      confirmed_by TEXT NOT NULL,
      confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note TEXT NOT NULL DEFAULT '',
      revoked_at TEXT,
      PRIMARY KEY (asset_id,person_id)
    );
    CREATE TABLE IF NOT EXISTS asset_classification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      actor TEXT NOT NULL,
      event_type TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL REFERENCES assets(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      creator_notes TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_at TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id),
      decision TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      snapshot TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      role TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      output TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS automation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT REFERENCES creators(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      queue TEXT NOT NULL DEFAULT 'intake',
      idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'created',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      dispatched_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      processed_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT REFERENCES creators(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES automation_events(id) ON DELETE SET NULL,
      receipt_key TEXT UNIQUE,
      workflow_type TEXT NOT NULL,
      status TEXT NOT NULL,
      external_id TEXT,
      public_url TEXT,
      detail TEXT NOT NULL DEFAULT '{}',
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_package_assets (
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id),
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (post_package_id, asset_id)
    );
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      stage_name TEXT,
      consent_status TEXT NOT NULL DEFAULT 'not_recorded',
      tagging_preference TEXT NOT NULL DEFAULT 'ask_each_time',
      private_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS person_social_tags (
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      PRIMARY KEY (person_id, platform)
    );
    CREATE TABLE IF NOT EXISTS post_package_people (
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id),
      tag_approved INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (post_package_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS creator_voice_profiles (
      creator_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      perspective TEXT NOT NULL DEFAULT 'brand_voice',
      tone_notes TEXT NOT NULL DEFAULT '',
      vocabulary TEXT NOT NULL DEFAULT '',
      phrases_to_avoid TEXT NOT NULL DEFAULT '',
      emoji_style TEXT NOT NULL DEFAULT 'light',
      hashtag_style TEXT NOT NULL DEFAULT 'minimal',
      approved_examples TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS research_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      summary TEXT NOT NULL,
      recommendation TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'medium',
      observed_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS publication_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id),
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actor TEXT NOT NULL DEFAULT 'BR',
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS platform_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      external_account_id TEXT,
      external_username TEXT,
      scopes TEXT NOT NULL DEFAULT '',
      token_ciphertext TEXT NOT NULL,
      token_expires_at TEXT,
      connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_checked_at TEXT,
      last_error TEXT,
      UNIQUE(account_id, provider)
    );
    CREATE TABLE IF NOT EXISTS creator_login_profiles (
      creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
      google_email TEXT NOT NULL DEFAULT '',
      chrome_profile_label TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS local_bridge_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly')),
      browser TEXT NOT NULL DEFAULT 'chrome',
      profile_directory TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      expected_username TEXT NOT NULL DEFAULT '',
      observed_username TEXT NOT NULL DEFAULT '',
      identity_confirmed_at TEXT,
      last_opened_at TEXT,
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id)
    );
    CREATE TABLE IF NOT EXISTS messaging_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('telegram','instagram','onlyfans','fansly','reddit','signal')),
      display_name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'observe' CHECK(mode IN ('observe','assist','operate')),
      read_enabled INTEGER NOT NULL DEFAULT 1,
      write_enabled INTEGER NOT NULL DEFAULT 0,
      outbound_validated INTEGER NOT NULL DEFAULT 0,
      emergency_paused INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_connected',
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(creator_id, platform, account_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS messaging_connection_service_unique
      ON messaging_connections(creator_id,platform) WHERE account_id IS NULL;
    CREATE TABLE IF NOT EXISTS message_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      connection_id INTEGER NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
      external_thread_id TEXT NOT NULL,
      participant_name TEXT NOT NULL DEFAULT '',
      participant_handle TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(connection_id, external_thread_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      external_message_id TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      sender_type TEXT NOT NULL DEFAULT 'fan',
      body TEXT NOT NULL DEFAULT '',
      media_json TEXT NOT NULL DEFAULT '[]',
      sent_at TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'observed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(thread_id, external_message_id)
    );
    CREATE TABLE IF NOT EXISTS message_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'human' CHECK(author_type IN ('human','ai')),
      author_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','awaiting_approval','approved','sending','sent','rejected','failed')),
      approved_by TEXT,
      approved_at TEXT,
      sent_at TEXT,
      external_message_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messaging_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      connection_id INTEGER REFERENCES messaging_connections(id) ON DELETE SET NULL,
      thread_id INTEGER REFERENCES message_threads(id) ON DELETE SET NULL,
      draft_id INTEGER REFERENCES message_drafts(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS local_bridge_pairings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly')),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      paired_at TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS local_bridge_outbound_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      connection_id INTEGER NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      draft_id INTEGER NOT NULL UNIQUE REFERENCES message_drafts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly')),
      status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','claimed','sent','failed')),
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      claimed_at TEXT,
      completed_at TEXT,
      error TEXT,
      receipt TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS message_thread_sync_state (
      thread_id INTEGER PRIMARY KEY REFERENCES message_threads(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','complete','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_requested_at TEXT,
      last_completed_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vault_upload_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      connection_id INTEGER NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id),
      platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly')),
      status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','claimed','staged','verified','failed')),
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      claimed_at TEXT,
      completed_at TEXT,
      error TEXT,
      receipt TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS composio_link_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      toolkit TEXT NOT NULL,
      provider TEXT NOT NULL,
      connected_account_id TEXT NOT NULL UNIQUE,
      expected_username TEXT NOT NULL DEFAULT '',
      discovered_account_id TEXT,
      discovered_username TEXT,
      discovered_name TEXT,
      discovered_profile_image TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_authorization',
      error TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS creator_service_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      service TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      connected_account_id TEXT NOT NULL,
      composio_user_id TEXT NOT NULL DEFAULT '',
      external_account_id TEXT,
      display_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      identity_confirmed_at TEXT,
      connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(creator_id, service)
    );
    CREATE TABLE IF NOT EXISTS agency_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'connected',
      connected_account_id TEXT NOT NULL UNIQUE,
      composio_user_id TEXT NOT NULL DEFAULT '',
      external_account_id TEXT,
      display_name TEXT NOT NULL DEFAULT '',
      identity_confirmed_at TEXT,
      source_service_connection_id INTEGER REFERENCES creator_service_connections(id),
      connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS telegram_creator_pairings (
      creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
      service_connection_id INTEGER NOT NULL REFERENCES creator_service_connections(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL UNIQUE,
      telegram_user_id TEXT NOT NULL,
      telegram_username TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'paired',
      last_update_id TEXT,
      paired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS telegram_pairing_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'waiting',
      candidate_chat_id TEXT,
      candidate_user_id TEXT,
      candidate_username TEXT NOT NULL DEFAULT '',
      candidate_display_name TEXT NOT NULL DEFAULT '',
      candidate_update_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS telegram_handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending',
      asset_count INTEGER NOT NULL DEFAULT 0,
      sent_asset_count INTEGER NOT NULL DEFAULT 0,
      message_ids TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS telegram_creator_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL,
      message_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending',
      telegram_message_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS composio_service_link_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      service TEXT NOT NULL,
      connected_account_id TEXT NOT NULL UNIQUE,
      discovered_account_id TEXT,
      discovered_name TEXT,
      discovered_email TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_authorization',
      error TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS publication_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      provider TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'test_private',
      status TEXT NOT NULL DEFAULT 'awaiting_publish_approval',
      idempotency_key TEXT NOT NULL UNIQUE,
      approved_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      external_post_id TEXT,
      receipt TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS analytics_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      platform TEXT NOT NULL,
      source_name TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS analytics_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL REFERENCES analytics_imports(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      platform TEXT NOT NULL,
      period_date TEXT NOT NULL,
      account_handle TEXT NOT NULL DEFAULT '',
      impressions REAL,
      reach REAL,
      views REAL,
      followers REAL,
      subscribers REAL,
      revenue REAL,
      currency TEXT NOT NULL DEFAULT 'AUD',
      source_row TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creator_financial_settings (
      creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
      agency_split_bps INTEGER NOT NULL DEFAULT 0 CHECK(agency_split_bps BETWEEN 0 AND 10000),
      revenue_basis TEXT NOT NULL DEFAULT 'imported_platform_earnings',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS instagram_analytics_syncs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      media_count INTEGER NOT NULL DEFAULT 0,
      insight_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS instagram_media_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT '',
      media_product_type TEXT NOT NULL DEFAULT '',
      permalink TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL,
      likes REAL,
      comments REAL,
      reach REAL,
      views REAL,
      saves REAL,
      shares REAL,
      total_interactions REAL,
      reposts REAL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(creator_id, account_id, media_id)
    );
    CREATE TABLE IF NOT EXISTS instagram_follower_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      observed_at TEXT NOT NULL,
      hourly_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(creator_id, account_id, observed_at)
    );
    CREATE TABLE IF NOT EXISTS post_publication_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      external_media_id TEXT NOT NULL,
      permalink TEXT NOT NULL DEFAULT '',
      match_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      matched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(creator_id, post_package_id),
      UNIQUE(creator_id, platform, external_media_id)
    );
    CREATE TABLE IF NOT EXISTS post_outcome_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      publication_match_id INTEGER NOT NULL REFERENCES post_publication_matches(id) ON DELETE CASCADE,
      horizon TEXT NOT NULL,
      elapsed_hours REAL NOT NULL,
      reach REAL,
      views REAL,
      likes REAL,
      comments REAL,
      saves REAL,
      shares REAL,
      total_interactions REAL,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(publication_match_id, horizon)
    );
    CREATE TABLE IF NOT EXISTS creator_reminder_rules (
      creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      lead_minutes INTEGER NOT NULL DEFAULT 30,
      overdue_minutes INTEGER NOT NULL DEFAULT 30,
      timezone TEXT NOT NULL DEFAULT 'Australia/Perth',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS creator_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id) ON DELETE CASCADE,
      reminder_type TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_at TEXT,
      sent_at TEXT,
      snoozed_until TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(creator_id, post_package_id, reminder_type, scheduled_for)
    );
    CREATE TABLE IF NOT EXISTS reddit_communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      name TEXT NOT NULL,
      rules_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      allows_nsfw INTEGER NOT NULL DEFAULT 0,
      creator_verified INTEGER NOT NULL DEFAULT 0,
      verification_required INTEGER NOT NULL DEFAULT 0,
      flair_required INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS reddit_post_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      post_package_id INTEGER NOT NULL REFERENCES post_packages(id),
      community_id INTEGER NOT NULL REFERENCES reddit_communities(id),
      title TEXT NOT NULL,
      flair TEXT NOT NULL DEFAULT '',
      content_rating TEXT NOT NULL DEFAULT 'sfw',
      scheduled_at TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_target_approval',
      idempotency_key TEXT NOT NULL UNIQUE,
      approved_at TEXT,
      submitted_at TEXT,
      external_post_id TEXT,
      external_url TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`
    INSERT OR IGNORE INTO creators (id, name, slug, initials, accent, status, media_source)
    VALUES ('thrill-noir', 'Thrill Noir', 'thrill-noir', 'TN', '#6f4df6', 'active', ?)
  `).run(thrillNoirPilot.mediaSource);
  db.exec(`
    INSERT OR IGNORE INTO creators (id, name, slug, initials, accent, status)
    VALUES ('adelaide', 'Adelaide', 'adelaide', 'A', '#d66f92', 'setup')
  `);
  const packageColumns = db.prepare("PRAGMA table_info(post_packages)").all() as Array<{ name: string }>;
  if (!packageColumns.some((column) => column.name === "bundle_id")) {
    db.exec("ALTER TABLE post_packages ADD COLUMN bundle_id TEXT");
    db.exec("UPDATE post_packages SET bundle_id='legacy-' || id WHERE bundle_id IS NULL");
  }
  const taskColumns = db.prepare("PRAGMA table_info(agent_tasks)").all() as Array<{ name: string }>;
  if (!taskColumns.some((column) => column.name === "post_package_id")) {
    db.exec("ALTER TABLE agent_tasks ADD COLUMN post_package_id INTEGER REFERENCES post_packages(id)");
  }
  if (!taskColumns.some((column) => column.name === "creator_id")) {
    db.exec("ALTER TABLE agent_tasks ADD COLUMN creator_id TEXT REFERENCES creators(id)");
    db.exec(`
      UPDATE agent_tasks SET creator_id=COALESCE(
        (SELECT a.creator_id FROM post_packages p JOIN accounts a ON a.id=p.account_id WHERE p.id=agent_tasks.post_package_id),
        'thrill-noir'
      ) WHERE creator_id IS NULL
    `);
  }
  const peopleColumns = db.prepare("PRAGMA table_info(people)").all() as Array<{ name: string }>;
  if (!peopleColumns.some((column) => column.name === "creator_id")) {
    db.exec("ALTER TABLE people ADD COLUMN creator_id TEXT REFERENCES creators(id)");
    db.exec("UPDATE people SET creator_id='thrill-noir' WHERE creator_id IS NULL");
  }
  const researchColumns = db.prepare("PRAGMA table_info(research_findings)").all() as Array<{ name: string }>;
  if (!researchColumns.some((column) => column.name === "creator_id")) {
    db.exec("ALTER TABLE research_findings ADD COLUMN creator_id TEXT REFERENCES creators(id)");
    db.exec("UPDATE research_findings SET creator_id='thrill-noir' WHERE creator_id IS NULL");
  }
  const connectionColumns = db.prepare("PRAGMA table_info(platform_connections)").all() as Array<{ name: string }>;
  if (!connectionColumns.some((column) => column.name === "refresh_token_ciphertext")) {
    db.exec("ALTER TABLE platform_connections ADD COLUMN refresh_token_ciphertext TEXT");
  }
  if (!connectionColumns.some((column) => column.name === "health_status")) {
    db.exec("ALTER TABLE platform_connections ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unchecked'");
  }
  if (!connectionColumns.some((column) => column.name === "last_refreshed_at")) {
    db.exec("ALTER TABLE platform_connections ADD COLUMN last_refreshed_at TEXT");
  }
  if (!connectionColumns.some((column) => column.name === "revoked_at")) {
    db.exec("ALTER TABLE platform_connections ADD COLUMN revoked_at TEXT");
  }
  if (!connectionColumns.some((column) => column.name === "provider_metadata")) {
    db.exec("ALTER TABLE platform_connections ADD COLUMN provider_metadata TEXT NOT NULL DEFAULT '{}'");
  }
  if (!connectionColumns.some((column) => column.name === "identity_confirmed_at")) {
    db.exec("ALTER TABLE platform_connections ADD COLUMN identity_confirmed_at TEXT");
  }
  if (!connectionColumns.some((column) => column.name === "publishing_authorized_at")) {
    db.exec("ALTER TABLE platform_connections ADD COLUMN publishing_authorized_at TEXT");
  }
  const serviceConnectionColumns = db.prepare("PRAGMA table_info(creator_service_connections)").all() as Array<{ name: string }>;
  if (!serviceConnectionColumns.some((column) => column.name === "composio_user_id")) {
    db.exec("ALTER TABLE creator_service_connections ADD COLUMN composio_user_id TEXT NOT NULL DEFAULT ''");
  }
  const telegramPairingColumns = db.prepare("PRAGMA table_info(telegram_creator_pairings)").all() as Array<{ name: string }>;
  if (!telegramPairingColumns.some((column) => column.name === "agency_integration_id")) {
    db.exec("ALTER TABLE telegram_creator_pairings ADD COLUMN agency_integration_id INTEGER REFERENCES agency_integrations(id)");
  }
  db.exec(`
    INSERT OR IGNORE INTO agency_integrations
      (service, status, connected_account_id, composio_user_id, external_account_id, display_name, identity_confirmed_at, source_service_connection_id)
    SELECT 'telegram', status, connected_account_id, composio_user_id, external_account_id, display_name, identity_confirmed_at, id
    FROM creator_service_connections
    WHERE service='telegram' AND status='connected' AND identity_confirmed_at IS NOT NULL
    ORDER BY id LIMIT 1;
    UPDATE telegram_creator_pairings
    SET agency_integration_id=(SELECT id FROM agency_integrations WHERE service='telegram')
    WHERE agency_integration_id IS NULL;
  `);
  db.exec(`
    INSERT OR IGNORE INTO post_package_assets (post_package_id, asset_id, position)
    SELECT id, asset_id, 0 FROM post_packages
  `);
  const hasCanonicalThreadMigration = db.prepare("SELECT 1 FROM schema_migrations WHERE version='027_canonical_message_thread_ids'").get();
  if (!hasCanonicalThreadMigration) {
    const duplicates = db.prepare(`SELECT duplicate.id AS duplicate_id,canonical.id AS canonical_id
      FROM message_threads duplicate JOIN message_threads canonical
        ON canonical.connection_id=duplicate.connection_id
        AND canonical.external_thread_id=rtrim(duplicate.external_thread_id,'/')
      WHERE duplicate.external_thread_id<>rtrim(duplicate.external_thread_id,'/')`).all() as Array<{duplicate_id:number;canonical_id:number}>;
    db.exec("BEGIN");
    try {
      for (const duplicate of duplicates) {
        db.prepare("UPDATE OR IGNORE messages SET thread_id=? WHERE thread_id=?").run(duplicate.canonical_id,duplicate.duplicate_id);
        db.prepare("DELETE FROM messages WHERE thread_id=?").run(duplicate.duplicate_id);
        db.prepare("UPDATE message_drafts SET thread_id=? WHERE thread_id=?").run(duplicate.canonical_id,duplicate.duplicate_id);
        db.prepare("UPDATE messaging_audit_events SET thread_id=? WHERE thread_id=?").run(duplicate.canonical_id,duplicate.duplicate_id);
        db.prepare("UPDATE local_bridge_outbound_jobs SET thread_id=? WHERE thread_id=?").run(duplicate.canonical_id,duplicate.duplicate_id);
        const canonicalState = db.prepare("SELECT 1 FROM message_thread_sync_state WHERE thread_id=?").get(duplicate.canonical_id);
        if (canonicalState) db.prepare("DELETE FROM message_thread_sync_state WHERE thread_id=?").run(duplicate.duplicate_id);
        else db.prepare("UPDATE message_thread_sync_state SET thread_id=? WHERE thread_id=?").run(duplicate.canonical_id,duplicate.duplicate_id);
        db.prepare("DELETE FROM message_threads WHERE id=?").run(duplicate.duplicate_id);
      }
      db.prepare("UPDATE message_threads SET external_thread_id=rtrim(external_thread_id,'/') WHERE external_thread_id<>rtrim(external_thread_id,'/')").run();
      db.prepare("INSERT INTO schema_migrations (version) VALUES ('027_canonical_message_thread_ids')").run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const hasVaultStagedMigration=db.prepare("SELECT 1 FROM schema_migrations WHERE version='029_vault_staged_status'").get();
  if(!hasVaultStagedMigration){
    db.exec(`
      CREATE TABLE vault_upload_jobs_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        connection_id INTEGER NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id),
        platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly')),
        status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','claimed','staged','verified','failed')),
        approved_by TEXT NOT NULL,approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,claimed_at TEXT,completed_at TEXT,error TEXT,
        receipt TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO vault_upload_jobs_next SELECT * FROM vault_upload_jobs;
      DROP TABLE vault_upload_jobs;
      ALTER TABLE vault_upload_jobs_next RENAME TO vault_upload_jobs;
      INSERT INTO schema_migrations (version) VALUES ('029_vault_staged_status');
    `);
  }
  const hasBridgeSafetyMigration=db.prepare("SELECT 1 FROM schema_migrations WHERE version='030_bridge_safety_and_vault_deduplication'").get();
  if(!hasBridgeSafetyMigration){
    db.exec(`
      UPDATE local_bridge_pairings
      SET expires_at=datetime('now','+365 days')
      WHERE paired_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP;
      CREATE UNIQUE INDEX IF NOT EXISTS vault_upload_active_asset_unique
        ON vault_upload_jobs(creator_id,account_id,asset_id)
        WHERE status IN ('approved','claimed','staged','verified');
      CREATE INDEX IF NOT EXISTS vault_upload_claim_queue
        ON vault_upload_jobs(creator_id,account_id,platform,status,id);
      CREATE INDEX IF NOT EXISTS local_bridge_outbound_claim_queue
        ON local_bridge_outbound_jobs(creator_id,account_id,platform,status,id);
      INSERT INTO schema_migrations (version) VALUES ('030_bridge_safety_and_vault_deduplication');
    `);
  }
  const hasEarningsMigration=db.prepare("SELECT 1 FROM schema_migrations WHERE version='031_currency_safe_earnings_and_import_deduplication'").get();
  if(!hasEarningsMigration){
    const analyticsImportColumns=db.prepare("PRAGMA table_info(analytics_imports)").all() as Array<{name:string}>;
    if(!analyticsImportColumns.some((column)=>column.name==="content_hash")){
      db.exec("ALTER TABLE analytics_imports ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''");
    }
    db.exec(`
      UPDATE analytics_imports SET content_hash='legacy-'||id WHERE content_hash='';
      CREATE UNIQUE INDEX IF NOT EXISTS analytics_import_content_unique
        ON analytics_imports(creator_id,platform,content_hash);
      CREATE TABLE IF NOT EXISTS creator_financial_settings (
        creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
        agency_split_bps INTEGER NOT NULL DEFAULT 0 CHECK(agency_split_bps BETWEEN 0 AND 10000),
        revenue_basis TEXT NOT NULL DEFAULT 'imported_platform_earnings',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO schema_migrations (version) VALUES ('031_currency_safe_earnings_and_import_deduplication');
    `);
  }
  const hasAssetAvailabilityMigration=db.prepare("SELECT 1 FROM schema_migrations WHERE version='032_asset_source_availability'").get();
  if(!hasAssetAvailabilityMigration){
    const assetColumns=db.prepare("PRAGMA table_info(assets)").all() as Array<{name:string}>;
    if(!assetColumns.some((column)=>column.name==="source_available")){
      db.exec("ALTER TABLE assets ADD COLUMN source_available INTEGER NOT NULL DEFAULT 1");
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS assets_creator_available_modified
        ON assets(creator_id,source_available,modified_at DESC);
      INSERT INTO schema_migrations (version) VALUES ('032_asset_source_availability');
    `);
  }
  const hasAssetClassificationMigration=db.prepare("SELECT 1 FROM schema_migrations WHERE version='034_asset_classification_workflow'").get();
  if(!hasAssetClassificationMigration){
    db.exec(`
      INSERT OR IGNORE INTO asset_classifications (asset_id,creator_id,safety,is_teaser,is_multi,reviewed_by,reviewed_at)
      SELECT a.id,a.creator_id,
        CASE WHEN EXISTS(SELECT 1 FROM asset_tags t WHERE t.asset_id=a.id AND t.tag='SFW') THEN 'sfw'
             WHEN EXISTS(SELECT 1 FROM asset_tags t WHERE t.asset_id=a.id AND t.tag='NSFW') THEN 'nsfw'
             ELSE NULL END,
        CASE WHEN EXISTS(SELECT 1 FROM asset_tags t WHERE t.asset_id=a.id AND t.tag='TEASER') THEN 1 ELSE 0 END,
        0,
        CASE WHEN EXISTS(SELECT 1 FROM asset_tags t WHERE t.asset_id=a.id AND t.tag IN ('SFW','NSFW','TEASER')) THEN 'legacy migration' ELSE NULL END,
        CASE WHEN EXISTS(SELECT 1 FROM asset_tags t WHERE t.asset_id=a.id AND t.tag IN ('SFW','NSFW','TEASER')) THEN CURRENT_TIMESTAMP ELSE NULL END
      FROM assets a;
      INSERT OR IGNORE INTO asset_destinations (asset_id,creator_id,destination)
      SELECT t.asset_id,a.creator_id,
        CASE t.tag WHEN 'IG' THEN 'instagram' WHEN 'TIK TOK' THEN 'tiktok'
          WHEN 'REDDIT' THEN 'reddit' WHEN 'X' THEN 'x' WHEN 'PPV' THEN 'ppv' END
      FROM asset_tags t JOIN assets a ON a.id=t.asset_id
      WHERE t.tag IN ('IG','TIK TOK','REDDIT','X','PPV');
      CREATE INDEX IF NOT EXISTS asset_classifications_creator_safety ON asset_classifications(creator_id,safety,is_teaser,is_multi);
      CREATE INDEX IF NOT EXISTS asset_destinations_creator_destination ON asset_destinations(creator_id,destination,asset_id);
      CREATE INDEX IF NOT EXISTS asset_people_creator_asset ON asset_people(creator_id,asset_id);
      CREATE INDEX IF NOT EXISTS asset_classification_events_asset ON asset_classification_events(asset_id,created_at DESC);
      INSERT INTO schema_migrations (version) VALUES ('034_asset_classification_workflow');
    `);
  }
  const hasRedditRatingMigration=db.prepare("SELECT 1 FROM schema_migrations WHERE version='035_reddit_target_content_rating'").get();
  if(!hasRedditRatingMigration){
    const redditTargetColumns=db.prepare("PRAGMA table_info(reddit_post_targets)").all() as Array<{name:string}>;
    if(!redditTargetColumns.some((column)=>column.name==="content_rating")){
      db.exec("ALTER TABLE reddit_post_targets ADD COLUMN content_rating TEXT NOT NULL DEFAULT 'sfw'");
    }
    db.prepare("INSERT INTO schema_migrations (version) VALUES ('035_reddit_target_content_rating')").run();
  }
  const hasAutomationControlPlaneMigration=db.prepare("SELECT 1 FROM schema_migrations WHERE version='036_automation_control_plane'").get();
  if(!hasAutomationControlPlaneMigration){
    const eventColumns=db.prepare("PRAGMA table_info(automation_events)").all() as Array<{name:string}>;
    const addEventColumn=(name:string,sql:string)=>{
      if(!eventColumns.some((column)=>column.name===name))db.exec(sql);
    };
    addEventColumn("queue","ALTER TABLE automation_events ADD COLUMN queue TEXT NOT NULL DEFAULT 'intake'");
    addEventColumn("attempts","ALTER TABLE automation_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
    addEventColumn("updated_at","ALTER TABLE automation_events ADD COLUMN updated_at TEXT");
    addEventColumn("dispatched_at","ALTER TABLE automation_events ADD COLUMN dispatched_at TEXT");
    addEventColumn("started_at","ALTER TABLE automation_events ADD COLUMN started_at TEXT");
    addEventColumn("completed_at","ALTER TABLE automation_events ADD COLUMN completed_at TEXT");
    db.exec("UPDATE automation_events SET updated_at=COALESCE(updated_at,created_at)");
    const receiptColumns=db.prepare("PRAGMA table_info(workflow_receipts)").all() as Array<{name:string}>;
    if(!receiptColumns.some((column)=>column.name==="receipt_key")){
      db.exec("ALTER TABLE workflow_receipts ADD COLUMN receipt_key TEXT");
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS workflow_receipts_receipt_key ON workflow_receipts(receipt_key) WHERE receipt_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS automation_events_creator_status ON automation_events(creator_id,status,created_at DESC);
      CREATE INDEX IF NOT EXISTS workflow_receipts_creator_created ON workflow_receipts(creator_id,created_at DESC);
    `);
    db.prepare("INSERT INTO schema_migrations (version) VALUES ('036_automation_control_plane')").run();
  }
  const migration = db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)");
  ["001_initial", "002_agent_tasks", "003_multi_asset_people", "004_voice_research", "005_multi_creator", "006_creator_agent_tasks", "007_platform_connections", "008_connection_health", "009_publication_jobs", "010_analytics_imports", "011_reddit_operations", "012_creator_login_profiles", "013_composio_connections", "014_creator_service_connections", "015_telegram_creator_pairings", "016_telegram_handoffs", "017_composio_service_user_ids", "018_instagram_analytics", "019_performance_feedback_loop", "020_agency_telegram_bot", "021_asset_tags_and_history", "022_local_platform_bridge", "023_unified_messaging", "024_local_message_collector", "025_local_bridge_outbound", "026_background_thread_sync", "027_canonical_message_thread_ids", "028_vault_upload_jobs", "029_vault_staged_status", "030_bridge_safety_and_vault_deduplication", "031_currency_safe_earnings_and_import_deduplication", "032_asset_source_availability", "033_telegram_creator_messages", "034_asset_classification_workflow", "035_reddit_target_content_rating", "036_automation_control_plane"].forEach((version) => migration.run(version));
}

function seedAccounts(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO accounts (
      id, creator_id, label, platform, handle, url, category, publishing_mode, connection_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label=excluded.label, handle=excluded.handle, url=excluded.url,
      category=excluded.category, publishing_mode=excluded.publishing_mode
  `);
  for (const account of thrillNoirPilot.accounts) {
    insert.run(
      account.id,
      account.creatorId,
      account.label,
      account.platform,
      account.handle,
      account.url,
      account.category,
      account.publishingMode,
      account.connectionStatus,
    );
  }
}

type LibraryIndex = {
  version?: number;
  indexedAt: string;
  creatorId?: string;
  assets?: Array<{
    id: string;
    relativePath: string;
    basename: string;
    extension: string;
    bytes: number;
    modifiedAt: string;
    filenameClass: string;
    repeatedBasename: boolean;
  }>;
  creators?: Array<{
    creatorId: string;
    assets: NonNullable<LibraryIndex["assets"]>;
  }>;
};

function syncIndexedAssets(db: Database.Database) {
  if (!existsSync(libraryIndexPath)) return;
  const index = JSON.parse(readFileSync(libraryIndexPath, "utf8")) as LibraryIndex;
  const insert = db.prepare(`
    INSERT INTO assets (
      id, creator_id, relative_path, basename, extension, bytes, modified_at,
      filename_class, repeated_basename, source_available, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      creator_id=excluded.creator_id, relative_path=excluded.relative_path, basename=excluded.basename,
      bytes=excluded.bytes, modified_at=excluded.modified_at,
      filename_class=excluded.filename_class,
      repeated_basename=excluded.repeated_basename, source_available=1, indexed_at=excluded.indexed_at
  `);
  const creatorIndexes = index.creators ?? [{ creatorId: index.creatorId ?? "thrill-noir", assets: index.assets ?? [] }];
  db.exec("BEGIN");
  try {
    for (const creatorIndex of creatorIndexes) {
      db.prepare("UPDATE assets SET source_available=0 WHERE creator_id=?").run(creatorIndex.creatorId);
      for (const asset of creatorIndex.assets) {
        insert.run(
          asset.id,
          creatorIndex.creatorId,
          asset.relativePath,
          asset.basename,
          asset.extension,
          asset.bytes,
          asset.modifiedAt,
          asset.filenameClass,
          asset.repeatedBasename ? 1 : 0,
          index.indexedAt,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function refreshIndexedAssets() {
  syncIndexedAssets(openDatabase());
}

export type AccountRow = {
  id: string;
  label: string;
  platform: string;
  handle: string;
  url: string;
  category: string;
  publishing_mode: string;
  connection_status: string;
  last_published_at: string | null;
};

export type CreatorRow = {
  id: string;
  name: string;
  slug: string;
  initials: string;
  accent: string;
  status: string;
  media_source: string | null;
};

export function getCreators() {
  return openDatabase().prepare("SELECT id, name, slug, initials, accent, status, media_source FROM creators ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, name").all() as CreatorRow[];
}

export function getCreator(id: string) {
  return openDatabase().prepare("SELECT id, name, slug, initials, accent, status, media_source FROM creators WHERE id=?").get(id) as CreatorRow | undefined;
}

export function setCreatorMediaSource(creatorId: string, mediaSource: string) {
  const result = openDatabase().prepare("UPDATE creators SET media_source=? WHERE id=?").run(mediaSource, creatorId);
  if (result.changes !== 1) throw new Error("Creator workspace not found.");
}

export function createCreator(input: { name: string; accent: string }) {
  const slug = input.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Creator name must contain letters or numbers.");
  const db = openDatabase();
  if (db.prepare("SELECT 1 FROM creators WHERE id=? OR slug=?").get(slug, slug)) {
    throw new Error("A creator workspace with that name already exists.");
  }
  const initials = input.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  db.prepare(`
    INSERT INTO creators (id, name, slug, initials, accent, status)
    VALUES (?, ?, ?, ?, ?, 'setup')
  `).run(slug, input.name.trim(), slug, initials, input.accent);
  return slug;
}

export type AssetRow = {
  id: string;
  relative_path: string;
  basename: string;
  extension: string;
  bytes: number;
  modified_at: string;
  filename_class: string;
  repeated_basename: number;
  source_available: number;
  creator_notes: string;
  safety_level: string;
  workflow_status: string;
};

export const ASSET_TAGS = ["SFW", "TEASER", "NSFW", "IG", "TIK TOK", "REDDIT", "X", "PPV"] as const;
export type AssetTag = (typeof ASSET_TAGS)[number];

export const ASSET_DESTINATIONS = ["instagram","facebook","tiktok","threads","x","reddit","subscription","ppv"] as const;
export type AssetDestination = (typeof ASSET_DESTINATIONS)[number];
export type AssetSafety = "sfw" | "nsfw" | null;

export type AssetClassification = {
  asset_id:string;
  creator_id:string;
  safety:AssetSafety;
  is_teaser:number;
  is_multi:number;
  teaser_for_asset_id:string|null;
  notes:string;
  reviewed_by:string|null;
  reviewed_at:string|null;
  updated_at:string;
  destinations:AssetDestination[];
  person_ids:number[];
  attested_person_ids:number[];
  teaser_count:number;
};

export type LibraryAssetRow = AssetRow & {
  tags: string;
  share_counts: string;
  classification_safety: AssetSafety;
  is_teaser:number;
  is_multi:number;
  teaser_count:number;
  destinations:string;
  people_count:number;
  classification_notes:string;
  teaser_for_asset_id:string|null;
  person_ids:string;
};

export function getLibraryAssets(input: { creatorId: string; query?: string; mediaType?: "all" | "photos" | "videos"; tag?: string; safety?:string; destination?:string; trait?:string; usage?:string; limit?: number }) {
  const clauses = ["a.creator_id=?","a.source_available=1"];
  const values: Array<string | number> = [input.creatorId];
  if (input.query) {
    clauses.push("(a.basename LIKE ? OR a.relative_path LIKE ?)");
    values.push(`%${input.query}%`, `%${input.query}%`);
  }
  if (input.mediaType === "photos") clauses.push("a.extension IN ('jpg','jpeg','png','webp','heic')");
  if (input.mediaType === "videos") clauses.push("a.extension IN ('mov','mp4')");
  if (input.tag && ASSET_TAGS.includes(input.tag as AssetTag)) {
    clauses.push("EXISTS (SELECT 1 FROM asset_tags wanted WHERE wanted.asset_id=a.id AND wanted.tag=?)");
    values.push(input.tag);
  }
  if(input.safety==="needs_review") clauses.push("c.safety IS NULL");
  if(input.safety==="sfw"||input.safety==="nsfw") { clauses.push("c.safety=?"); values.push(input.safety); }
  if(input.destination&&ASSET_DESTINATIONS.includes(input.destination as AssetDestination)){
    clauses.push("EXISTS (SELECT 1 FROM asset_destinations wanted_destination WHERE wanted_destination.asset_id=a.id AND wanted_destination.destination=?)");
    values.push(input.destination);
  }
  if(input.trait==="has_teaser") clauses.push("EXISTS (SELECT 1 FROM asset_classifications teaser WHERE teaser.teaser_for_asset_id=a.id)");
  if(input.trait==="is_teaser") clauses.push("c.is_teaser=1");
  if(input.trait==="multi") clauses.push("c.is_multi=1");
  if(input.usage==="unused") clauses.push("NOT EXISTS (SELECT 1 FROM post_package_assets used WHERE used.asset_id=a.id)");
  if(input.usage==="used") clauses.push("EXISTS (SELECT 1 FROM post_package_assets used WHERE used.asset_id=a.id)");
  values.push(input.limit ?? 120);
  return openDatabase().prepare(`
    SELECT a.*,
      c.safety AS classification_safety,COALESCE(c.is_teaser,0) AS is_teaser,COALESCE(c.is_multi,0) AS is_multi,
      COALESCE(c.notes,'') AS classification_notes,c.teaser_for_asset_id,
      (SELECT COUNT(*) FROM asset_classifications teaser WHERE teaser.teaser_for_asset_id=a.id) AS teaser_count,
      COALESCE((SELECT GROUP_CONCAT(d.destination, '|') FROM asset_destinations d WHERE d.asset_id=a.id), '') AS destinations,
      (SELECT COUNT(*) FROM asset_people ap WHERE ap.asset_id=a.id) AS people_count,
      COALESCE((SELECT GROUP_CONCAT(ap.person_id, '|') FROM asset_people ap WHERE ap.asset_id=a.id), '') AS person_ids,
      COALESCE((SELECT GROUP_CONCAT(t.tag, '|') FROM asset_tags t WHERE t.asset_id=a.id), '') AS tags,
      COALESCE((SELECT GROUP_CONCAT(platform || ':' || uses, '|') FROM (
        SELECT ac.platform, COUNT(DISTINCT p.id) AS uses
        FROM post_package_assets pa JOIN post_packages p ON p.id=pa.post_package_id
        JOIN accounts ac ON ac.id=p.account_id
        WHERE pa.asset_id=a.id AND p.status='published' GROUP BY ac.platform
      )), '') AS share_counts
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id WHERE ${clauses.join(" AND ")}
    ORDER BY a.modified_at DESC LIMIT ?
  `).all(...values) as LibraryAssetRow[];
}

export function getLibraryAsset(creatorId: string, assetId: string) {
  return openDatabase().prepare("SELECT * FROM assets WHERE id=? AND creator_id=?").get(assetId, creatorId) as AssetRow | undefined;
}

export function getAssetTags(creatorId: string, assetId: string) {
  if (!getLibraryAsset(creatorId, assetId)) return [];
  return openDatabase().prepare("SELECT tag FROM asset_tags WHERE asset_id=? ORDER BY tag").all(assetId).map((row) => (row as { tag: string }).tag);
}

export function getAssetClassification(creatorId:string,assetId:string):AssetClassification|undefined{
  if(!getLibraryAsset(creatorId,assetId))return undefined;
  const db=openDatabase();
  const row=db.prepare("SELECT * FROM asset_classifications WHERE asset_id=? AND creator_id=?").get(assetId,creatorId) as Omit<AssetClassification,"destinations"|"person_ids"|"attested_person_ids"|"teaser_count">|undefined;
  const base=row??{asset_id:assetId,creator_id:creatorId,safety:null,is_teaser:0,is_multi:0,teaser_for_asset_id:null,notes:"",reviewed_by:null,reviewed_at:null,updated_at:""};
  return {
    ...base,
    destinations:(db.prepare("SELECT destination FROM asset_destinations WHERE asset_id=? AND creator_id=? ORDER BY destination").all(assetId,creatorId) as Array<{destination:AssetDestination}>).map((item)=>item.destination),
    person_ids:(db.prepare("SELECT person_id FROM asset_people WHERE asset_id=? AND creator_id=? ORDER BY person_id").all(assetId,creatorId) as Array<{person_id:number}>).map((item)=>item.person_id),
    attested_person_ids:(db.prepare("SELECT person_id FROM asset_paid_consent_attestations WHERE asset_id=? AND creator_id=? AND revoked_at IS NULL ORDER BY person_id").all(assetId,creatorId) as Array<{person_id:number}>).map((item)=>item.person_id),
    teaser_count:(db.prepare("SELECT COUNT(*) AS count FROM asset_classifications WHERE creator_id=? AND teaser_for_asset_id=?").get(creatorId,assetId) as {count:number}).count,
  };
}

function validateAssetClassification(input:{safety:AssetSafety;destinations:AssetDestination[];isTeaser:boolean;teaserForAssetId?:string|null;isMulti:boolean;personIds:number[]}){
  const destinations=[...new Set(input.destinations)];
  if(destinations.some((item)=>!ASSET_DESTINATIONS.includes(item)))throw new Error("Choose valid content destinations.");
  if(!input.safety&&destinations.length)throw new Error("Choose SFW or NSFW before adding destinations.");
  const nsfwAllowed=new Set<AssetDestination>(["x","reddit","subscription","ppv"]);
  if(input.safety==="nsfw"&&destinations.some((item)=>!nsfwAllowed.has(item)))throw new Error("NSFW assets can only be marked for X, Reddit, Subscription or PPV.");
  if(!input.isTeaser&&input.teaserForAssetId)throw new Error("Only a teaser can be linked to a main asset.");
  if(!input.isMulti&&input.personIds.length)throw new Error("Turn on Multi before attaching creator friends.");
  return destinations;
}

export function saveAssetClassification(input:{creatorId:string;assetId:string;safety:AssetSafety;destinations:AssetDestination[];isTeaser:boolean;isMulti:boolean;teaserForAssetId?:string|null;notes:string;personIds:number[];actor:string}){
  const db=openDatabase();
  if(!getLibraryAsset(input.creatorId,input.assetId))throw new Error("Asset not found in the active creator workspace.");
  const destinations=validateAssetClassification(input);
  const personIds=[...new Set(input.personIds.filter(Number.isInteger))];
  if(personIds.length){
    const placeholders=personIds.map(()=>"?").join(",");
    const owned=(db.prepare(`SELECT COUNT(*) AS count FROM people WHERE creator_id=? AND id IN (${placeholders})`).get(input.creatorId,...personIds) as {count:number}).count;
    if(owned!==personIds.length)throw new Error("One or more creator friends are outside this workspace.");
  }
  if(input.teaserForAssetId){
    if(input.teaserForAssetId===input.assetId)throw new Error("A teaser cannot link to itself.");
    if(!getLibraryAsset(input.creatorId,input.teaserForAssetId))throw new Error("The linked main asset is outside this workspace.");
  }
  const snapshot=JSON.stringify({safety:input.safety,destinations,isTeaser:input.isTeaser,isMulti:input.isMulti,teaserForAssetId:input.teaserForAssetId||null,notes:input.notes.trim(),personIds});
  db.exec("BEGIN");
  try{
    db.prepare(`INSERT INTO asset_classifications (asset_id,creator_id,safety,is_teaser,is_multi,teaser_for_asset_id,notes,reviewed_by,reviewed_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(asset_id) DO UPDATE SET safety=excluded.safety,is_teaser=excluded.is_teaser,is_multi=excluded.is_multi,
        teaser_for_asset_id=excluded.teaser_for_asset_id,notes=excluded.notes,reviewed_by=excluded.reviewed_by,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .run(input.assetId,input.creatorId,input.safety,input.isTeaser?1:0,input.isMulti?1:0,input.teaserForAssetId||null,input.notes.trim(),input.actor);
    db.prepare("DELETE FROM asset_destinations WHERE asset_id=? AND creator_id=?").run(input.assetId,input.creatorId);
    const insertDestination=db.prepare("INSERT INTO asset_destinations (asset_id,creator_id,destination) VALUES (?,?,?)");
    destinations.forEach((destination)=>insertDestination.run(input.assetId,input.creatorId,destination));
    db.prepare("DELETE FROM asset_people WHERE asset_id=? AND creator_id=?").run(input.assetId,input.creatorId);
    const insertPerson=db.prepare("INSERT INTO asset_people (asset_id,creator_id,person_id) VALUES (?,?,?)");
    if(input.isMulti)personIds.forEach((personId)=>insertPerson.run(input.assetId,input.creatorId,personId));
    db.prepare("DELETE FROM asset_paid_consent_attestations WHERE asset_id=? AND creator_id=? AND person_id NOT IN (SELECT person_id FROM asset_people WHERE asset_id=?)").run(input.assetId,input.creatorId,input.assetId);
    db.prepare("INSERT INTO asset_classification_events (asset_id,creator_id,actor,event_type,snapshot) VALUES (?,?,?,'saved',?)").run(input.assetId,input.creatorId,input.actor,snapshot);
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function copyAssetClassification(input:{creatorId:string;sourceAssetId:string;targetAssetIds:string[];fields:string[];actor:string}){
  const source=getAssetClassification(input.creatorId,input.sourceAssetId);
  if(!source)throw new Error("Source asset not found.");
  const targets=[...new Set(input.targetAssetIds)].filter((id)=>id!==input.sourceAssetId).slice(0,120);
  if(!targets.length)throw new Error("Select at least one different asset to update.");
  const fields=new Set(input.fields);
  for(const targetId of targets){
    const current=getAssetClassification(input.creatorId,targetId);
    if(!current)throw new Error("One or more selected assets are outside this workspace.");
    const safety=fields.has("safety")?source.safety:current.safety;
    let destinations=fields.has("destinations")?source.destinations:current.destinations;
    if(!safety)destinations=[];
    if(safety==="nsfw")destinations=destinations.filter((item)=>["x","reddit","subscription","ppv"].includes(item));
    saveAssetClassification({creatorId:input.creatorId,assetId:targetId,safety,destinations,
      isTeaser:fields.has("teaser")?source.is_teaser===1:current.is_teaser===1,
      teaserForAssetId:fields.has("teaser")?source.teaser_for_asset_id:current.teaser_for_asset_id,
      isMulti:fields.has("people")?source.is_multi===1:current.is_multi===1,
      personIds:fields.has("people")?source.person_ids:current.person_ids,
      notes:fields.has("notes")?source.notes:current.notes,actor:input.actor});
  }
  return targets.length;
}

export function recordPaidUseAttestations(input:{creatorId:string;assetIds:string[];evidencePlatform:"onlyfans"|"fansly";confirmedBy:string;note?:string}){
  const db=openDatabase();
  const assetIds=[...new Set(input.assetIds)];
  if(!assetIds.length)return 0;
  const owned=(db.prepare(`SELECT COUNT(*) AS count FROM assets WHERE creator_id=? AND id IN (${assetIds.map(()=>"?").join(",")})`).get(input.creatorId,...assetIds) as {count:number}).count;
  if(owned!==assetIds.length)throw new Error("One or more assets are outside this workspace.");
  const rows=db.prepare(`SELECT ap.asset_id,ap.person_id FROM asset_people ap WHERE ap.creator_id=? AND ap.asset_id IN (${assetIds.map(()=>"?").join(",")})`).all(input.creatorId,...assetIds) as Array<{asset_id:string;person_id:number}>;
  const upsert=db.prepare(`INSERT INTO asset_paid_consent_attestations (asset_id,creator_id,person_id,evidence_platform,confirmed_by,note,revoked_at)
    VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(asset_id,person_id) DO UPDATE SET evidence_platform=excluded.evidence_platform,
      confirmed_by=excluded.confirmed_by,confirmed_at=CURRENT_TIMESTAMP,note=excluded.note,revoked_at=NULL`);
  db.exec("BEGIN");
  try{rows.forEach((row)=>upsert.run(row.asset_id,input.creatorId,row.person_id,input.evidencePlatform,input.confirmedBy,input.note?.trim()||""));db.exec("COMMIT");}
  catch(error){db.exec("ROLLBACK");throw error;}
  return rows.length;
}

export function getMissingPaidUseConsent(creatorId:string,assetIds:string[]){
  if(!assetIds.length)return [];
  return openDatabase().prepare(`SELECT ap.asset_id,ap.person_id,COALESCE(p.stage_name,p.display_name) AS person_name
    FROM asset_people ap JOIN people p ON p.id=ap.person_id
    LEFT JOIN asset_paid_consent_attestations c ON c.asset_id=ap.asset_id AND c.person_id=ap.person_id AND c.revoked_at IS NULL
    WHERE ap.creator_id=? AND ap.asset_id IN (${assetIds.map(()=>"?").join(",")}) AND c.person_id IS NULL
    ORDER BY person_name`).all(creatorId,...assetIds) as Array<{asset_id:string;person_id:number;person_name:string}>;
}

export function setAssetTags(creatorId: string, assetId: string, tags: string[]) {
  const asset = getLibraryAsset(creatorId, assetId);
  if (!asset) throw new Error("Asset not found in the active creator workspace.");
  const valid = [...new Set(tags.filter((tag): tag is AssetTag => ASSET_TAGS.includes(tag as AssetTag)))];
  if (["SFW", "TEASER", "NSFW"].filter((tag) => valid.includes(tag as AssetTag)).length > 1) {
    throw new Error("Choose only one safety classification: SFW, TEASER or NSFW.");
  }
  const db = openDatabase();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM asset_tags WHERE asset_id=?").run(assetId);
    const insert = db.prepare("INSERT INTO asset_tags (asset_id,tag) VALUES (?,?)");
    for (const tag of valid) insert.run(assetId, tag);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setAssetTagsBulk(creatorId: string, updates: Array<{ assetId: string; tags: string[] }>) {
  const db = openDatabase();
  const uniqueUpdates = [...new Map(updates.map((item) => [item.assetId, item])).values()];
  const ownsAsset = db.prepare("SELECT 1 FROM assets WHERE id=? AND creator_id=?");
  const remove = db.prepare("DELETE FROM asset_tags WHERE asset_id=?");
  const insert = db.prepare("INSERT INTO asset_tags (asset_id,tag) VALUES (?,?)");
  const prepared = uniqueUpdates.map((item) => {
    if (!ownsAsset.get(item.assetId, creatorId)) throw new Error("One or more assets are outside the active creator workspace.");
    const tags = [...new Set(item.tags.filter((tag): tag is AssetTag => ASSET_TAGS.includes(tag as AssetTag)))];
    if (["SFW", "TEASER", "NSFW"].filter((tag) => tags.includes(tag as AssetTag)).length > 1) {
      throw new Error("Each asset can have only one safety classification.");
    }
    return { assetId: item.assetId, tags };
  });
  db.exec("BEGIN");
  try {
    for (const item of prepared) {
      remove.run(item.assetId);
      for (const tag of item.tags) insert.run(item.assetId, tag);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type AssetPublicationRow = {
  post_package_id: number; platform: string; account_label: string; handle: string; status: string;
  scheduled_at: string | null; published_at: string | null; caption: string; external_media_id: string | null;
  permalink: string | null; match_method: string | null;
};

export function getAssetPublicationHistory(creatorId: string, assetId: string) {
  if (!getLibraryAsset(creatorId, assetId)) return [];
  return openDatabase().prepare(`
    SELECT p.id AS post_package_id,ac.platform,ac.label AS account_label,ac.handle,p.status,
      p.scheduled_at,p.published_at,p.caption,m.external_media_id,m.permalink,m.match_method
    FROM post_package_assets pa JOIN post_packages p ON p.id=pa.post_package_id
    JOIN accounts ac ON ac.id=p.account_id
    LEFT JOIN post_publication_matches m ON m.creator_id=ac.creator_id AND m.post_package_id=p.id
    WHERE pa.asset_id=? AND ac.creator_id=?
    ORDER BY COALESCE(p.published_at,p.scheduled_at,p.created_at) DESC
  `).all(assetId, creatorId) as AssetPublicationRow[];
}

export function getAccounts(creatorId = "thrill-noir") {
  return openDatabase()
    .prepare("SELECT id, label, platform, handle, url, category, publishing_mode, connection_status, last_published_at FROM accounts WHERE creator_id=? ORDER BY category, platform")
    .all(creatorId) as AccountRow[];
}

export function createAccount(input: {
  creatorId: string;
  label: string;
  platform: string;
  handle: string;
  url: string;
  category: string;
  publishingMode: string;
}) {
  const db = openDatabase();
  if (!getCreator(input.creatorId)) throw new Error("Creator workspace not found.");
  const safeHandle = input.handle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
  let id = `${input.creatorId}-${input.platform}-${safeHandle}`;
  let suffix = 2;
  while (db.prepare("SELECT 1 FROM accounts WHERE id=?").get(id)) id = `${input.creatorId}-${input.platform}-${safeHandle}-${suffix++}`;
  db.prepare(`
    INSERT INTO accounts (id, creator_id, label, platform, handle, url, category, publishing_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.creatorId, input.label, input.platform, input.handle, input.url, input.category, input.publishingMode);
  db.prepare("UPDATE creators SET status='active' WHERE id=?").run(input.creatorId);
  return id;
}

export type PlatformConnectionRow = {
  id: number;
  creator_id: string;
  account_id: string;
  provider: string;
  status: string;
  external_account_id: string | null;
  external_username: string | null;
  scopes: string;
  token_expires_at: string | null;
  connected_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_error: string | null;
  health_status: string;
  last_refreshed_at: string | null;
  revoked_at: string | null;
  provider_metadata: string;
  identity_confirmed_at: string | null;
  publishing_authorized_at: string | null;
};

export function getPlatformConnections(creatorId: string) {
  return openDatabase().prepare(`
    SELECT id, creator_id, account_id, provider, status, external_account_id,
      external_username, scopes, token_expires_at, connected_at, updated_at,
      last_checked_at, last_error, health_status, last_refreshed_at, revoked_at,
      provider_metadata, identity_confirmed_at, publishing_authorized_at
    FROM platform_connections WHERE creator_id=? ORDER BY connected_at DESC
  `).all(creatorId) as PlatformConnectionRow[];
}

export type CreatorLoginProfileRow = {
  creator_id: string;
  google_email: string;
  chrome_profile_label: string;
  notes: string;
  updated_at: string;
};

export function getCreatorLoginProfile(creatorId: string) {
  return openDatabase().prepare(`
    SELECT creator_id, google_email, chrome_profile_label, notes, updated_at
    FROM creator_login_profiles WHERE creator_id=?
  `).get(creatorId) as CreatorLoginProfileRow | undefined;
}

export function saveCreatorLoginProfile(input: {
  creatorId: string;
  googleEmail: string;
  chromeProfileLabel: string;
  notes: string;
}) {
  if (!getCreator(input.creatorId)) throw new Error("Creator workspace not found.");
  openDatabase().prepare(`
    INSERT INTO creator_login_profiles (creator_id, google_email, chrome_profile_label, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(creator_id) DO UPDATE SET
      google_email=excluded.google_email,
      chrome_profile_label=excluded.chrome_profile_label,
      notes=excluded.notes,
      updated_at=CURRENT_TIMESTAMP
  `).run(input.creatorId, input.googleEmail, input.chromeProfileLabel, input.notes);
}

export type LocalBridgeConnectionRow = {
  id: number; creator_id: string; account_id: string; platform: "onlyfans" | "fansly"; browser: string;
  profile_directory: string; status: string; expected_username: string; observed_username: string;
  identity_confirmed_at: string | null; last_opened_at: string | null; last_checked_at: string | null;
  last_error: string | null; created_at: string; updated_at: string;
};

export function getLocalBridgeConnections(creatorId: string) {
  return openDatabase().prepare("SELECT * FROM local_bridge_connections WHERE creator_id=? ORDER BY platform, account_id")
    .all(creatorId) as LocalBridgeConnectionRow[];
}

export function prepareLocalBridgeConnection(input: { creatorId: string; accountId: string; platform: "onlyfans" | "fansly"; profileDirectory: string; expectedUsername: string }) {
  const db = openDatabase();
  const account = db.prepare("SELECT platform FROM accounts WHERE id=? AND creator_id=?").get(input.accountId, input.creatorId) as { platform: string } | undefined;
  if (!account || account.platform !== input.platform) throw new Error("Bridge account is outside the active creator workspace.");
  db.prepare(`
    INSERT INTO local_bridge_connections (creator_id,account_id,platform,profile_directory,status,expected_username,last_opened_at)
    VALUES (?,?,?,?, 'login_opened', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account_id) DO UPDATE SET profile_directory=excluded.profile_directory,
      status=CASE WHEN local_bridge_connections.identity_confirmed_at IS NULL THEN 'login_opened' ELSE local_bridge_connections.status END,
      expected_username=excluded.expected_username,last_opened_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
  `).run(input.creatorId, input.accountId, input.platform, input.profileDirectory, input.expectedUsername);
}

export function confirmLocalBridgeIdentity(input: { creatorId: string; accountId: string; observedUsername: string }) {
  const db = openDatabase();
  const bridge = db.prepare("SELECT expected_username FROM local_bridge_connections WHERE account_id=? AND creator_id=?")
    .get(input.accountId, input.creatorId) as { expected_username: string } | undefined;
  if (!bridge) throw new Error("Open the secure platform login before confirming the identity.");
  const normalise = (value: string) => value.trim().toLowerCase().replace(/^@/, "");
  if (!input.observedUsername || normalise(input.observedUsername) !== normalise(bridge.expected_username)) {
    throw new Error("The signed-in username does not match the account configured for this creator.");
  }
  db.prepare(`UPDATE local_bridge_connections SET observed_username=?,status='ready_for_private_validation',
    identity_confirmed_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE account_id=? AND creator_id=?`).run(input.observedUsername.trim(), input.accountId, input.creatorId);
}

export type ComposioLinkRequestRow = {
  id: number;
  creator_id: string;
  account_id: string;
  toolkit: string;
  provider: string;
  connected_account_id: string;
  expected_username: string;
  discovered_account_id: string | null;
  discovered_username: string | null;
  discovered_name: string | null;
  discovered_profile_image: string | null;
  status: string;
  error: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export function createComposioLinkRequest(input: {
  creatorId: string;
  accountId: string;
  toolkit: string;
  provider: string;
  connectedAccountId: string;
  expectedUsername: string;
  expiresAt: string | null;
}) {
  const account = openDatabase().prepare("SELECT creator_id FROM accounts WHERE id=?").get(input.accountId) as { creator_id: string } | undefined;
  if (!account || account.creator_id !== input.creatorId) throw new Error("Destination is outside the creator workspace.");
  openDatabase().prepare(`
    INSERT INTO composio_link_requests (
      creator_id, account_id, toolkit, provider, connected_account_id,
      expected_username, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.creatorId, input.accountId, input.toolkit, input.provider, input.connectedAccountId, input.expectedUsername, input.expiresAt);
}

export function getComposioLinkRequest(connectedAccountId: string) {
  return openDatabase().prepare(`
    SELECT * FROM composio_link_requests WHERE connected_account_id=?
  `).get(connectedAccountId) as ComposioLinkRequestRow | undefined;
}

export function getPendingComposioLinkRequest(creatorId: string, accountId: string) {
  return openDatabase().prepare(`
    SELECT * FROM composio_link_requests
    WHERE creator_id=? AND account_id=? AND status='awaiting_authorization'
    ORDER BY id DESC LIMIT 1
  `).get(creatorId, accountId) as ComposioLinkRequestRow | undefined;
}

export function getLatestComposioLinkRequests(creatorId: string) {
  return openDatabase().prepare(`
    SELECT r.* FROM composio_link_requests r
    JOIN (
      SELECT account_id, MAX(id) AS max_id FROM composio_link_requests
      WHERE creator_id=? GROUP BY account_id
    ) latest ON latest.max_id=r.id
    ORDER BY r.created_at DESC
  `).all(creatorId) as ComposioLinkRequestRow[];
}

export type CreatorServiceConnectionRow = {
  id: number;
  creator_id: string;
  service: string;
  status: string;
  connected_account_id: string;
  composio_user_id: string;
  external_account_id: string | null;
  display_name: string;
  email: string;
  identity_confirmed_at: string | null;
  connected_at: string;
  updated_at: string;
};

export type ComposioServiceLinkRequestRow = {
  id: number;
  creator_id: string;
  service: string;
  connected_account_id: string;
  discovered_account_id: string | null;
  discovered_name: string | null;
  discovered_email: string | null;
  status: string;
  error: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export function getCreatorServiceConnections(creatorId: string) {
  return openDatabase().prepare("SELECT * FROM creator_service_connections WHERE creator_id=? ORDER BY service")
    .all(creatorId) as CreatorServiceConnectionRow[];
}

export type AgencyIntegrationRow = {
  id: number;
  service: string;
  status: string;
  connected_account_id: string;
  composio_user_id: string;
  external_account_id: string | null;
  display_name: string;
  identity_confirmed_at: string | null;
  source_service_connection_id: number | null;
};

export function getAgencyIntegration(service: string) {
  return openDatabase().prepare("SELECT * FROM agency_integrations WHERE service=? AND status='connected'")
    .get(service) as AgencyIntegrationRow | undefined;
}

export type TelegramPairingInviteRow = {
  id: number;
  creator_id: string;
  token: string;
  status: string;
  candidate_chat_id: string | null;
  candidate_user_id: string | null;
  candidate_username: string;
  candidate_display_name: string;
  candidate_update_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export function createTelegramPairingInvite(creatorId: string, token: string, expiresAt: string) {
  const db = openDatabase();
  if (!getAgencyIntegration("telegram")) throw new Error("Connect the agency Telegram bot first.");
  db.prepare("UPDATE telegram_pairing_invites SET status='replaced',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND status IN ('waiting','awaiting_confirmation')").run(creatorId);
  db.prepare("INSERT INTO telegram_pairing_invites (creator_id,token,expires_at) VALUES (?,?,?)").run(creatorId, token, expiresAt);
  return getActiveTelegramPairingInvite(creatorId);
}

export function getActiveTelegramPairingInvite(creatorId: string) {
  return openDatabase().prepare(`
    SELECT * FROM telegram_pairing_invites
    WHERE creator_id=? AND status IN ('waiting','awaiting_confirmation') AND expires_at > CURRENT_TIMESTAMP
    ORDER BY id DESC LIMIT 1
  `).get(creatorId) as TelegramPairingInviteRow | undefined;
}

export function recordTelegramPairingCandidate(input: { creatorId: string; inviteId: number; chatId: string; userId: string; username: string; displayName: string; updateId: string }) {
  const result = openDatabase().prepare(`
    UPDATE telegram_pairing_invites SET status='awaiting_confirmation',candidate_chat_id=?,candidate_user_id=?,
      candidate_username=?,candidate_display_name=?,candidate_update_id=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='waiting' AND expires_at > CURRENT_TIMESTAMP
  `).run(input.chatId,input.userId,input.username,input.displayName,input.updateId,input.inviteId,input.creatorId);
  if (result.changes !== 1) throw new Error("This Telegram pairing link has expired or was already used.");
}

export type TelegramCreatorPairingRow = {
  creator_id: string;
  service_connection_id: number;
  agency_integration_id: number | null;
  chat_id: string;
  telegram_user_id: string;
  telegram_username: string;
  display_name: string;
  status: string;
  last_update_id: string | null;
  paired_at: string;
  updated_at: string;
};

export function getTelegramCreatorPairing(creatorId: string) {
  return openDatabase().prepare("SELECT * FROM telegram_creator_pairings WHERE creator_id=? AND status='paired'")
    .get(creatorId) as TelegramCreatorPairingRow | undefined;
}

export function pairCreatorTelegram(input: {
  creatorId: string;
  chatId: string;
  telegramUserId: string;
  telegramUsername: string;
  displayName: string;
  lastUpdateId: string;
}) {
  const db = openDatabase();
  const agency = getAgencyIntegration("telegram");
  if (!agency?.source_service_connection_id) throw new Error("Connect the agency Telegram bot before pairing a chat.");
  const existingChat = db.prepare("SELECT creator_id FROM telegram_creator_pairings WHERE chat_id=? AND creator_id<>?").get(input.chatId,input.creatorId) as {creator_id:string}|undefined;
  if (existingChat) throw new Error("This Telegram chat is already paired with another creator.");
  db.prepare(`
    INSERT INTO telegram_creator_pairings
      (creator_id, service_connection_id, agency_integration_id, chat_id, telegram_user_id, telegram_username, display_name, status, last_update_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'paired', ?)
    ON CONFLICT(creator_id) DO UPDATE SET service_connection_id=excluded.service_connection_id,agency_integration_id=excluded.agency_integration_id,
      chat_id=excluded.chat_id, telegram_user_id=excluded.telegram_user_id,
      telegram_username=excluded.telegram_username, display_name=excluded.display_name,
      status='paired', last_update_id=excluded.last_update_id, paired_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
  `).run(input.creatorId,agency.source_service_connection_id,agency.id,input.chatId,input.telegramUserId,input.telegramUsername,input.displayName,input.lastUpdateId);
}

export function confirmTelegramPairingCandidate(creatorId: string, inviteId: number) {
  const db=openDatabase();
  const invite=db.prepare("SELECT * FROM telegram_pairing_invites WHERE id=? AND creator_id=? AND status='awaiting_confirmation' AND expires_at > CURRENT_TIMESTAMP")
    .get(inviteId,creatorId) as TelegramPairingInviteRow|undefined;
  if(!invite?.candidate_chat_id||!invite.candidate_user_id) throw new Error("No verified Telegram candidate is waiting for confirmation.");
  pairCreatorTelegram({creatorId,chatId:invite.candidate_chat_id,telegramUserId:invite.candidate_user_id,telegramUsername:invite.candidate_username,displayName:invite.candidate_display_name,lastUpdateId:invite.candidate_update_id||""});
  db.prepare("UPDATE telegram_pairing_invites SET status='used',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").run(inviteId,creatorId);
}

export function revokeCreatorTelegramPairing(creatorId:string){
  openDatabase().prepare("UPDATE telegram_creator_pairings SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").run(creatorId);
}

export type TelegramHandoffRow = {
  id: number; creator_id: string; post_package_id: number; chat_id: string; status: string;
  asset_count: number; sent_asset_count: number; message_ids: string; error: string | null;
  created_at: string; completed_at: string | null;
};

export function getLatestTelegramHandoff(creatorId: string, postPackageId: number) {
  return openDatabase().prepare("SELECT * FROM telegram_handoffs WHERE creator_id=? AND post_package_id=? ORDER BY id DESC LIMIT 1")
    .get(creatorId, postPackageId) as TelegramHandoffRow | undefined;
}

export function createTelegramHandoff(input: { creatorId: string; postPackageId: number; chatId: string; assetCount: number }) {
  const result = openDatabase().prepare("INSERT INTO telegram_handoffs (creator_id, post_package_id, chat_id, asset_count) VALUES (?, ?, ?, ?)")
    .run(input.creatorId, input.postPackageId, input.chatId, input.assetCount);
  return Number(result.lastInsertRowid);
}

export function completeTelegramHandoff(input: { id: number; creatorId: string; messageIds: string[]; sentAssetCount: number }) {
  openDatabase().prepare("UPDATE telegram_handoffs SET status='sent', sent_asset_count=?, message_ids=?, error=NULL, completed_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
    .run(input.sentAssetCount, JSON.stringify(input.messageIds), input.id, input.creatorId);
  openDatabase().prepare("INSERT INTO publication_events (post_package_id, event_type, detail) SELECT post_package_id, 'telegram_handoff_sent', ? FROM telegram_handoffs WHERE id=? AND creator_id=?")
    .run(JSON.stringify({ handoffId: input.id, sentAssetCount: input.sentAssetCount }), input.id, input.creatorId);
}

export function failTelegramHandoff(input: { id: number; creatorId: string; messageIds: string[]; sentAssetCount: number; error: string }) {
  openDatabase().prepare("UPDATE telegram_handoffs SET status='failed', sent_asset_count=?, message_ids=?, error=?, completed_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
    .run(input.sentAssetCount, JSON.stringify(input.messageIds), input.error.slice(0, 1000), input.id, input.creatorId);
}

export function createTelegramCreatorMessage(input: { creatorId: string; chatId: string; messageText: string }) {
  const result = openDatabase().prepare("INSERT INTO telegram_creator_messages (creator_id,chat_id,message_text) VALUES (?,?,?)")
    .run(input.creatorId, input.chatId, input.messageText);
  return Number(result.lastInsertRowid);
}

export function completeTelegramCreatorMessage(input: { id: number; creatorId: string; telegramMessageId: string }) {
  openDatabase().prepare("UPDATE telegram_creator_messages SET status='sent',telegram_message_id=?,error=NULL,completed_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
    .run(input.telegramMessageId, input.id, input.creatorId);
}

export function failTelegramCreatorMessage(input: { id: number; creatorId: string; error: string }) {
  openDatabase().prepare("UPDATE telegram_creator_messages SET status='failed',error=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
    .run(input.error.slice(0, 1000), input.id, input.creatorId);
}

export type TelegramSendLogRow = {
  id: string;
  kind: "message" | "post_handoff" | "reminder";
  title: string;
  content: string;
  status: string;
  occurred_at: string;
  error: string | null;
};

export function getTelegramSendLog(creatorId: string, limit = 20) {
  const db = openDatabase();
  const messages = (db.prepare("SELECT * FROM telegram_creator_messages WHERE creator_id=? ORDER BY id DESC LIMIT ?").all(creatorId, limit) as Array<{id:number;message_text:string;status:string;created_at:string;completed_at:string|null;error:string|null}>).map((row): TelegramSendLogRow => ({
    id: `message-${row.id}`, kind: "message", title: "Agency message", content: row.message_text,
    status: row.status, occurred_at: row.completed_at || row.created_at, error: row.error,
  }));
  const handoffs = (db.prepare(`SELECT h.*,p.caption,a.label AS account_label,
    (SELECT GROUP_CONCAT(x.basename, ' · ') FROM post_package_assets pa JOIN assets x ON x.id=pa.asset_id WHERE pa.post_package_id=h.post_package_id) AS asset_names
    FROM telegram_handoffs h JOIN post_packages p ON p.id=h.post_package_id JOIN accounts a ON a.id=p.account_id
    WHERE h.creator_id=? ORDER BY h.id DESC LIMIT ?`).all(creatorId, limit) as Array<{id:number;post_package_id:number;caption:string;account_label:string;asset_names:string|null;status:string;created_at:string;completed_at:string|null;error:string|null}>).map((row): TelegramSendLogRow => ({
      id: `handoff-${row.id}`, kind: "post_handoff", title: `Post handoff #${row.post_package_id} · ${row.account_label}`,
      content: [row.asset_names || "Media", row.caption || "No caption supplied."].join("\n\n"), status: row.status,
      occurred_at: row.completed_at || row.created_at, error: row.error,
    }));
  const reminders = (db.prepare(`SELECT r.*,a.label AS account_label FROM creator_reminders r JOIN post_packages p ON p.id=r.post_package_id
    JOIN accounts a ON a.id=p.account_id WHERE r.creator_id=? AND r.status IN ('sent','failed') ORDER BY r.id DESC LIMIT ?`).all(creatorId, limit) as Array<{id:number;message:string;account_label:string;status:string;updated_at:string;sent_at:string|null;error:string|null}>).map((row): TelegramSendLogRow => ({
      id: `reminder-${row.id}`, kind: "reminder", title: `Posting reminder · ${row.account_label}`, content: row.message,
      status: row.status, occurred_at: row.sent_at || row.updated_at, error: row.error,
    }));
  return [...messages, ...handoffs, ...reminders]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, limit);
}

export function getLatestServiceLinkRequests(creatorId: string) {
  return openDatabase().prepare(`
    SELECT r.* FROM composio_service_link_requests r
    JOIN (SELECT service, MAX(id) max_id FROM composio_service_link_requests WHERE creator_id=? GROUP BY service) latest ON latest.max_id=r.id
    WHERE r.creator_id=? ORDER BY r.service
  `).all(creatorId, creatorId) as ComposioServiceLinkRequestRow[];
}

export function createServiceLinkRequest(input: { creatorId: string; service: string; connectedAccountId: string; expiresAt?: string | null }) {
  openDatabase().prepare(`
    INSERT INTO composio_service_link_requests (creator_id, service, connected_account_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(input.creatorId, input.service, input.connectedAccountId, input.expiresAt ?? null);
}

export function getPendingServiceLinkRequest(creatorId: string, service: string) {
  return openDatabase().prepare(`
    SELECT * FROM composio_service_link_requests WHERE creator_id=? AND service=? AND status='awaiting_authorization'
    ORDER BY id DESC LIMIT 1
  `).get(creatorId, service) as ComposioServiceLinkRequestRow | undefined;
}

export function recordServiceIdentity(input: { connectedAccountId: string; externalAccountId: string; displayName: string; email: string }) {
  const result = openDatabase().prepare(`
    UPDATE composio_service_link_requests SET status='awaiting_identity_confirmation', discovered_account_id=?,
      discovered_name=?, discovered_email=?, error=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE connected_account_id=? AND status IN ('awaiting_authorization', 'failed')
  `).run(input.externalAccountId, input.displayName, input.email, input.connectedAccountId);
  if (result.changes !== 1) throw new Error("Pending service connection was not found.");
}

export function failServiceLinkRequest(connectedAccountId: string, error: string) {
  openDatabase().prepare(`UPDATE composio_service_link_requests SET status='failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE connected_account_id=?`)
    .run(error.slice(0, 1000), connectedAccountId);
}

export function confirmServiceIdentity(creatorId: string, requestId: number) {
  const db = openDatabase();
  const request = db.prepare(`SELECT * FROM composio_service_link_requests WHERE id=? AND creator_id=?`)
    .get(requestId, creatorId) as ComposioServiceLinkRequestRow | undefined;
  if (!request || request.status !== "awaiting_identity_confirmation" || !request.discovered_account_id) throw new Error("Service identity is not ready for confirmation.");
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO creator_service_connections (creator_id, service, connected_account_id, composio_user_id, external_account_id, display_name, email, identity_confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id, service) DO UPDATE SET status='connected', connected_account_id=excluded.connected_account_id,
        composio_user_id=excluded.composio_user_id,
        external_account_id=excluded.external_account_id, display_name=excluded.display_name, email=excluded.email,
        identity_confirmed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    `).run(creatorId, request.service, request.connected_account_id, `creator-os:${creatorId}:service:${request.service}`, request.discovered_account_id, request.discovered_name ?? "", request.discovered_email ?? "");
    db.prepare("UPDATE composio_service_link_requests SET status='confirmed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(requestId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function disconnectCreatorService(creatorId: string, service: string) {
  openDatabase().prepare("DELETE FROM creator_service_connections WHERE creator_id=? AND service=?").run(creatorId, service);
}

export function recordComposioIdentity(input: {
  connectedAccountId: string;
  externalAccountId: string;
  externalUsername: string;
  externalName: string;
  profileImage: string;
}) {
  const result = openDatabase().prepare(`
    UPDATE composio_link_requests SET
      discovered_account_id=?, discovered_username=?, discovered_name=?,
      discovered_profile_image=?, status='awaiting_identity_confirmation',
      error=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE connected_account_id=?
  `).run(input.externalAccountId, input.externalUsername, input.externalName, input.profileImage, input.connectedAccountId);
  if (result.changes !== 1) throw new Error("Composio link request was not found.");
}

export function failComposioLinkRequest(connectedAccountId: string, error: string) {
  openDatabase().prepare(`
    UPDATE composio_link_requests SET status='failed', error=?, updated_at=CURRENT_TIMESTAMP
    WHERE connected_account_id=?
  `).run(error, connectedAccountId);
}

function normaliseSocialUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function confirmComposioIdentity(creatorId: string, requestId: number) {
  const db = openDatabase();
  const request = db.prepare(`SELECT * FROM composio_link_requests WHERE id=? AND creator_id=?`).get(requestId, creatorId) as ComposioLinkRequestRow | undefined;
  if (!request || request.status !== "awaiting_identity_confirmation" || !request.discovered_account_id || !request.discovered_username) {
    throw new Error("This identity is not ready for confirmation.");
  }
  if (normaliseSocialUsername(request.expected_username) !== normaliseSocialUsername(request.discovered_username)) {
    throw new Error(`Connected @${request.discovered_username}, but this destination expects ${request.expected_username}. Reconnect using the correct account.`);
  }
  savePlatformConnection({
    creatorId,
    accountId: request.account_id,
    provider: request.provider,
    externalAccountId: request.discovered_account_id,
    externalUsername: request.discovered_username,
    scopes: [],
    tokenCiphertext: "external-managed-by-composio",
    tokenExpiresAt: null,
    providerMetadata: {
      connectedAccountId: request.connected_account_id,
      toolkit: request.toolkit,
      credentialOwner: "composio",
    },
  });
  db.prepare(`
    UPDATE platform_connections SET identity_confirmed_at=CURRENT_TIMESTAMP,
      publishing_authorized_at=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE creator_id=? AND account_id=? AND provider=?
  `).run(creatorId, request.account_id, request.provider);
  db.prepare(`UPDATE composio_link_requests SET status='confirmed', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(requestId);
}

export function setConnectionPublishingAuthority(input: {
  creatorId: string;
  connectionId: number;
  allowed: boolean;
}) {
  const result = openDatabase().prepare(`
    UPDATE platform_connections SET
      publishing_authorized_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='connected' AND identity_confirmed_at IS NOT NULL
  `).run(input.allowed ? 1 : 0, input.connectionId, input.creatorId);
  if (result.changes !== 1) throw new Error("Connection is not verified for this creator.");
}

export function savePlatformConnection(input: {
  creatorId: string;
  accountId: string;
  provider: string;
  externalAccountId: string;
  externalUsername: string;
  scopes: string[];
  tokenCiphertext: string;
  tokenExpiresAt: string | null;
  refreshTokenCiphertext?: string | null;
  providerMetadata?: Record<string, unknown>;
  identityConfirmed?: boolean;
}) {
  const db = openDatabase();
  const account = db.prepare("SELECT creator_id FROM accounts WHERE id=?").get(input.accountId) as { creator_id: string } | undefined;
  if (!account || account.creator_id !== input.creatorId) throw new Error("Destination is outside the creator workspace.");
  db.prepare(`
    INSERT INTO platform_connections (
      creator_id, account_id, provider, status, external_account_id,
      external_username, scopes, token_ciphertext, token_expires_at,
      refresh_token_ciphertext, health_status, last_checked_at, provider_metadata, identity_confirmed_at
    ) VALUES (?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, 'healthy', CURRENT_TIMESTAMP, ?, CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END)
    ON CONFLICT(account_id, provider) DO UPDATE SET
      status='connected', external_account_id=excluded.external_account_id,
      external_username=excluded.external_username, scopes=excluded.scopes,
      token_ciphertext=excluded.token_ciphertext, token_expires_at=excluded.token_expires_at,
      refresh_token_ciphertext=COALESCE(excluded.refresh_token_ciphertext, platform_connections.refresh_token_ciphertext),
      health_status='healthy', last_checked_at=CURRENT_TIMESTAMP,
      provider_metadata=excluded.provider_metadata, revoked_at=NULL,
      identity_confirmed_at=COALESCE(excluded.identity_confirmed_at, platform_connections.identity_confirmed_at),
      updated_at=CURRENT_TIMESTAMP, last_error=NULL
  `).run(
    input.creatorId, input.accountId, input.provider, input.externalAccountId,
    input.externalUsername, input.scopes.join(" "), input.tokenCiphertext, input.tokenExpiresAt,
    input.refreshTokenCiphertext ?? null, JSON.stringify(input.providerMetadata ?? {}), input.identityConfirmed ? 1 : 0,
  );
  db.prepare("UPDATE accounts SET connection_status='connected', publishing_mode='direct_api' WHERE id=?").run(input.accountId);
}

export function getPlatformConnectionCredentials(creatorId: string, accountId: string, provider: string) {
  return openDatabase().prepare(`
    SELECT token_ciphertext, refresh_token_ciphertext, token_expires_at, scopes,
      external_account_id, external_username, provider_metadata
    FROM platform_connections
    WHERE creator_id=? AND account_id=? AND provider=? AND status='connected'
  `).get(creatorId, accountId, provider) as {
    token_ciphertext: string;
    refresh_token_ciphertext: string | null;
    token_expires_at: string | null;
    scopes: string;
    external_account_id: string | null;
    external_username: string | null;
    provider_metadata: string;
  } | undefined;
}

export function updatePlatformConnectionHealth(input: {
  creatorId: string;
  accountId: string;
  provider: string;
  healthStatus: string;
  error?: string | null;
  tokenCiphertext?: string;
  tokenExpiresAt?: string | null;
}) {
  openDatabase().prepare(`
    UPDATE platform_connections SET health_status=?, last_error=?,
      token_ciphertext=COALESCE(?, token_ciphertext),
      token_expires_at=COALESCE(?, token_expires_at),
      last_checked_at=CURRENT_TIMESTAMP,
      last_refreshed_at=CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE last_refreshed_at END,
      updated_at=CURRENT_TIMESTAMP
    WHERE creator_id=? AND account_id=? AND provider=?
  `).run(
    input.healthStatus, input.error ?? null, input.tokenCiphertext ?? null,
    input.tokenExpiresAt ?? null, input.tokenCiphertext ?? null,
    input.creatorId, input.accountId, input.provider,
  );
}

export type PublicationJobRow = {
  id: number;
  creator_id: string;
  post_package_id: number;
  account_id: string;
  provider: string;
  mode: string;
  status: string;
  idempotency_key: string;
  approved_at: string | null;
  attempts: number;
  external_post_id: string | null;
  receipt: string | null;
  error: string | null;
  created_at: string;
  account_label: string;
  platform: string;
  caption: string;
};

export function getPublicationJobs(creatorId: string) {
  return openDatabase().prepare(`
    SELECT j.*, a.label AS account_label, a.platform, p.caption
    FROM publication_jobs j
    JOIN accounts a ON a.id=j.account_id
    JOIN post_packages p ON p.id=j.post_package_id
    WHERE j.creator_id=? ORDER BY j.created_at DESC
  `).all(creatorId) as PublicationJobRow[];
}

export function createPublicationJob(input: {
  creatorId: string;
  postPackageId: number;
  mode: "test_private" | "live";
}) {
  const db = openDatabase();
  const post = getPostPackage(input.postPackageId);
  if (!post || post.creator_id !== input.creatorId) throw new Error("Post package is outside the creator workspace.");
  if (post.status !== "approved" || !post.approved_at) throw new Error("Only an approved package can enter API publishing.");
  const provider = post.platform === "instagram" ? "composio_instagram" : post.platform === "youtube" ? "google_youtube" : post.platform === "x" ? "xquik_x" : "";
  if (!provider) throw new Error("This destination has no API publishing adapter.");
  const connection = db.prepare(`
    SELECT 1 FROM platform_connections
    WHERE creator_id=? AND account_id=? AND provider=? AND status='connected'
      AND identity_confirmed_at IS NOT NULL AND publishing_authorized_at IS NOT NULL
  `).get(input.creatorId, post.account_id, provider);
  if (!connection) throw new Error("The destination must be verified and explicitly allowed for approved publishing.");
  const idempotencyKey = `${post.id}:${post.approved_at}:${provider}:${input.mode}`;
  const existing = db.prepare("SELECT id FROM publication_jobs WHERE idempotency_key=?").get(idempotencyKey) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db.prepare(`
    INSERT INTO publication_jobs (
      creator_id, post_package_id, account_id, provider, mode, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.creatorId, post.id, post.account_id, provider, input.mode, idempotencyKey);
  return Number(result.lastInsertRowid);
}

export function approvePublicationJob(creatorId: string, id: number) {
  const result = openDatabase().prepare(`
    UPDATE publication_jobs SET status='approved_for_execution', approved_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='awaiting_publish_approval'
  `).run(id, creatorId);
  if (result.changes !== 1) throw new Error("Publishing job is no longer awaiting approval.");
}

export function getPublicationJobForExecution(creatorId: string, id: number) {
  return openDatabase().prepare(`
    SELECT j.*, p.caption, p.status AS post_status, p.approved_at AS post_approved_at,
      a.platform, c.external_account_id, c.external_username, c.provider_metadata,
      c.identity_confirmed_at, c.publishing_authorized_at
    FROM publication_jobs j
    JOIN post_packages p ON p.id=j.post_package_id
    JOIN accounts a ON a.id=j.account_id
    JOIN platform_connections c ON c.creator_id=j.creator_id AND c.account_id=j.account_id AND c.provider=j.provider
    WHERE j.creator_id=? AND j.id=?
  `).get(creatorId, id) as (PublicationJobRow & {
    post_status: string;
    post_approved_at: string | null;
    external_account_id: string;
    external_username: string;
    provider_metadata: string;
    identity_confirmed_at: string | null;
    publishing_authorized_at: string | null;
  }) | undefined;
}

export function markPublicationJobExecuting(creatorId: string, id: number) {
  const result = openDatabase().prepare(`
    UPDATE publication_jobs SET status='executing', started_at=CURRENT_TIMESTAMP,
      attempts=attempts+1, error=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='approved_for_execution'
  `).run(id, creatorId);
  if (result.changes !== 1) throw new Error("Publishing job is not approved for execution.");
}

export function recordPublicationJobProgress(creatorId: string, id: number, receipt: Record<string, unknown>) {
  openDatabase().prepare(`UPDATE publication_jobs SET receipt=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='executing'`)
    .run(JSON.stringify(receipt), id, creatorId);
}

export function completePublicationJob(input: { creatorId: string; id: number; externalPostId: string; receipt: Record<string, unknown>; validationOnly: boolean }) {
  const db = openDatabase();
  const job = getPublicationJobForExecution(input.creatorId, input.id);
  if (!job) throw new Error("Publishing job not found.");
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE publication_jobs SET status=?, external_post_id=?, receipt=?, completed_at=CURRENT_TIMESTAMP,
        error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='executing'
    `).run(input.validationOnly ? "validated" : "published", input.externalPostId, JSON.stringify(input.receipt), input.id, input.creatorId);
    if (!input.validationOnly) {
      db.prepare("UPDATE post_packages SET status='published', published_at=CURRENT_TIMESTAMP WHERE id=?").run(job.post_package_id);
      db.prepare("UPDATE accounts SET last_published_at=CURRENT_TIMESTAMP WHERE id=?").run(job.account_id);
      db.prepare("INSERT INTO publication_events (post_package_id, event_type, detail) VALUES (?, 'api_published', ?)")
        .run(job.post_package_id, JSON.stringify({ provider: job.provider, externalPostId: input.externalPostId }));
      if (job.platform === "instagram") {
        db.prepare(`
          INSERT INTO post_publication_matches (creator_id,post_package_id,account_id,platform,external_media_id,match_method)
          VALUES (?, ?, ?, 'instagram', ?, 'api_receipt')
          ON CONFLICT(creator_id,post_package_id) DO UPDATE SET external_media_id=excluded.external_media_id,
            match_method='api_receipt',status='confirmed',matched_at=CURRENT_TIMESTAMP
        `).run(input.creatorId,job.post_package_id,job.account_id,input.externalPostId);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function failPublicationJob(creatorId: string, id: number, error: string) {
  openDatabase().prepare(`
    UPDATE publication_jobs SET status='failed', error=?, completed_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='executing'
  `).run(error.slice(0, 1000), id, creatorId);
}

export type AnalyticsMetricInput = {
  periodDate: string;
  accountHandle: string;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  followers: number | null;
  subscribers: number | null;
  revenue: number | null;
  currency: string;
};

export function importAnalyticsMetrics(input: {
  creatorId: string;
  platform: string;
  sourceName: string;
  contentHash: string;
  rows: AnalyticsMetricInput[];
}) {
  const db = openDatabase();
  if (!getCreator(input.creatorId)) throw new Error("Creator workspace not found.");
  const supportedPlatforms=new Set(["instagram","youtube","tiktok","x","reddit","onlyfans","fansly","myroomz","stripe"]);
  if(!supportedPlatforms.has(input.platform))throw new Error("Choose a supported analytics platform.");
  if(!/^[a-f0-9]{64}$/.test(input.contentHash))throw new Error("Analytics import fingerprint is invalid.");
  const existing=db.prepare("SELECT id FROM analytics_imports WHERE creator_id=? AND platform=? AND content_hash=?")
    .get(input.creatorId,input.platform,input.contentHash) as {id:number}|undefined;
  if(existing)return {id:existing.id,created:false};
  db.exec("BEGIN");
  try {
    const imported = db.prepare(`
      INSERT INTO analytics_imports (creator_id, platform, source_name, content_hash, row_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.creatorId, input.platform, input.sourceName, input.contentHash, input.rows.length);
    const importId = Number(imported.lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO analytics_metrics (
        import_id, creator_id, platform, period_date, account_handle,
        impressions, reach, views, followers, subscribers, revenue, currency, source_row
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of input.rows) {
      insert.run(
        importId, input.creatorId, input.platform, row.periodDate, row.accountHandle,
        row.impressions, row.reach, row.views, row.followers, row.subscribers,
        row.revenue, row.currency, JSON.stringify(row),
      );
    }
    db.exec("COMMIT");
    return {id:importId,created:true};
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getAnalyticsSummary(creatorId: string) {
  const db = openDatabase();
  const imports = db.prepare(`
    SELECT * FROM analytics_imports WHERE creator_id=? ORDER BY imported_at DESC LIMIT 20
  `).all(creatorId) as Array<{ id: number; platform: string; source_name: string; row_count: number; imported_at: string }>;
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(reach), 0) AS reach,
      COALESCE(SUM(views), 0) AS views,
      COALESCE(SUM(revenue), 0) AS revenue
    FROM analytics_metrics WHERE creator_id=?
  `).get(creatorId) as { impressions: number; reach: number; views: number; revenue: number };
  const byPlatform = db.prepare(`
    SELECT platform,currency,COUNT(*) AS rows,COALESCE(SUM(views),0) AS views,
      COALESCE(SUM(revenue),0) AS revenue,MAX(period_date) AS latest_date
    FROM analytics_metrics WHERE creator_id=? GROUP BY platform,currency ORDER BY platform,currency
  `).all(creatorId) as Array<{ platform:string;currency:string;rows:number;views:number;revenue:number;latest_date:string }>;
  return { imports, totals, byPlatform };
}

export function getCreatorFinancialSettings(creatorId:string){
  const row=openDatabase().prepare("SELECT agency_split_bps,revenue_basis,updated_at FROM creator_financial_settings WHERE creator_id=?")
    .get(creatorId) as {agency_split_bps:number;revenue_basis:string;updated_at:string}|undefined;
  return row??{agency_split_bps:0,revenue_basis:"imported_platform_earnings",updated_at:null};
}

export function saveCreatorFinancialSettings(input:{creatorId:string;agencySplitPercent:number}){
  if(!getCreator(input.creatorId))throw new Error("Creator workspace not found.");
  if(!Number.isFinite(input.agencySplitPercent)||input.agencySplitPercent<0||input.agencySplitPercent>100)throw new Error("Agency split must be between 0% and 100%.");
  const basisPoints=Math.round(input.agencySplitPercent*100);
  openDatabase().prepare(`INSERT INTO creator_financial_settings (creator_id,agency_split_bps,revenue_basis,updated_at)
    VALUES (?,?,'imported_platform_earnings',CURRENT_TIMESTAMP)
    ON CONFLICT(creator_id) DO UPDATE SET agency_split_bps=excluded.agency_split_bps,
      revenue_basis=excluded.revenue_basis,updated_at=CURRENT_TIMESTAMP`).run(input.creatorId,basisPoints);
}

export function getPremiumEarningsSummary(creatorId:string){
  return openDatabase().prepare(`SELECT platform,currency,COUNT(*) AS rows,MIN(period_date) AS first_date,MAX(period_date) AS latest_date,
    COALESCE(SUM(revenue),0) AS imported_earnings,COALESCE(SUM(subscribers),0) AS subscribers
    FROM analytics_metrics WHERE creator_id=? AND platform IN ('onlyfans','fansly')
    GROUP BY platform,currency ORDER BY platform,currency`).all(creatorId) as Array<{
      platform:string;currency:string;rows:number;first_date:string;latest_date:string;imported_earnings:number;subscribers:number;
    }>;
}

export type InstagramMediaAnalyticsInput = {
  mediaId: string;
  caption: string;
  mediaType: string;
  mediaProductType: string;
  permalink: string;
  publishedAt: string;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  views: number | null;
  saves: number | null;
  shares: number | null;
  totalInteractions: number | null;
  reposts: number | null;
  rawJson: string;
};

export function startInstagramAnalyticsSync(creatorId: string, accountId: string) {
  const account = openDatabase().prepare("SELECT id FROM accounts WHERE id=? AND creator_id=? AND platform='instagram'").get(accountId, creatorId);
  if (!account) throw new Error("Instagram account is outside the creator workspace.");
  const result = openDatabase().prepare("INSERT INTO instagram_analytics_syncs (creator_id, account_id) VALUES (?, ?)").run(creatorId, accountId);
  return Number(result.lastInsertRowid);
}

export function completeInstagramAnalyticsSync(input: {
  syncId: number;
  creatorId: string;
  accountId: string;
  media: InstagramMediaAnalyticsInput[];
  followerActivity: Array<{ observedAt: string; hourly: Record<string, number> }>;
  insightCount: number;
}) {
  const db = openDatabase();
  db.exec("BEGIN");
  try {
    const upsertMedia = db.prepare(`
      INSERT INTO instagram_media_analytics (
        creator_id, account_id, media_id, caption, media_type, media_product_type,
        permalink, published_at, likes, comments, reach, views, saves, shares,
        total_interactions, reposts, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(creator_id, account_id, media_id) DO UPDATE SET
        caption=excluded.caption, media_type=excluded.media_type,
        media_product_type=excluded.media_product_type, permalink=excluded.permalink,
        published_at=excluded.published_at, likes=excluded.likes, comments=excluded.comments,
        reach=excluded.reach, views=excluded.views, saves=excluded.saves,
        shares=excluded.shares, total_interactions=excluded.total_interactions,
        reposts=excluded.reposts, raw_json=excluded.raw_json, synced_at=CURRENT_TIMESTAMP
    `);
    for (const item of input.media) {
      upsertMedia.run(
        input.creatorId, input.accountId, item.mediaId, item.caption, item.mediaType,
        item.mediaProductType, item.permalink, item.publishedAt, item.likes, item.comments,
        item.reach, item.views, item.saves, item.shares, item.totalInteractions,
        item.reposts, item.rawJson,
      );
    }
    const upsertActivity = db.prepare(`
      INSERT INTO instagram_follower_activity (creator_id, account_id, observed_at, hourly_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(creator_id, account_id, observed_at) DO UPDATE SET
        hourly_json=excluded.hourly_json, synced_at=CURRENT_TIMESTAMP
    `);
    for (const item of input.followerActivity) upsertActivity.run(input.creatorId, input.accountId, item.observedAt, JSON.stringify(item.hourly));
    db.prepare(`UPDATE instagram_analytics_syncs SET status='completed', media_count=?, insight_count=?, completed_at=CURRENT_TIMESTAMP, error=NULL WHERE id=? AND creator_id=?`)
      .run(input.media.length, input.insightCount, input.syncId, input.creatorId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function failInstagramAnalyticsSync(syncId: number, creatorId: string, error: string) {
  openDatabase().prepare("UPDATE instagram_analytics_syncs SET status='failed', error=?, completed_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
    .run(error.slice(0, 1000), syncId, creatorId);
}

export type InstagramMediaAnalyticsRow = {
  id: number; creator_id: string; account_id: string; media_id: string; caption: string;
  media_type: string; media_product_type: string; permalink: string; published_at: string;
  likes: number | null; comments: number | null; reach: number | null; views: number | null;
  saves: number | null; shares: number | null; total_interactions: number | null;
  reposts: number | null; raw_json: string; synced_at: string;
};

export function getInstagramAnalyticsData(creatorId: string) {
  const db = openDatabase();
  const media = db.prepare("SELECT * FROM instagram_media_analytics WHERE creator_id=? ORDER BY published_at DESC")
    .all(creatorId) as InstagramMediaAnalyticsRow[];
  const activityRows = db.prepare("SELECT * FROM instagram_follower_activity WHERE creator_id=? ORDER BY observed_at DESC")
    .all(creatorId) as Array<{ account_id: string; observed_at: string; hourly_json: string; synced_at: string }>;
  const latestSync = db.prepare("SELECT * FROM instagram_analytics_syncs WHERE creator_id=? ORDER BY id DESC LIMIT 1")
    .get(creatorId) as { id: number; status: string; media_count: number; insight_count: number; started_at: string; completed_at: string | null; error: string | null } | undefined;
  return {
    media,
    followerActivity: activityRows.map((row) => ({ ...row, hourly: JSON.parse(row.hourly_json) as Record<string, number> })),
    latestSync,
  };
}

export type PublicationMatchRow = {
  id: number; creator_id: string; post_package_id: number; account_id: string; platform: string;
  external_media_id: string; permalink: string; match_method: string; status: string; matched_at: string;
};

export function confirmPublicationMatch(input: {
  creatorId: string; postPackageId: number; externalMediaId: string; permalink: string; matchMethod: "manual" | "api_receipt";
}) {
  const db = openDatabase();
  const post = getPostPackage(input.postPackageId);
  if (!post || post.creator_id !== input.creatorId || post.platform !== "instagram") throw new Error("Choose an Instagram package in the active creator workspace.");
  if (input.matchMethod === "manual" && post.status !== "published") throw new Error("Mark the package published before matching its live Instagram post.");
  const media = db.prepare("SELECT media_id,permalink FROM instagram_media_analytics WHERE creator_id=? AND account_id=? AND media_id=?")
    .get(input.creatorId, post.account_id, input.externalMediaId) as { media_id: string; permalink: string } | undefined;
  if (input.matchMethod === "manual" && !media) throw new Error("Choose Instagram media verified in this creator workspace.");
  const result = db.prepare(`
    INSERT INTO post_publication_matches (creator_id,post_package_id,account_id,platform,external_media_id,permalink,match_method)
    VALUES (?, ?, ?, 'instagram', ?, ?, ?)
    ON CONFLICT(creator_id,post_package_id) DO UPDATE SET external_media_id=excluded.external_media_id,
      permalink=excluded.permalink, match_method=excluded.match_method, status='confirmed', matched_at=CURRENT_TIMESTAMP
  `).run(input.creatorId, post.id, post.account_id, input.externalMediaId, input.permalink || media?.permalink || "", input.matchMethod);
  db.prepare("INSERT INTO publication_events (post_package_id,event_type,detail) VALUES (?, 'publication_matched', ?)")
    .run(post.id, JSON.stringify({ externalMediaId: input.externalMediaId, method: input.matchMethod }));
  return Number(result.lastInsertRowid);
}

export function getPublicationMatches(creatorId: string) {
  return openDatabase().prepare(`
    SELECT m.*,p.caption,p.published_at,p.scheduled_at,a.label AS account_label
    FROM post_publication_matches m JOIN post_packages p ON p.id=m.post_package_id JOIN accounts a ON a.id=m.account_id
    WHERE m.creator_id=? ORDER BY m.matched_at DESC
  `).all(creatorId) as Array<PublicationMatchRow & { caption: string; published_at: string | null; scheduled_at: string | null; account_label: string }>;
}

export function getInstagramMatchCandidates(creatorId: string, postPackageId: number) {
  const post = getPostPackage(postPackageId);
  if (!post || post.creator_id !== creatorId || post.platform !== "instagram") return [];
  const postTime = post.published_at || post.scheduled_at || post.created_at;
  return (openDatabase().prepare(`
    SELECT m.* FROM instagram_media_analytics m
    LEFT JOIN post_publication_matches x ON x.creator_id=m.creator_id AND x.external_media_id=m.media_id
    WHERE m.creator_id=? AND m.account_id=? AND x.id IS NULL
    ORDER BY ABS(julianday(m.published_at)-julianday(?)) ASC LIMIT 8
  `).all(creatorId, post.account_id, postTime) as InstagramMediaAnalyticsRow[]).map((media) => {
    const postWords = new Set(post.caption.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
    const mediaWords = new Set(media.caption.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
    const shared = [...postWords].filter((word) => mediaWords.has(word)).length;
    const similarity = postWords.size ? shared / postWords.size : 0;
    const hoursApart = Math.abs(new Date(media.published_at).getTime() - new Date(postTime).getTime()) / 3_600_000;
    return { ...media, similarity, hoursApart, suggested: similarity >= 0.45 || hoursApart <= 6 };
  });
}

export function captureInstagramOutcomeSnapshots(creatorId: string) {
  const db = openDatabase();
  const matches = db.prepare(`
    SELECT x.id AS match_id,x.post_package_id,p.published_at AS package_published_at,m.*
    FROM post_publication_matches x
    JOIN post_packages p ON p.id=x.post_package_id
    JOIN instagram_media_analytics m ON m.creator_id=x.creator_id AND m.account_id=x.account_id AND m.media_id=x.external_media_id
    WHERE x.creator_id=? AND x.status='confirmed'
  `).all(creatorId) as Array<InstagramMediaAnalyticsRow & { match_id: number; post_package_id: number; package_published_at: string | null }>;
  const upsert = db.prepare(`
    INSERT INTO post_outcome_snapshots (creator_id,publication_match_id,horizon,elapsed_hours,reach,views,likes,comments,saves,shares,total_interactions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(publication_match_id,horizon) DO UPDATE SET elapsed_hours=excluded.elapsed_hours,
      reach=excluded.reach,views=excluded.views,likes=excluded.likes,comments=excluded.comments,
      saves=excluded.saves,shares=excluded.shares,total_interactions=excluded.total_interactions,captured_at=CURRENT_TIMESTAMP
  `);
  let captured = 0;
  for (const item of matches) {
    const published = item.package_published_at || item.published_at;
    const elapsedHours = Math.max(0, (Date.now() - new Date(published).getTime()) / 3_600_000);
    const milestones = ["latest", ...(elapsedHours >= 168 ? ["7d"] : elapsedHours >= 24 ? ["24h"] : elapsedHours >= 1 ? ["1h"] : [])];
    for (const horizon of milestones) {
      upsert.run(creatorId,item.match_id,horizon,elapsedHours,item.reach,item.views,item.likes,item.comments,item.saves,item.shares,item.total_interactions);
      captured += 1;
    }
  }
  return captured;
}

export function getPostOutcomeSnapshots(creatorId: string, postPackageId?: number) {
  return openDatabase().prepare(`
    SELECT s.*,x.post_package_id,x.permalink,a.label AS account_label
    FROM post_outcome_snapshots s JOIN post_publication_matches x ON x.id=s.publication_match_id
    JOIN accounts a ON a.id=x.account_id
    WHERE s.creator_id=? AND (? IS NULL OR x.post_package_id=?)
    ORDER BY s.captured_at DESC
  `).all(creatorId, postPackageId ?? null, postPackageId ?? null) as Array<{
    id:number; publication_match_id:number; post_package_id:number; horizon:string; elapsed_hours:number;
    reach:number|null; views:number|null; likes:number|null; comments:number|null; saves:number|null;
    shares:number|null; total_interactions:number|null; captured_at:string; permalink:string; account_label:string;
  }>;
}

export type CreatorActivityItem = { id:string; occurredAt:string; category:string; title:string; detail:string; postPackageId:number|null; status:string };

export function getCreatorActivity(creatorId: string, postPackageId?: number) {
  const db=openDatabase();
  const postFilter=postPackageId??null;
  const events=(db.prepare(`SELECT e.*,a.label AS account_label FROM publication_events e JOIN post_packages p ON p.id=e.post_package_id
    JOIN accounts a ON a.id=p.account_id WHERE a.creator_id=? AND e.event_type NOT IN ('telegram_handoff_sent','creator_reminder_sent') AND (? IS NULL OR p.id=?)`).all(creatorId,postFilter,postFilter) as Array<{id:number;post_package_id:number;event_type:string;occurred_at:string;detail:string;account_label:string}>).map((row)=>{
      let detail=row.account_label;
      if(row.detail){try{const parsed=JSON.parse(row.detail) as Record<string,unknown>;if(parsed.externalPostId)detail+=` · receipt ${parsed.externalPostId}`;else if(parsed.externalMediaId)detail+=` · media ${parsed.externalMediaId}`;else if(parsed.to)detail+=` · moved to ${String(parsed.to)}`;}catch{detail+=` · ${row.detail}`;}}
      return {id:`event-${row.id}`,occurredAt:row.occurred_at,category:"content",title:row.event_type.replaceAll("_"," "),detail,postPackageId:row.post_package_id,status:"recorded"};
    });
  const handoffs=(db.prepare(`SELECT h.* FROM telegram_handoffs h WHERE h.creator_id=? AND (? IS NULL OR h.post_package_id=?)`).all(creatorId,postFilter,postFilter) as TelegramHandoffRow[]).map((row)=>({
    id:`telegram-${row.id}`,occurredAt:row.completed_at||row.created_at,category:"telegram",title:`Telegram handoff ${row.status}`,detail:`${row.sent_asset_count}/${row.asset_count} assets${row.error?` · ${row.error}`:""}`,postPackageId:row.post_package_id,status:row.status,
  }));
  const matches=getPublicationMatches(creatorId).filter((row)=>postPackageId==null||row.post_package_id===postPackageId).map((row)=>({
    id:`match-${row.id}`,occurredAt:row.matched_at,category:"measurement",title:"Published post matched",detail:`${row.account_label} · ${row.match_method.replaceAll("_"," ")}`,postPackageId:row.post_package_id,status:row.status,
  }));
  const outcomes=getPostOutcomeSnapshots(creatorId,postPackageId).map((row)=>({
    id:`outcome-${row.id}`,occurredAt:row.captured_at,category:"measurement",title:`${row.horizon} outcome captured`,detail:`Reach ${(row.reach||0).toLocaleString()} · interactions ${(row.total_interactions||0).toLocaleString()}`,postPackageId:row.post_package_id,status:"recorded",
  }));
  const reminders=getCreatorReminders(creatorId).filter((row)=>postPackageId==null||row.post_package_id===postPackageId).map((row)=>({
    id:`reminder-${row.id}`,occurredAt:row.sent_at||row.approved_at||row.updated_at,category:"reminder",title:`${row.reminder_type.replaceAll("_"," ")} · ${row.status}`,detail:row.account_label,postPackageId:row.post_package_id,status:row.status,
  }));
  return [...events,...handoffs,...matches,...outcomes,...reminders].sort((a,b)=>new Date(b.occurredAt).getTime()-new Date(a.occurredAt).getTime()) as CreatorActivityItem[];
}

export type RedditCommunityRow = {
  id: number;
  creator_id: string;
  name: string;
  rules_url: string;
  status: string;
  allows_nsfw: number;
  creator_verified: number;
  verification_required: number;
  flair_required: number;
  allowed_post_types: string;
  minimum_account_age_days: number;
  minimum_karma: number;
  cooldown_hours: number;
  title_guidance: string;
  notes: string;
  last_verified_at: string;
};

export function getRedditCommunities(creatorId: string) {
  return openDatabase().prepare(`
    SELECT * FROM reddit_communities WHERE creator_id=? ORDER BY status, name
  `).all(creatorId) as RedditCommunityRow[];
}

export function createRedditCommunity(input: {
  creatorId: string;
  name: string;
  rulesUrl: string;
  allowsNsfw: boolean;
  creatorVerified: boolean;
  verificationRequired: boolean;
  flairRequired: boolean;
  allowedPostTypes: string;
  minimumAccountAgeDays: number;
  minimumKarma: number;
  cooldownHours: number;
  titleGuidance: string;
  notes: string;
  lastVerifiedAt: string;
}) {
  const name = input.name.trim().replace(/^r\//i, "");
  if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) throw new Error("Enter a valid subreddit name without r/.");
  openDatabase().prepare(`
    INSERT INTO reddit_communities (
      creator_id, name, rules_url, allows_nsfw, creator_verified,
      verification_required, flair_required, allowed_post_types,
      minimum_account_age_days, minimum_karma, cooldown_hours,
      title_guidance, notes, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(creator_id, name) DO UPDATE SET
      rules_url=excluded.rules_url, allows_nsfw=excluded.allows_nsfw,
      creator_verified=excluded.creator_verified,
      verification_required=excluded.verification_required,
      flair_required=excluded.flair_required,
      allowed_post_types=excluded.allowed_post_types,
      minimum_account_age_days=excluded.minimum_account_age_days,
      minimum_karma=excluded.minimum_karma, cooldown_hours=excluded.cooldown_hours,
      title_guidance=excluded.title_guidance, notes=excluded.notes,
      last_verified_at=excluded.last_verified_at, updated_at=CURRENT_TIMESTAMP
  `).run(
    input.creatorId, name, input.rulesUrl, input.allowsNsfw ? 1 : 0,
    input.creatorVerified ? 1 : 0, input.verificationRequired ? 1 : 0,
    input.flairRequired ? 1 : 0, input.allowedPostTypes,
    input.minimumAccountAgeDays, input.minimumKarma, input.cooldownHours,
    input.titleGuidance, input.notes, input.lastVerifiedAt,
  );
}

export type RedditTargetRow = {
  id: number;
  creator_id: string;
  post_package_id: number;
  community_id: number;
  title: string;
  flair: string;
  content_rating: string;
  scheduled_at: string | null;
  status: string;
  approved_at: string | null;
  submitted_at: string | null;
  external_post_id: string | null;
  external_url: string | null;
  error: string | null;
  created_at: string;
  community_name: string;
  account_label: string;
  basename: string;
};

export function getRedditTargets(creatorId: string) {
  return openDatabase().prepare(`
    SELECT t.*, c.name AS community_name, a.label AS account_label, x.basename
    FROM reddit_post_targets t
    JOIN reddit_communities c ON c.id=t.community_id
    JOIN post_packages p ON p.id=t.post_package_id
    JOIN accounts a ON a.id=p.account_id
    JOIN assets x ON x.id=p.asset_id
    WHERE t.creator_id=? ORDER BY COALESCE(t.scheduled_at, t.created_at), t.id
  `).all(creatorId) as RedditTargetRow[];
}

export function getRedditTarget(id: number) {
  return openDatabase().prepare(`
    SELECT t.*, c.name AS community_name, a.label AS account_label, x.basename
    FROM reddit_post_targets t
    JOIN reddit_communities c ON c.id=t.community_id
    JOIN post_packages p ON p.id=t.post_package_id
    JOIN accounts a ON a.id=p.account_id
    JOIN assets x ON x.id=p.asset_id
    WHERE t.id=?
  `).get(id) as RedditTargetRow | undefined;
}

export function createRedditTarget(input: {
  creatorId: string;
  postPackageId: number;
  communityId: number;
  title: string;
  flair: string;
  contentRating: "sfw" | "nsfw";
  scheduledAt?: string;
}) {
  const db = openDatabase();
  const post = getPostPackage(input.postPackageId);
  const community = db.prepare("SELECT * FROM reddit_communities WHERE id=? AND creator_id=?").get(input.communityId, input.creatorId) as RedditCommunityRow | undefined;
  if (!post || post.creator_id !== input.creatorId || post.platform !== "reddit" || post.status !== "approved" || !post.approved_at) {
    throw new Error("Choose an approved Reddit post package.");
  }
  if (!community || community.status !== "active") throw new Error("Subreddit is not active.");
  const verifiedAt = new Date(community.last_verified_at).getTime();
  if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > 30 * 24 * 60 * 60 * 1000) throw new Error("Subreddit rules must be rechecked before targeting.");
  if (community.verification_required && !community.creator_verified) throw new Error("Creator verification is required for this subreddit.");
  if (input.contentRating === "nsfw" && !community.allows_nsfw) throw new Error("This subreddit is not recorded as allowing NSFW posts.");
  if (community.flair_required && !input.flair.trim()) throw new Error("This subreddit requires a flair.");
  const title = input.title.trim();
  if (!title || title.length > 300) throw new Error("Reddit title must be between 1 and 300 characters.");
  const lastSubmission = db.prepare(`
    SELECT submitted_at FROM reddit_post_targets
    WHERE creator_id=? AND community_id=? AND status='submitted'
    ORDER BY submitted_at DESC LIMIT 1
  `).get(input.creatorId, input.communityId) as { submitted_at: string } | undefined;
  if (lastSubmission && Date.now() - new Date(lastSubmission.submitted_at).getTime() < community.cooldown_hours * 60 * 60 * 1000) {
    throw new Error(`The recorded r/${community.name} cooldown has not elapsed.`);
  }
  const idempotencyKey = `${post.id}:${post.approved_at}:${community.id}`;
  const existing = db.prepare("SELECT id FROM reddit_post_targets WHERE idempotency_key=?").get(idempotencyKey) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db.prepare(`
    INSERT INTO reddit_post_targets (
      creator_id, post_package_id, community_id, title, flair,
      content_rating, scheduled_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.creatorId, post.id, community.id, title, input.flair.trim(),
    input.contentRating, input.scheduledAt || null, idempotencyKey,
  );
  return Number(result.lastInsertRowid);
}

export function approveRedditTarget(creatorId: string, id: number) {
  const result = openDatabase().prepare(`
    UPDATE reddit_post_targets SET status='approved_for_posting',
      approved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='awaiting_target_approval'
  `).run(id, creatorId);
  if (result.changes !== 1) throw new Error("Reddit target is no longer awaiting approval.");
}

export function getApprovedRedditTargetsForPublishing(limit = 20) {
  return openDatabase().prepare(`
    SELECT t.*, c.name AS community_name, a.label AS account_label, x.basename
    FROM reddit_post_targets t
    JOIN reddit_communities c ON c.id=t.community_id
    JOIN post_packages p ON p.id=t.post_package_id
    JOIN accounts a ON a.id=p.account_id
    JOIN assets x ON x.id=p.asset_id
    WHERE t.status='approved_for_posting'
    ORDER BY COALESCE(t.scheduled_at,t.approved_at,t.created_at),t.id LIMIT ?
  `).all(limit) as RedditTargetRow[];
}

export function claimRedditTargetForPublishing(creatorId: string, id: number) {
  return openDatabase().prepare(`UPDATE reddit_post_targets SET status='submitting',error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='approved_for_posting'`).run(id,creatorId).changes===1;
}

export function completeRedditTargetPublishing(input:{creatorId:string;id:number;externalPostId:string;externalUrl:string;warning?:string}) {
  const result=openDatabase().prepare(`UPDATE reddit_post_targets SET status='submitted',submitted_at=CURRENT_TIMESTAMP,
    external_post_id=?,external_url=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='submitting'`)
    .run(input.externalPostId,input.externalUrl,input.warning||null,input.id,input.creatorId);
  if(result.changes!==1)throw new Error("Reddit target was not in the submitting state.");
}

export function failRedditTargetPublishing(creatorId:string,id:number,error:string) {
  openDatabase().prepare(`UPDATE reddit_post_targets SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='submitting'`).run(error.slice(0,1000),id,creatorId);
}

export function resetFailedRedditTarget(creatorId:string,id:number) {
  const result=openDatabase().prepare(`UPDATE reddit_post_targets SET status='approved_for_posting',error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='failed'`).run(id,creatorId);
  if(result.changes!==1)throw new Error("Only a failed Reddit target can be retried.");
}

export function disconnectPlatformConnection(creatorId: string, accountId: string, provider: string) {
  const db = openDatabase();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM platform_connections WHERE creator_id=? AND account_id=? AND provider=?").run(creatorId, accountId, provider);
    const remaining = db.prepare("SELECT 1 FROM platform_connections WHERE creator_id=? AND account_id=? AND status='connected' LIMIT 1").get(creatorId, accountId);
    if (!remaining) db.prepare("UPDATE accounts SET connection_status='not_connected', publishing_mode='finish_on_device' WHERE id=? AND creator_id=?").run(accountId, creatorId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getAssets(query = "", limit = 60, creatorId = "thrill-noir") {
  const db = openDatabase();
  if (query) {
    return db
      .prepare("SELECT * FROM assets WHERE creator_id=? AND source_available=1 AND (basename LIKE ? OR relative_path LIKE ?) ORDER BY modified_at DESC LIMIT ?")
      .all(creatorId, `%${query}%`, `%${query}%`, limit) as AssetRow[];
  }
  return db.prepare("SELECT * FROM assets WHERE creator_id=? AND source_available=1 ORDER BY modified_at DESC LIMIT ?").all(creatorId, limit) as AssetRow[];
}

export function getAssetCount(creatorId = "thrill-noir") {
  return (openDatabase().prepare("SELECT COUNT(*) AS count FROM assets WHERE creator_id=? AND source_available=1").get(creatorId) as { count: number }).count;
}

export function creatorOwnsMediaPath(creatorId: string, relativePath: string) {
  return Boolean(openDatabase().prepare("SELECT 1 FROM assets WHERE creator_id=? AND relative_path=? AND source_available=1").get(creatorId, relativePath));
}

export function getSourcePath(creatorId = "thrill-noir") {
  return getCreator(creatorId)?.media_source || thrillNoirPilot.mediaSource;
}

export function getCreatorReadiness(creatorId: string) {
  const creator = getCreator(creatorId);
  if (!creator) throw new Error("Creator workspace not found.");
  const voice = getVoiceProfile(creatorId);
  const checks = [
    { key: "accounts", label: "Add destination accounts", href: "/accounts", complete: getAccounts(creatorId).length > 0 },
    { key: "voice", label: "Add genuine voice examples", href: "/voice", complete: Boolean(voice?.approved_examples.trim()) },
    { key: "people", label: "Record people, consent and tags", href: "/people", complete: getPeople(creatorId).length > 0 },
    { key: "media", label: "Index the first media library", href: "/library", complete: getAssetCount(creatorId) > 0 },
    { key: "post", label: "Build the first factual post package", href: "/content/new", complete: getPostPackages(creatorId).length > 0 },
  ];
  return { checks, completed: checks.filter((check) => check.complete).length, total: checks.length };
}

export type PostPackageRow = {
  id: number;
  asset_id: string;
  account_id: string;
  creator_notes: string;
  caption: string;
  scheduled_at: string | null;
  status: string;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
  basename: string;
  relative_path: string;
  account_label: string;
  platform: string;
  handle: string;
  account_url: string;
  bundle_id: string | null;
  asset_count: number;
  creator_id: string;
};

export function createPostPackage(input: {
  assetId: string;
  accountId: string;
  creatorNotes: string;
  caption: string;
  scheduledAt?: string;
}) {
  const result = openDatabase()
    .prepare(`
      INSERT INTO post_packages (asset_id, account_id, creator_notes, caption, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, 'needs_approval')
    `)
    .run(input.assetId, input.accountId, input.creatorNotes, input.caption, input.scheduledAt || null);
  return Number(result.lastInsertRowid);
}

export function createPostBundle(input: {
  creatorId: string;
  assetIds: string[];
  accountIds: string[];
  personIds: number[];
  creatorNotes: string;
  scheduledAt?: string;
}) {
  const db = openDatabase();
  const matchingAssets = (db.prepare(`SELECT COUNT(*) AS count FROM assets WHERE creator_id=? AND id IN (${input.assetIds.map(() => "?").join(",")})`).get(input.creatorId, ...input.assetIds) as { count: number }).count;
  const matchingAccounts = (db.prepare(`SELECT COUNT(*) AS count FROM accounts WHERE creator_id=? AND id IN (${input.accountIds.map(() => "?").join(",")})`).get(input.creatorId, ...input.accountIds) as { count: number }).count;
  if (matchingAssets !== input.assetIds.length || matchingAccounts !== input.accountIds.length) {
    throw new Error("Selected assets and accounts must belong to the active creator.");
  }
  const bundleId = crypto.randomUUID();
  const insertPackage = db.prepare(`
    INSERT INTO post_packages (
      asset_id, account_id, creator_notes, caption, scheduled_at, status, bundle_id
    ) VALUES (?, ?, ?, '', ?, 'draft', ?)
  `);
  const insertAsset = db.prepare(`
    INSERT INTO post_package_assets (post_package_id, asset_id, position) VALUES (?, ?, ?)
  `);
  const insertPerson = db.prepare(`
    INSERT INTO post_package_people (post_package_id, person_id, tag_approved) VALUES (?, ?, 0)
  `);
  const ids: number[] = [];
  db.exec("BEGIN");
  try {
    for (const accountId of input.accountIds) {
      const result = insertPackage.run(
        input.assetIds[0],
        accountId,
        input.creatorNotes,
        input.scheduledAt || null,
        bundleId,
      );
      const postId = Number(result.lastInsertRowid);
      ids.push(postId);
      input.assetIds.forEach((assetId, position) => insertAsset.run(postId, assetId, position));
      input.personIds.forEach((personId) => insertPerson.run(postId, personId));
    }
    db.exec("COMMIT");
    return { bundleId, postIds: ids };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getPostPackages(creatorId = "thrill-noir") {
  return openDatabase()
    .prepare(`
      SELECT p.*, a.basename, a.relative_path, ac.label AS account_label,
             ac.platform, ac.handle, ac.url AS account_url, ac.creator_id,
             (SELECT COUNT(*) FROM post_package_assets pa WHERE pa.post_package_id=p.id) AS asset_count
      FROM post_packages p
      JOIN assets a ON a.id = p.asset_id
      JOIN accounts ac ON ac.id = p.account_id
      WHERE ac.creator_id=?
      ORDER BY p.created_at DESC
    `)
    .all(creatorId) as PostPackageRow[];
}

export function getPostPackage(id: number) {
  return openDatabase()
    .prepare(`
      SELECT p.*, a.basename, a.relative_path, ac.label AS account_label,
             ac.platform, ac.handle, ac.url AS account_url, ac.creator_id,
             (SELECT COUNT(*) FROM post_package_assets pa WHERE pa.post_package_id=p.id) AS asset_count
      FROM post_packages p
      JOIN assets a ON a.id = p.asset_id
      JOIN accounts ac ON ac.id = p.account_id
      WHERE p.id = ?
    `)
    .get(id) as PostPackageRow | undefined;
}

export function getPostPackageAssets(id: number) {
  return openDatabase()
    .prepare(`
      SELECT a.* FROM post_package_assets pa
      JOIN assets a ON a.id=pa.asset_id
      WHERE pa.post_package_id=?
      ORDER BY pa.position
    `)
    .all(id) as AssetRow[];
}

export function approvePostPackage(id: number) {
  const db = openDatabase();
  const post = getPostPackage(id);
  if (!post) throw new Error("Post package not found.");
  const approvedAt = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE post_packages SET status='approved', approved_at=? WHERE id=?").run(approvedAt, id);
    db.prepare(`
      INSERT INTO approvals (post_package_id, decision, decided_by, snapshot)
      VALUES (?, 'approved', 'BR', ?)
    `).run(id, JSON.stringify(post));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updatePostPackage(input: {
  id: number;
  accountId: string;
  creatorNotes: string;
  caption: string;
  scheduledAt?: string;
}) {
  const db = openDatabase();
  const previous = getPostPackage(input.id);
  if (!previous) throw new Error("Post package not found.");
  const changed =
    previous.account_id !== input.accountId ||
    previous.creator_notes !== input.creatorNotes ||
    previous.caption !== input.caption ||
    (previous.scheduled_at ?? "") !== (input.scheduledAt ?? "");
  if (!changed) return;

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE post_packages
      SET account_id=?, creator_notes=?, caption=?, scheduled_at=?,
          status='needs_approval', approved_at=NULL
      WHERE id=?
    `).run(
      input.accountId,
      input.creatorNotes,
      input.caption,
      input.scheduledAt || null,
      input.id,
    );
    if (previous.status === "approved") {
      db.prepare(`
        INSERT INTO approvals (post_package_id, decision, decided_by, snapshot)
        VALUES (?, 'superseded_by_edit', 'BR', ?)
      `).run(input.id, JSON.stringify(previous));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type PersonRow = {
  id: number;
  display_name: string;
  stage_name: string | null;
  consent_status: string;
  tagging_preference: string;
  private_notes: string;
  tags: string;
  creator_id: string;
};

export function getPeople(creatorId = "thrill-noir") {
  return openDatabase()
    .prepare(`
      SELECT p.*, COALESCE(GROUP_CONCAT(t.platform || ':' || t.handle, ' · '), '') AS tags
      FROM people p
      LEFT JOIN person_social_tags t ON t.person_id=p.id
      WHERE p.creator_id=?
      GROUP BY p.id
      ORDER BY COALESCE(p.stage_name, p.display_name)
    `)
    .all(creatorId) as PersonRow[];
}

export function createPerson(input: {
  creatorId: string;
  displayName: string;
  stageName?: string;
  consentStatus: string;
  taggingPreference: string;
  privateNotes?: string;
  tags: Array<{ platform: string; handle: string }>;
}) {
  const db = openDatabase();
  db.exec("BEGIN");
  try {
    const result = db.prepare(`
      INSERT INTO people (creator_id, display_name, stage_name, consent_status, tagging_preference, private_notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.creatorId,
      input.displayName,
      input.stageName || null,
      input.consentStatus,
      input.taggingPreference,
      input.privateNotes || "",
    );
    const personId = Number(result.lastInsertRowid);
    const insertTag = db.prepare("INSERT INTO person_social_tags (person_id, platform, handle) VALUES (?, ?, ?)");
    input.tags.filter((tag) => tag.handle).forEach((tag) => insertTag.run(personId, tag.platform, tag.handle));
    db.exec("COMMIT");
    return personId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getPostPackagePeople(id: number) {
  return openDatabase()
    .prepare(`
      SELECT p.*, pp.tag_approved,
             COALESCE(GROUP_CONCAT(t.platform || ':' || t.handle, ' · '), '') AS tags
      FROM post_package_people pp
      JOIN people p ON p.id=pp.person_id
      LEFT JOIN person_social_tags t ON t.person_id=p.id
      WHERE pp.post_package_id=?
      GROUP BY p.id, pp.tag_approved
      ORDER BY COALESCE(p.stage_name, p.display_name)
    `)
    .all(id) as Array<PersonRow & { tag_approved: number }>;
}

export type VoiceProfileRow = {
  creator_id: string;
  display_name: string;
  perspective: string;
  tone_notes: string;
  vocabulary: string;
  phrases_to_avoid: string;
  emoji_style: string;
  hashtag_style: string;
  approved_examples: string;
  updated_at: string;
};

export function getVoiceProfile(creatorId = "thrill-noir") {
  return openDatabase()
    .prepare("SELECT * FROM creator_voice_profiles WHERE creator_id=?")
    .get(creatorId) as VoiceProfileRow | undefined;
}

export function saveVoiceProfile(creatorId: string, input: Omit<VoiceProfileRow, "creator_id" | "updated_at">) {
  openDatabase().prepare(`
    INSERT INTO creator_voice_profiles (
      creator_id, display_name, perspective, tone_notes, vocabulary,
      phrases_to_avoid, emoji_style, hashtag_style, approved_examples, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(creator_id) DO UPDATE SET
      display_name=excluded.display_name, perspective=excluded.perspective,
      tone_notes=excluded.tone_notes, vocabulary=excluded.vocabulary,
      phrases_to_avoid=excluded.phrases_to_avoid, emoji_style=excluded.emoji_style,
      hashtag_style=excluded.hashtag_style, approved_examples=excluded.approved_examples,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    creatorId, input.display_name, input.perspective, input.tone_notes, input.vocabulary,
    input.phrases_to_avoid, input.emoji_style, input.hashtag_style, input.approved_examples,
  );
}

export type ResearchFindingRow = {
  id: number;
  platform: string;
  source_name: string;
  source_url: string;
  summary: string;
  recommendation: string;
  confidence: string;
  observed_at: string;
  expires_at: string | null;
  status: string;
  creator_id: string;
};

export function getResearchFindings(creatorId = "thrill-noir", activeOnly = false) {
  return openDatabase()
    .prepare(`SELECT * FROM research_findings WHERE creator_id=? ${activeOnly ? "AND status='active' AND (expires_at IS NULL OR expires_at >= date('now'))" : ""} ORDER BY observed_at DESC`)
    .all(creatorId) as ResearchFindingRow[];
}

export function createResearchFinding(input: Omit<ResearchFindingRow, "id" | "status">) {
  openDatabase().prepare(`
    INSERT INTO research_findings (
      creator_id, platform, source_name, source_url, summary, recommendation,
      confidence, observed_at, expires_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(
    input.creator_id, input.platform, input.source_name, input.source_url, input.summary,
    input.recommendation, input.confidence, input.observed_at, input.expires_at || null,
  );
}

export type AgentTaskRow = {
  id: number;
  provider: string;
  role: string;
  prompt: string;
  mode: string;
  status: string;
  post_package_id: number | null;
  approved_at: string | null;
  created_at: string;
  output: string | null;
  error: string | null;
  creator_id: string;
};

export function createCaptionTask(postId: number, provider: "codex" | "claude") {
  const post = getPostPackage(postId);
  if (!post) throw new Error("Post package not found.");
  const creatorId = (openDatabase().prepare("SELECT creator_id FROM accounts WHERE id=?").get(post.account_id) as { creator_id: string }).creator_id;
  const creator = getCreator(creatorId);
  const voice = getVoiceProfile(creatorId);
  if (!voice?.approved_examples.trim()) {
    throw new Error("Add at least one approved voice example before drafting captions.");
  }
  const people = getPostPackagePeople(postId);
  const research = getResearchFindings(creatorId, true).filter((finding) =>
    finding.platform === post.platform || finding.platform === "all",
  );
  const prompt = [
    `You are the creator-managing agent for ${creator?.name ?? voice.display_name}.`,
    "Write one organic social caption only. Do not explain your work or provide alternatives.",
    "Never invent events, feelings, relationships, locations, or personal details.",
    `Destination: ${post.platform} (${post.handle})`,
    `Creator notes: ${post.creator_notes}`,
    `Voice perspective: ${voice.perspective}`,
    `Voice notes: ${voice.tone_notes}`,
    `Preferred vocabulary: ${voice.vocabulary}`,
    `Never use: ${voice.phrases_to_avoid}`,
    `Emoji style: ${voice.emoji_style}; hashtag style: ${voice.hashtag_style}`,
    `Approved examples:\n${voice.approved_examples}`,
    `People/tags available: ${people.map((person) => `${person.stage_name || person.display_name} ${person.tags}`).join("; ") || "none"}`,
    `Current research context (optional, never force it):\n${research.map((finding) => `- ${finding.summary} | ${finding.recommendation} | ${finding.source_url}`).join("\n") || "none"}`,
    "Return only the final caption text.",
  ].join("\n\n");
  const result = openDatabase().prepare(`
    INSERT INTO agent_tasks (provider, role, prompt, mode, status, post_package_id, creator_id)
    VALUES (?, 'creator_manager', ?, 'plan', 'awaiting_approval', ?, ?)
  `).run(provider, prompt, postId, creatorId);
  return Number(result.lastInsertRowid);
}

export function getAgentTasks(creatorId?: string) {
  if (!creatorId) return openDatabase().prepare("SELECT * FROM agent_tasks ORDER BY created_at DESC").all() as AgentTaskRow[];
  return openDatabase().prepare("SELECT * FROM agent_tasks WHERE creator_id=? ORDER BY created_at DESC").all(creatorId) as AgentTaskRow[];
}

export function createResearchTask(input: {
  creatorId: string;
  provider: "codex" | "claude";
  platform: string;
  question: string;
}) {
  const creator = getCreator(input.creatorId);
  if (!creator) throw new Error("Creator workspace not found.");
  const prompt = [
    `You are the read-only research agent supporting ${creator.name}.`,
    `Research question: ${input.question}`,
    `Platform focus: ${input.platform}`,
    "Find current, practical evidence about organic audience growth for adult creators on mainstream public platforms and, when relevant, NSFW Reddit communities.",
    "Do not log in, post, message anyone, evade platform rules, or make changes anywhere.",
    "Distinguish first-party platform rules from practitioner observations. Include direct source URLs, publication or observation dates, confidence, expiry/recheck advice, and a small ethical experiment.",
    "Do not recommend spam, fake engagement, ban evasion, undisclosed automation, or unsafe content.",
    "Return a concise research brief for human review. Nothing becomes an approved finding automatically.",
  ].join("\n\n");
  const result = openDatabase().prepare(`
    INSERT INTO agent_tasks (provider, role, prompt, mode, status, creator_id)
    VALUES (?, 'research_agent', ?, 'plan', 'awaiting_approval', ?)
  `).run(input.provider, prompt, input.creatorId);
  return Number(result.lastInsertRowid);
}

export function getAgentTask(id: number) {
  return openDatabase().prepare("SELECT * FROM agent_tasks WHERE id=?").get(id) as AgentTaskRow | undefined;
}

export function markAgentTaskRunning(id: number) {
  openDatabase().prepare("UPDATE agent_tasks SET status='running', approved_at=CURRENT_TIMESTAMP, started_at=CURRENT_TIMESTAMP, error=NULL WHERE id=?").run(id);
}

export function completeCaptionTask(id: number, caption: string) {
  const db = openDatabase();
  const task = getAgentTask(id);
  if (!task?.post_package_id) throw new Error("Caption task has no post package.");
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE agent_tasks SET status='completed', completed_at=CURRENT_TIMESTAMP, output=? WHERE id=?").run(caption, id);
    db.prepare("UPDATE post_packages SET caption=?, status='needs_approval', approved_at=NULL WHERE id=?").run(caption, task.post_package_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function completeResearchTask(id: number, output: string) {
  openDatabase().prepare(`
    UPDATE agent_tasks SET status='needs_review', completed_at=CURRENT_TIMESTAMP, output=? WHERE id=?
  `).run(output, id);
}

export function failAgentTask(id: number, error: string) {
  openDatabase().prepare("UPDATE agent_tasks SET status='failed', completed_at=CURRENT_TIMESTAMP, error=? WHERE id=?").run(error, id);
}

export type AutomationEventInput = {
  creatorId: string;
  eventType: string;
  source: string;
  queue?: "intake" | "ai";
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

export type AutomationEventStatus = "created" | "dispatching" | "queued" | "running" | "completed" | "failed" | "dispatch_failed";
export type AutomationEventRow = {
  id:number; creator_id:string; event_type:string; source:string; queue:"intake"|"ai";
  idempotency_key:string; payload:string; status:AutomationEventStatus; attempts:number;
  created_at:string; updated_at:string; dispatched_at:string|null; started_at:string|null;
  completed_at:string|null; processed_at:string|null; error:string|null;
};
export type WorkflowReceiptRow = {
  id:number; creator_id:string; event_id:number|null; receipt_key:string|null; workflow_type:string;
  status:string; external_id:string|null; public_url:string|null; detail:string; verified_at:string|null; created_at:string;
};

export function enqueueAutomationEvent(input: AutomationEventInput) {
  const db = openDatabase();
  if (!getCreator(input.creatorId)) throw new Error("Creator workspace not found.");
  const result = db.prepare(`
    INSERT OR IGNORE INTO automation_events
      (creator_id, event_type, source, queue, idempotency_key, payload, status)
    VALUES (?, ?, ?, ?, ?, ?, 'created')
  `).run(
    input.creatorId,
    input.eventType,
    input.source,
    input.queue || "intake",
    input.idempotencyKey,
    JSON.stringify(input.payload || {}),
  );
  const row = db.prepare("SELECT * FROM automation_events WHERE idempotency_key=?").get(input.idempotencyKey) as AutomationEventRow;
  return { inserted: result.changes === 1, event: row };
}

export function getAutomationEvent(creatorId:string,idempotencyKey:string){
  return openDatabase().prepare("SELECT * FROM automation_events WHERE creator_id=? AND idempotency_key=?")
    .get(creatorId,idempotencyKey) as AutomationEventRow|undefined;
}

export function markAutomationEventDispatching(creatorId:string,idempotencyKey:string){
  const result=openDatabase().prepare(`
    UPDATE automation_events SET status='dispatching',attempts=attempts+1,error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE creator_id=? AND idempotency_key=? AND status IN ('created','dispatch_failed','failed')
  `).run(creatorId,idempotencyKey);
  if(result.changes!==1)throw new Error("Automation event is not ready for dispatch.");
}

export function markAutomationEventDispatched(creatorId:string,idempotencyKey:string){
  const result=openDatabase().prepare(`
    UPDATE automation_events SET status='queued',dispatched_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,error=NULL
    WHERE creator_id=? AND idempotency_key=? AND status='dispatching'
  `).run(creatorId,idempotencyKey);
  if(result.changes!==1)throw new Error("Automation event dispatch state changed unexpectedly.");
}

export function markAutomationEventDispatchFailed(creatorId:string,idempotencyKey:string,error:string){
  openDatabase().prepare(`
    UPDATE automation_events SET status='dispatch_failed',error=?,updated_at=CURRENT_TIMESTAMP
    WHERE creator_id=? AND idempotency_key=?
  `).run(error.slice(0,1000),creatorId,idempotencyKey);
}

export function applyAutomationCallback(input:{
  creatorId:string; idempotencyKey:string; eventType:string; source:string; queue?:"intake"|"ai";
  status:"queued"|"running"|"completed"|"failed"; receiptKey:string; workflowType:string;
  externalId?:string; publicUrl?:string; detail?:Record<string,unknown>; verified?:boolean; error?:string;
}){
  const db=openDatabase();
  db.exec("BEGIN");
  try{
    let event=getAutomationEvent(input.creatorId,input.idempotencyKey);
    if(!event){
      const created=enqueueAutomationEvent({creatorId:input.creatorId,eventType:input.eventType,source:input.source,queue:input.queue,idempotencyKey:input.idempotencyKey,payload:input.detail});
      event=created.event;
    }
    if(event.status==="completed"&&input.status!=="completed"){
      db.exec("COMMIT");
      return event.id;
    }
    const timestampSql=input.status==="running"?"started_at=CURRENT_TIMESTAMP,":input.status==="completed"||input.status==="failed"?"completed_at=CURRENT_TIMESTAMP,processed_at=CURRENT_TIMESTAMP,":"";
    db.prepare(`UPDATE automation_events SET status=?,${timestampSql}error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?`)
      .run(input.status,input.error?.slice(0,1000)||null,event.id,input.creatorId);
    db.prepare(`
      INSERT INTO workflow_receipts
        (creator_id,event_id,receipt_key,workflow_type,status,external_id,public_url,detail,verified_at)
      VALUES (?,?,?,?,?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)
      ON CONFLICT(receipt_key) DO UPDATE SET
        status=excluded.status,external_id=excluded.external_id,public_url=excluded.public_url,
        detail=excluded.detail,verified_at=COALESCE(excluded.verified_at,workflow_receipts.verified_at)
    `).run(input.creatorId,event.id,input.receiptKey,input.workflowType,input.status,input.externalId||null,input.publicUrl||null,JSON.stringify(input.detail||{}),input.verified?1:0);
    db.exec("COMMIT");
    return event.id;
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function recordWorkflowReceipt(input: {
  creatorId: string;
  eventId?: number;
  receiptKey?: string;
  workflowType: string;
  status: string;
  externalId?: string;
  publicUrl?: string;
  detail?: Record<string, unknown>;
  verified?: boolean;
}) {
  const result = openDatabase().prepare(`
    INSERT INTO workflow_receipts
      (creator_id, event_id, receipt_key, workflow_type, status, external_id, public_url, detail, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)
  `).run(
    input.creatorId,
    input.eventId || null,
    input.receiptKey || null,
    input.workflowType,
    input.status,
    input.externalId || null,
    input.publicUrl || null,
    JSON.stringify(input.detail || {}),
    input.verified === true ? 1 : 0,
  );
  return Number(result.lastInsertRowid);
}

export function getRecentAutomationEvents(creatorId?: string) {
  if (creatorId) {
    return openDatabase().prepare("SELECT * FROM automation_events WHERE creator_id=? ORDER BY created_at DESC LIMIT 100").all(creatorId) as AutomationEventRow[];
  }
  return openDatabase().prepare("SELECT * FROM automation_events ORDER BY created_at DESC LIMIT 100").all() as AutomationEventRow[];
}

export function getRecentWorkflowReceipts(creatorId?: string) {
  if (creatorId) {
    return openDatabase().prepare("SELECT * FROM workflow_receipts WHERE creator_id=? ORDER BY created_at DESC LIMIT 100").all(creatorId) as WorkflowReceiptRow[];
  }
  return openDatabase().prepare("SELECT * FROM workflow_receipts ORDER BY created_at DESC LIMIT 100").all() as WorkflowReceiptRow[];
}

export function getScheduledPosts(creatorId: string) {
  return getPostPackages(creatorId)
    .filter((post) => post.scheduled_at)
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
}

export type CreatorReminderRuleRow = { creator_id:string; enabled:number; lead_minutes:number; overdue_minutes:number; timezone:string; updated_at:string };
export type CreatorReminderRow = {
  id:number; creator_id:string; post_package_id:number; reminder_type:string; scheduled_for:string;
  message:string; status:string; approved_at:string|null; sent_at:string|null; snoozed_until:string|null;
  error:string|null; created_at:string; updated_at:string; account_label:string; platform:string; handle:string;
};

export function getCreatorReminderRule(creatorId: string) {
  return openDatabase().prepare("SELECT * FROM creator_reminder_rules WHERE creator_id=?").get(creatorId) as CreatorReminderRuleRow | undefined;
}

export function refreshCreatorReminders(creatorId: string) {
  const db = openDatabase();
  const rule = getCreatorReminderRule(creatorId);
  db.prepare("DELETE FROM creator_reminders WHERE creator_id=? AND status IN ('draft','approved')").run(creatorId);
  if (!rule?.enabled) return 0;
  const posts = getScheduledPosts(creatorId).filter((post) => post.status !== "published" && post.scheduled_at);
  const insert = db.prepare(`INSERT OR IGNORE INTO creator_reminders (creator_id,post_package_id,reminder_type,scheduled_for,message) VALUES (?, ?, ?, ?, ?)`);
  let count = 0;
  for (const post of posts) {
    const target = new Date(post.scheduled_at!);
    if (!Number.isFinite(target.getTime())) continue;
    const lead = new Date(target.getTime() - rule.lead_minutes * 60_000).toISOString();
    const overdue = new Date(target.getTime() + rule.overdue_minutes * 60_000).toISOString();
    count += insert.run(creatorId,post.id,"posting_due",lead,`THOT OS reminder: approved ${post.account_label} content is planned for ${target.toLocaleString("en-AU",{timeZone:rule.timezone})}.`).changes;
    count += insert.run(creatorId,post.id,"overdue_check",overdue,`THOT OS check-in: was package #${post.id} posted to ${post.handle}? Mark it published in THOT OS when complete.`).changes;
  }
  return count;
}

export function saveCreatorReminderRule(input: { creatorId:string; enabled:boolean; leadMinutes:number; overdueMinutes:number; timezone:string }) {
  if (input.leadMinutes < 5 || input.leadMinutes > 1440 || input.overdueMinutes < 5 || input.overdueMinutes > 1440) throw new Error("Reminder timing must be between 5 minutes and 24 hours.");
  openDatabase().prepare(`INSERT INTO creator_reminder_rules (creator_id,enabled,lead_minutes,overdue_minutes,timezone)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(creator_id) DO UPDATE SET enabled=excluded.enabled,lead_minutes=excluded.lead_minutes,
    overdue_minutes=excluded.overdue_minutes,timezone=excluded.timezone,updated_at=CURRENT_TIMESTAMP`)
    .run(input.creatorId,input.enabled?1:0,input.leadMinutes,input.overdueMinutes,input.timezone);
  return refreshCreatorReminders(input.creatorId);
}

export function getCreatorReminders(creatorId: string) {
  return openDatabase().prepare(`SELECT r.*,a.label AS account_label,a.platform,a.handle FROM creator_reminders r
    JOIN post_packages p ON p.id=r.post_package_id JOIN accounts a ON a.id=p.account_id
    WHERE r.creator_id=? ORDER BY r.scheduled_for,r.id`).all(creatorId) as CreatorReminderRow[];
}

export function approveCreatorReminder(creatorId: string, id: number) {
  const result = openDatabase().prepare("UPDATE creator_reminders SET status='approved',approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='draft'").run(id,creatorId);
  if (result.changes !== 1) throw new Error("Reminder is no longer awaiting approval.");
}

export function getCreatorReminderForSending(creatorId: string, id: number) {
  return openDatabase().prepare(`SELECT r.*,a.label AS account_label,a.platform,a.handle FROM creator_reminders r
    JOIN post_packages p ON p.id=r.post_package_id JOIN accounts a ON a.id=p.account_id
    WHERE r.id=? AND r.creator_id=?`).get(id,creatorId) as CreatorReminderRow | undefined;
}

export function markCreatorReminderSent(creatorId: string, id: number, messageId: string) {
  const reminder = getCreatorReminderForSending(creatorId,id);
  if (!reminder || reminder.status !== "approved") throw new Error("Reminder needs approval before sending.");
  openDatabase().prepare("UPDATE creator_reminders SET status='sent',sent_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").run(id,creatorId);
  openDatabase().prepare("INSERT INTO publication_events (post_package_id,event_type,detail) VALUES (?, 'creator_reminder_sent', ?)").run(reminder.post_package_id,JSON.stringify({reminderId:id,messageId,type:reminder.reminder_type}));
}

export function failCreatorReminder(creatorId: string, id: number, error: string) {
  openDatabase().prepare("UPDATE creator_reminders SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").run(error.slice(0,1000),id,creatorId);
}

export function reschedulePostPackage(id: number, scheduledAt: string) {
  const db = openDatabase();
  const previous = getPostPackage(id);
  if (!previous) throw new Error("Post package not found.");
  if ((previous.scheduled_at ?? "") === scheduledAt) return;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE post_packages SET scheduled_at=?, status='needs_approval', approved_at=NULL WHERE id=?").run(scheduledAt || null, id);
    db.prepare(`
      INSERT INTO publication_events (post_package_id, event_type, detail)
      VALUES (?, 'rescheduled', ?)
    `).run(id, JSON.stringify({ from: previous.scheduled_at, to: scheduledAt || null }));
    if (previous.status === "approved") {
      db.prepare(`
        INSERT INTO approvals (post_package_id, decision, decided_by, snapshot)
        VALUES (?, 'superseded_by_reschedule', 'BR', ?)
      `).run(id, JSON.stringify(previous));
    }
    db.exec("COMMIT");
    refreshCreatorReminders(previous.creator_id);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markPostPublished(id: number) {
  const db = openDatabase();
  const post = getPostPackage(id);
  if (!post) throw new Error("Post package not found.");
  if (post.status !== "approved") throw new Error("Only an approved package can be marked published.");
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE post_packages SET status='published', published_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    db.prepare("INSERT INTO publication_events (post_package_id, event_type) VALUES (?, 'published_confirmed')").run(id);
    db.prepare("UPDATE accounts SET last_published_at=CURRENT_TIMESTAMP WHERE id=?").run(post.account_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getRecentCaptions(creatorId: string, excludePostId?: number) {
  return openDatabase().prepare(`
    SELECT p.caption FROM post_packages p
    JOIN accounts a ON a.id=p.account_id
    WHERE a.creator_id=? AND p.caption<>'' AND (? IS NULL OR p.id<>?)
    ORDER BY p.created_at DESC LIMIT 20
  `).all(creatorId, excludePostId ?? null, excludePostId ?? null).map((row) => (row as { caption: string }).caption);
}

export type MessagingMode = "observe" | "assist" | "operate";
export type MessagingConnectionRow = {
  id: number; creator_id: string; account_id: string | null; platform: string; display_name: string;
  mode: MessagingMode; read_enabled: number; write_enabled: number; outbound_validated: number;
  emergency_paused: number; status: string; last_synced_at: string | null; last_error: string | null;
  handle: string | null; account_label: string | null; thread_count: number; unread_count: number;
};

export function syncMessagingConnections(creatorId: string) {
  const db = openDatabase();
  const accounts = db.prepare(`SELECT id,platform,label,handle FROM accounts
    WHERE creator_id=? AND platform IN ('instagram','onlyfans','fansly','reddit')`).all(creatorId) as Array<{id:string;platform:string;label:string;handle:string}>;
  const insert = db.prepare(`INSERT OR IGNORE INTO messaging_connections
    (creator_id,account_id,platform,display_name,status)
    VALUES (?,?,?,?,?)`);
  for (const account of accounts) {
    const bridge = account.platform === "onlyfans" || account.platform === "fansly"
      ? db.prepare("SELECT status FROM local_bridge_connections WHERE creator_id=? AND account_id=?").get(creatorId, account.id) as {status:string} | undefined
      : db.prepare("SELECT status FROM platform_connections WHERE creator_id=? AND account_id=? ORDER BY updated_at DESC LIMIT 1").get(creatorId, account.id) as {status:string} | undefined;
    insert.run(creatorId, account.id, account.platform, `${account.label} · ${account.handle}`, bridge?.status ?? "not_connected");
    if (bridge?.status) db.prepare("UPDATE messaging_connections SET status=CASE WHEN status='collector_connected' THEN status ELSE ? END,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND account_id=?").run(bridge.status,creatorId,account.id);
  }
  const telegram = db.prepare("SELECT status FROM telegram_creator_pairings WHERE creator_id=?").get(creatorId) as {status:string} | undefined;
  if (telegram) insert.run(creatorId, null, "telegram", "Agency Telegram", telegram.status);
}

export function getMessagingConnections(creatorId: string) {
  syncMessagingConnections(creatorId);
  return openDatabase().prepare(`SELECT c.*,a.handle,a.label AS account_label,
    COUNT(DISTINCT t.id) AS thread_count,COALESCE(SUM(t.unread_count),0) AS unread_count
    FROM messaging_connections c LEFT JOIN accounts a ON a.id=c.account_id
    LEFT JOIN message_threads t ON t.connection_id=c.id AND t.creator_id=c.creator_id
    WHERE c.creator_id=? GROUP BY c.id ORDER BY c.platform,c.display_name`).all(creatorId) as MessagingConnectionRow[];
}

export function updateMessagingConnection(input: {creatorId:string; connectionId:number; mode:MessagingMode; readEnabled:boolean; writeEnabled:boolean}) {
  if (!["observe","assist","operate"].includes(input.mode)) throw new Error("Unsupported messaging mode.");
  const db = openDatabase();
  const connection = db.prepare("SELECT * FROM messaging_connections WHERE id=? AND creator_id=?").get(input.connectionId,input.creatorId) as MessagingConnectionRow | undefined;
  if (!connection) throw new Error("Messaging connection is outside the active creator workspace.");
  if (input.mode !== "observe" && !input.writeEnabled) throw new Error("Assist and operate modes require write permission.");
  if (input.mode === "operate" && !connection.outbound_validated) throw new Error("Controlled outbound validation is required before operate mode can be enabled.");
  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE messaging_connections SET mode=?,read_enabled=?,write_enabled=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND creator_id=?`).run(input.mode,input.readEnabled?1:0,input.writeEnabled?1:0,input.connectionId,input.creatorId);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,event_type,actor,detail)
      VALUES (?,?,'permissions_updated','BR',?)`).run(input.creatorId,input.connectionId,JSON.stringify({mode:input.mode,readEnabled:input.readEnabled,writeEnabled:input.writeEnabled}));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function setMessagingEmergencyPause(creatorId: string, paused: boolean) {
  const db = openDatabase();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE messaging_connections SET emergency_paused=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").run(paused?1:0,creatorId);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,event_type,actor,detail)
      VALUES (?,'emergency_pause_changed','BR',?)`).run(creatorId,JSON.stringify({paused}));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function getMessagingThreads(creatorId: string) {
  return openDatabase().prepare(`SELECT t.*,c.platform,c.display_name AS connection_name
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id
    WHERE t.creator_id=? AND c.creator_id=? ORDER BY COALESCE(t.last_message_at,t.updated_at) DESC LIMIT 100`).all(creatorId,creatorId) as Array<{
      id:number; platform:string; connection_name:string; participant_name:string; participant_handle:string;
      subject:string; unread_count:number; last_message_at:string|null; status:string;
    }>;
}

export function getMessagingThread(creatorId: string, threadId: number) {
  return openDatabase().prepare(`SELECT t.*,c.platform,c.display_name AS connection_name,c.mode,c.write_enabled,c.outbound_validated,c.emergency_paused
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id
    WHERE t.id=? AND t.creator_id=? AND c.creator_id=?`).get(threadId,creatorId,creatorId) as ({
      id:number;creator_id:string;connection_id:number;platform:string;connection_name:string;external_thread_id:string;
      participant_name:string;participant_handle:string;subject:string;unread_count:number;last_message_at:string|null;
      mode:MessagingMode;write_enabled:number;outbound_validated:number;emergency_paused:number;
    } | undefined);
}

export function getThreadMessages(creatorId: string, threadId: number) {
  return openDatabase().prepare(`SELECT m.* FROM messages m JOIN message_threads t ON t.id=m.thread_id
    WHERE m.creator_id=? AND m.thread_id=? AND t.creator_id=? ORDER BY COALESCE(m.sent_at,m.created_at),m.id`)
    .all(creatorId,threadId,creatorId) as Array<{id:number;direction:"inbound"|"outbound";sender_type:string;body:string;sent_at:string|null;created_at:string;delivery_status:string}>;
}

export function getThreadDrafts(creatorId: string, threadId: number) {
  return openDatabase().prepare(`SELECT d.* FROM message_drafts d JOIN message_threads t ON t.id=d.thread_id
    WHERE d.creator_id=? AND d.thread_id=? AND t.creator_id=? ORDER BY d.created_at DESC,d.id DESC`)
    .all(creatorId,threadId,creatorId) as Array<{id:number;body:string;author_type:string;author_name:string;status:string;created_at:string}>;
}

export function createMessageDraft(input: {creatorId:string;threadId:number;body:string;authorName:string}) {
  const db = openDatabase();
  const thread = getMessagingThread(input.creatorId,input.threadId);
  if (!thread) throw new Error("Conversation is outside the active creator workspace.");
  const body = input.body.trim();
  if (!body || body.length > 20000) throw new Error("Reply draft must contain between 1 and 20,000 characters.");
  db.exec("BEGIN");
  try {
    const result = db.prepare(`INSERT INTO message_drafts (creator_id,thread_id,body,author_type,author_name,status)
      VALUES (?,?,?,'human',?,'draft')`).run(input.creatorId,input.threadId,body,input.authorName);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,thread_id,draft_id,event_type,actor,detail)
      VALUES (?,?,?,?, 'reply_drafted', ?, ?)`).run(input.creatorId,thread.connection_id,input.threadId,result.lastInsertRowid,input.authorName,JSON.stringify({characters:body.length}));
    db.exec("COMMIT");
    return Number(result.lastInsertRowid);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function approveLocalBridgeDraftForSend(input:{creatorId:string;draftId:number;approvedBy:string}) {
  const db=openDatabase();
  const row=db.prepare(`SELECT d.id AS draft_id,d.status,d.body,t.id AS thread_id,t.external_thread_id,
    c.id AS connection_id,c.account_id,c.platform,c.emergency_paused
    FROM message_drafts d JOIN message_threads t ON t.id=d.thread_id
    JOIN messaging_connections c ON c.id=t.connection_id
    WHERE d.id=? AND d.creator_id=? AND t.creator_id=? AND c.creator_id=?`)
    .get(input.draftId,input.creatorId,input.creatorId,input.creatorId) as {draft_id:number;status:string;body:string;thread_id:number;external_thread_id:string;connection_id:number;account_id:string|null;platform:string;emergency_paused:number}|undefined;
  if(!row||!row.account_id||!["onlyfans","fansly"].includes(row.platform)) throw new Error("Draft is not attached to a local premium-platform conversation.");
  if(row.status!=="draft") throw new Error("Only an unsent draft can be approved.");
  if(row.emergency_paused) throw new Error("Messaging is paused for this creator.");
  db.exec("BEGIN");
  try{
    db.prepare(`UPDATE messaging_connections SET mode='assist',write_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?`).run(row.connection_id,input.creatorId);
    db.prepare(`UPDATE message_drafts SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(input.approvedBy,row.draft_id);
    const result=db.prepare(`INSERT INTO local_bridge_outbound_jobs
      (creator_id,account_id,connection_id,thread_id,draft_id,platform,status,approved_by)
      VALUES (?,?,?,?,?,?,'approved',?)`).run(input.creatorId,row.account_id,row.connection_id,row.thread_id,row.draft_id,row.platform,input.approvedBy);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,thread_id,draft_id,event_type,actor,detail)
      VALUES (?,?,?,?, 'outbound_test_approved', ?, ?)`).run(input.creatorId,row.connection_id,row.thread_id,row.draft_id,input.approvedBy,JSON.stringify({jobId:Number(result.lastInsertRowid),externalThreadId:row.external_thread_id,characters:row.body.length}));
    db.exec("COMMIT");
    return Number(result.lastInsertRowid);
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function claimLocalBridgeOutbound(pairing:{creator_id:string;account_id:string;platform:string},externalThreadId?:string){
  const db=openDatabase();
  const job=db.prepare(`SELECT j.id,j.thread_id,j.draft_id,t.external_thread_id,d.body
    FROM local_bridge_outbound_jobs j JOIN message_threads t ON t.id=j.thread_id JOIN message_drafts d ON d.id=j.draft_id
    JOIN messaging_connections c ON c.id=j.connection_id AND c.creator_id=j.creator_id
    WHERE j.creator_id=? AND j.account_id=? AND j.platform=? AND j.status='approved'
      AND c.emergency_paused=0 AND c.write_enabled=1
      AND (? IS NULL OR rtrim(t.external_thread_id,'/')=rtrim(?,'/')) ORDER BY j.id LIMIT 1`)
    .get(pairing.creator_id,pairing.account_id,pairing.platform,externalThreadId??null,externalThreadId??null) as {id:number;thread_id:number;draft_id:number;external_thread_id:string;body:string}|undefined;
  if(!job)return undefined;
  const changed=db.prepare("UPDATE local_bridge_outbound_jobs SET status='claimed',claimed_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved'").run(job.id);
  return changed.changes===1?job:undefined;
}

export function completeLocalBridgeOutbound(input:{pairing:{creator_id:string;account_id:string;platform:string};jobId:number;sent:boolean;error?:string;receipt?:Record<string,unknown>}){
  const db=openDatabase();
  const job=db.prepare("SELECT * FROM local_bridge_outbound_jobs WHERE id=? AND creator_id=? AND account_id=? AND platform=? AND status='claimed'")
    .get(input.jobId,input.pairing.creator_id,input.pairing.account_id,input.pairing.platform) as {id:number;connection_id:number;thread_id:number;draft_id:number}|undefined;
  if(!job)throw new Error("Outbound job is not available for this collector.");
  db.exec("BEGIN");
  try{
    const status=input.sent?"sent":"failed";
    db.prepare("UPDATE local_bridge_outbound_jobs SET status=?,completed_at=CURRENT_TIMESTAMP,error=?,receipt=? WHERE id=?")
      .run(status,input.error?.slice(0,1000)??null,JSON.stringify(input.receipt??{}),job.id);
    db.prepare("UPDATE message_drafts SET status=?,sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(status,status,input.error?.slice(0,1000)??null,job.draft_id);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,thread_id,draft_id,event_type,actor,detail)
      VALUES (?,?,?,?,?,'local_bridge',?)`).run(input.pairing.creator_id,job.connection_id,job.thread_id,job.draft_id,input.sent?"outbound_sent":"outbound_failed",JSON.stringify({jobId:job.id,error:input.error??null,receipt:input.receipt??{}}));
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function createVaultUploadJobs(input:{creatorId:string;assetIds:string[];platforms:Array<"onlyfans"|"fansly">;approvedBy:string}){
  const db=openDatabase();
  const assetIds=[...new Set(input.assetIds)].slice(0,50);
  const platforms=[...new Set(input.platforms)];
  if(!assetIds.length||!platforms.length)throw new Error("Choose at least one asset and one vault destination.");
  const assets=db.prepare(`SELECT id,extension FROM assets WHERE creator_id=? AND source_available=1 AND id IN (${assetIds.map(()=>"?").join(",")})`).all(input.creatorId,...assetIds) as Array<{id:string;extension:string}>;
  if(assets.length!==assetIds.length)throw new Error("One or more assets are outside the active creator workspace.");
  if(assets.some((asset)=>!["jpg","jpeg","png","webp","heic","mp4","mov"].includes(asset.extension.toLowerCase())))throw new Error("Vault uploads support images and videos only.");
  const paidEligible=(db.prepare(`SELECT COUNT(DISTINCT asset_id) AS count FROM asset_destinations
    WHERE creator_id=? AND asset_id IN (${assetIds.map(()=>"?").join(",")}) AND destination IN ('subscription','ppv')`).get(input.creatorId,...assetIds) as {count:number}).count;
  if(paidEligible!==assetIds.length)throw new Error("Every selected asset must be classified for Subscription or PPV before it can enter a vault.");
  const missingConsent=getMissingPaidUseConsent(input.creatorId,assetIds);
  if(missingConsent.length)throw new Error(`Confirm paid-use consent for ${[...new Set(missingConsent.map((item)=>item.person_name))].join(", ")} before uploading.`);
  const connectionFor=db.prepare(`SELECT c.id,c.account_id FROM messaging_connections c
    JOIN local_bridge_connections b ON b.creator_id=c.creator_id AND b.account_id=c.account_id AND b.platform=c.platform
    WHERE c.creator_id=? AND c.platform=? AND c.account_id IS NOT NULL AND b.identity_confirmed_at IS NOT NULL`);
  const existing=db.prepare("SELECT 1 FROM vault_upload_jobs WHERE creator_id=? AND account_id=? AND asset_id=? AND status IN ('approved','claimed','staged','verified')");
  const insert=db.prepare(`INSERT INTO vault_upload_jobs (creator_id,account_id,connection_id,asset_id,platform,status,approved_by)
    VALUES (?,?,?,?,?,'approved',?)`);
  let created=0;
  db.exec("BEGIN");
  try{
    for(const platform of platforms){
      const connection=connectionFor.get(input.creatorId,platform) as {id:number;account_id:string}|undefined;
      if(!connection)throw new Error(`${platform} does not have a verified local bridge for this creator.`);
      for(const asset of assets){
        if(existing.get(input.creatorId,connection.account_id,asset.id))continue;
        const result=insert.run(input.creatorId,connection.account_id,connection.id,asset.id,platform,input.approvedBy);
        db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,event_type,actor,detail)
          VALUES (?,?,'vault_upload_approved',?,?)`).run(input.creatorId,connection.id,input.approvedBy,JSON.stringify({jobId:Number(result.lastInsertRowid),assetId:asset.id,platform}));
        created++;
      }
    }
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
  return created;
}

export function getVaultUploadJobs(creatorId:string){
  return openDatabase().prepare(`SELECT j.*,a.basename,a.relative_path,a.extension,a.bytes,ac.handle
    FROM vault_upload_jobs j JOIN assets a ON a.id=j.asset_id JOIN accounts ac ON ac.id=j.account_id
    WHERE j.creator_id=? AND a.creator_id=? AND ac.creator_id=? ORDER BY j.id DESC LIMIT 150`).all(creatorId,creatorId,creatorId) as Array<{
      id:number;asset_id:string;platform:string;status:string;approved_by:string;created_at:string;completed_at:string|null;error:string|null;
      basename:string;relative_path:string;extension:string;bytes:number;handle:string;
    }>;
}

export function retryVaultUploadJob(input:{creatorId:string;jobId:number;approvedBy:string}){
  const db=openDatabase();
  const job=db.prepare(`SELECT j.id,j.account_id,j.asset_id,j.connection_id,j.platform
    FROM vault_upload_jobs j JOIN accounts a ON a.id=j.account_id JOIN assets x ON x.id=j.asset_id
    JOIN messaging_connections c ON c.id=j.connection_id
    WHERE j.id=? AND j.creator_id=? AND j.status='failed'
      AND a.creator_id=j.creator_id AND x.creator_id=j.creator_id AND x.source_available=1 AND c.creator_id=j.creator_id`)
    .get(input.jobId,input.creatorId) as {id:number;account_id:string;asset_id:string;connection_id:number;platform:string}|undefined;
  if(!job)throw new Error("Only a failed vault upload in this creator workspace can be retried.");
  const duplicate=db.prepare(`SELECT 1 FROM vault_upload_jobs WHERE creator_id=? AND account_id=? AND asset_id=?
    AND id<>? AND status IN ('approved','claimed','staged','verified')`).get(input.creatorId,job.account_id,job.asset_id,job.id);
  if(duplicate)throw new Error("This asset already has an active or verified upload for that vault.");
  db.exec("BEGIN");
  try{
    db.prepare(`UPDATE vault_upload_jobs SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,
      claimed_at=NULL,completed_at=NULL,error=NULL,receipt='{}' WHERE id=? AND creator_id=? AND status='failed'`)
      .run(input.approvedBy,job.id,input.creatorId);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,event_type,actor,detail)
      VALUES (?,?,'vault_upload_retried',?,?)`).run(input.creatorId,job.connection_id,input.approvedBy,JSON.stringify({jobId:job.id,assetId:job.asset_id,platform:job.platform}));
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function verifyVaultUploadJob(input:{creatorId:string;jobId:number;verifiedBy:string}){
  const db=openDatabase();
  const job=db.prepare(`SELECT j.id,j.connection_id,j.asset_id,j.receipt FROM vault_upload_jobs j
    JOIN accounts a ON a.id=j.account_id JOIN assets x ON x.id=j.asset_id
    WHERE j.id=? AND j.creator_id=? AND j.status='staged' AND a.creator_id=j.creator_id AND x.creator_id=j.creator_id AND x.source_available=1`)
    .get(input.jobId,input.creatorId) as {id:number;connection_id:number;asset_id:string;receipt:string}|undefined;
  if(!job)throw new Error("Only a staged vault upload in this creator workspace can be verified.");
  let receipt:Record<string,unknown>={};
  try{receipt=JSON.parse(job.receipt||"{}");}catch{/* Keep a valid replacement receipt. */}
  db.exec("BEGIN");
  try{
    db.prepare(`UPDATE vault_upload_jobs SET status='verified',completed_at=CURRENT_TIMESTAMP,error=NULL,receipt=?
      WHERE id=? AND creator_id=? AND status='staged'`).run(JSON.stringify({...receipt,verifiedInVault:true,verifiedBy:input.verifiedBy}),job.id,input.creatorId);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,event_type,actor,detail)
      VALUES (?,?,'vault_upload_verified',?,?)`).run(input.creatorId,job.connection_id,input.verifiedBy,JSON.stringify({jobId:job.id,assetId:job.asset_id}));
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function claimVaultUpload(pairing:{creator_id:string;account_id:string;platform:string}){
  const db=openDatabase();
  const job=db.prepare(`SELECT j.id,j.asset_id,a.basename,a.extension,a.bytes
    FROM vault_upload_jobs j JOIN assets a ON a.id=j.asset_id
    WHERE j.creator_id=? AND j.account_id=? AND j.platform=?
      AND (j.status='approved' OR (j.status='claimed' AND j.claimed_at<datetime('now','-2 minutes'))) AND a.creator_id=j.creator_id AND a.source_available=1
    ORDER BY j.id LIMIT 1`).get(pairing.creator_id,pairing.account_id,pairing.platform) as {id:number;asset_id:string;basename:string;extension:string;bytes:number}|undefined;
  if(!job)return undefined;
  const changed=db.prepare("UPDATE vault_upload_jobs SET status='claimed',claimed_at=CURRENT_TIMESTAMP,error=NULL WHERE id=? AND (status='approved' OR (status='claimed' AND claimed_at<datetime('now','-2 minutes')))").run(job.id);
  return changed.changes===1?job:undefined;
}

export function getClaimedVaultUploadMedia(pairing:{creator_id:string;account_id:string;platform:string},jobId:number){
  return openDatabase().prepare(`SELECT j.id,a.relative_path,a.basename,a.extension,a.bytes
    FROM vault_upload_jobs j JOIN assets a ON a.id=j.asset_id
    WHERE j.id=? AND j.creator_id=? AND j.account_id=? AND j.platform=? AND j.status='claimed' AND a.creator_id=j.creator_id AND a.source_available=1`)
    .get(jobId,pairing.creator_id,pairing.account_id,pairing.platform) as {id:number;relative_path:string;basename:string;extension:string;bytes:number}|undefined;
}

export function completeVaultUpload(input:{pairing:{creator_id:string;account_id:string;platform:string};jobId:number;status:"staged"|"verified"|"failed";error?:string;receipt?:Record<string,unknown>}){
  const db=openDatabase();
  const job=db.prepare("SELECT id,connection_id,asset_id FROM vault_upload_jobs WHERE id=? AND creator_id=? AND account_id=? AND platform=? AND status='claimed'")
    .get(input.jobId,input.pairing.creator_id,input.pairing.account_id,input.pairing.platform) as {id:number;connection_id:number;asset_id:string}|undefined;
  if(!job)throw new Error("Vault upload job is not available for this collector.");
  db.exec("BEGIN");
  try{
    db.prepare("UPDATE vault_upload_jobs SET status=?,completed_at=CURRENT_TIMESTAMP,error=?,receipt=? WHERE id=?")
      .run(input.status,input.error?.slice(0,1000)??null,JSON.stringify(input.receipt??{}).slice(0,10000),job.id);
    db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,event_type,actor,detail)
      VALUES (?,?,?,'local_bridge',?)`).run(input.pairing.creator_id,job.connection_id,`vault_upload_${input.status}`,JSON.stringify({jobId:job.id,assetId:job.asset_id,error:input.error}));
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

export function getMessagingAuditEvents(creatorId: string) {
  return openDatabase().prepare(`SELECT e.*,c.platform,c.display_name FROM messaging_audit_events e
    LEFT JOIN messaging_connections c ON c.id=e.connection_id WHERE e.creator_id=?
    ORDER BY e.created_at DESC,e.id DESC LIMIT 30`).all(creatorId) as Array<{
      id:number; event_type:string; actor:string; detail:string; created_at:string; platform:string|null; display_name:string|null;
    }>;
}

function bridgeTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function issueLocalBridgePairing(input: {creatorId:string;accountId:string;platform:"onlyfans"|"fansly"}) {
  const db = openDatabase();
  const bridge = db.prepare(`SELECT 1 FROM local_bridge_connections WHERE creator_id=? AND account_id=? AND platform=?
    AND identity_confirmed_at IS NOT NULL`).get(input.creatorId,input.accountId,input.platform);
  if (!bridge) throw new Error("Confirm the local bridge identity before pairing the collector.");
  db.prepare("DELETE FROM local_bridge_pairings WHERE creator_id=? AND account_id=? AND paired_at IS NULL").run(input.creatorId,input.accountId);
  const token = randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO local_bridge_pairings (creator_id,account_id,platform,token_hash,expires_at)
    VALUES (?,?,?,?,datetime('now','+15 minutes'))`).run(input.creatorId,input.accountId,input.platform,bridgeTokenHash(token));
  return token;
}

export function pairLocalBridgeCollector(token: string) {
  const db = openDatabase();
  const pairing = db.prepare(`SELECT * FROM local_bridge_pairings WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP`)
    .get(bridgeTokenHash(token)) as {id:number;creator_id:string;account_id:string;platform:"onlyfans"|"fansly"} | undefined;
  if (!pairing) throw new Error("Collector pairing is invalid or expired.");
  db.prepare("UPDATE local_bridge_pairings SET paired_at=COALESCE(paired_at,CURRENT_TIMESTAMP),expires_at=datetime('now','+365 days'),last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(pairing.id);
  return pairing;
}

export function authenticateLocalBridgeCollector(token: string) {
  const pairing = openDatabase().prepare(`SELECT * FROM local_bridge_pairings WHERE token_hash=? AND paired_at IS NOT NULL AND expires_at>CURRENT_TIMESTAMP`)
    .get(bridgeTokenHash(token)) as {id:number;creator_id:string;account_id:string;platform:"onlyfans"|"fansly"} | undefined;
  if (!pairing) throw new Error("Collector authentication failed.");
  return pairing;
}

export function claimLocalBridgeCollector(platform: "onlyfans"|"fansly",identity?:{creatorId?:string;accountId?:string}) {
  const db = openDatabase();
  const bridges = db.prepare(`SELECT creator_id,account_id,platform FROM local_bridge_connections
    WHERE platform=? AND identity_confirmed_at IS NOT NULL
      AND (? IS NULL OR creator_id=?) AND (? IS NULL OR account_id=?)`).all(platform,identity?.creatorId??null,identity?.creatorId??null,identity?.accountId??null,identity?.accountId??null) as Array<{creator_id:string;account_id:string;platform:"onlyfans"|"fansly"}>;
  if (bridges.length !== 1) throw new Error("Automatic collector recovery requires exactly one verified local account for this platform.");
  const bridge = bridges[0];
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM local_bridge_pairings WHERE creator_id=? AND account_id=?").run(bridge.creator_id,bridge.account_id);
  db.prepare(`INSERT INTO local_bridge_pairings (creator_id,account_id,platform,token_hash,expires_at,paired_at,last_seen_at)
    VALUES (?,?,?,?,datetime('now','+365 days'),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(bridge.creator_id,bridge.account_id,bridge.platform,bridgeTokenHash(token));
  return {...bridge,token};
}

export type LocalBridgeThreadInput = {
  externalThreadId:string; participantName?:string; participantHandle?:string; subject?:string; unreadCount?:number;
  lastMessageAt?:string; observedOpen?:boolean; messages?:Array<{externalMessageId?:string;direction:"inbound"|"outbound";senderType?:string;body:string;sentAt?:string}>;
};

export function ingestLocalBridgeMessages(pairing: {id:number;creator_id:string;account_id:string;platform:string}, threads: LocalBridgeThreadInput[]) {
  const db = openDatabase();
  const connection = db.prepare("SELECT id,read_enabled FROM messaging_connections WHERE creator_id=? AND account_id=? AND platform=?")
    .get(pairing.creator_id,pairing.account_id,pairing.platform) as {id:number;read_enabled:number} | undefined;
  if (!connection?.read_enabled) throw new Error("Read synchronisation is disabled for this connection.");
  const safeThreads = threads.slice(0,100);
  const upsertThread = db.prepare(`INSERT INTO message_threads
    (creator_id,connection_id,external_thread_id,participant_name,participant_handle,subject,unread_count,last_message_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(connection_id,external_thread_id) DO UPDATE SET
      participant_name=CASE WHEN excluded.participant_name<>'' THEN excluded.participant_name ELSE message_threads.participant_name END,
      participant_handle=CASE WHEN excluded.participant_handle<>'' THEN excluded.participant_handle ELSE message_threads.participant_handle END,
      subject=excluded.subject,unread_count=excluded.unread_count,
      last_message_at=COALESCE(excluded.last_message_at,message_threads.last_message_at),updated_at=CURRENT_TIMESTAMP`);
  const getThread = db.prepare("SELECT id FROM message_threads WHERE connection_id=? AND external_thread_id=?");
  const insertMessage = db.prepare(`INSERT OR IGNORE INTO messages
    (creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
    VALUES (?,?,?,?,?,?,?,'observed')`);
  let messageCount = 0;
  db.exec("BEGIN");
  try {
    for (const thread of safeThreads) {
      const externalThreadId = thread.externalThreadId?.trim().split(/[?#]/)[0].replace(/\/+$/,"").slice(0,500);
      if (!externalThreadId) continue;
      const validThreadId=pairing.platform==="onlyfans"
        ? /^\/my\/chats\/chat\/[^/]+$/.test(externalThreadId)
        : /^\/messages\/[^/]+$/.test(externalThreadId);
      if(!validThreadId)continue;
      upsertThread.run(pairing.creator_id,connection.id,externalThreadId,(thread.participantName??"").slice(0,300),(thread.participantHandle??"").slice(0,300),(thread.subject??"").slice(0,500),Math.max(0,Math.min(9999,thread.unreadCount??0)),thread.lastMessageAt??null);
      const row = getThread.get(connection.id,externalThreadId) as {id:number};
      for (const message of (thread.messages??[]).slice(-200)) {
        const body = message.body.trim().slice(0,20000);
        if (!body) continue;
        const externalId = message.externalMessageId?.slice(0,500) || createHash("sha256").update(`${externalThreadId}|${message.direction}|${message.sentAt??""}|${body}`).digest("hex");
        messageCount += insertMessage.run(pairing.creator_id,row.id,externalId,message.direction,message.senderType??"unknown",body,message.sentAt??null).changes;
      }
      if(thread.observedOpen) db.prepare(`INSERT INTO message_thread_sync_state (thread_id,creator_id,status,attempts,last_completed_at,last_error)
        VALUES (?,?,'complete',1,CURRENT_TIMESTAMP,NULL)
        ON CONFLICT(thread_id) DO UPDATE SET status='complete',last_completed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
        .run(row.id,pairing.creator_id);
    }
    db.prepare("UPDATE local_bridge_pairings SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(pairing.id);
    db.prepare("UPDATE messaging_connections SET status='collector_connected',last_synced_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(connection.id);
    if(messageCount>0)db.prepare(`INSERT INTO messaging_audit_events (creator_id,connection_id,event_type,actor,detail)
      VALUES (?,?,'messages_synchronised','local_bridge',?)`).run(pairing.creator_id,connection.id,JSON.stringify({threads:safeThreads.length,messages:messageCount}));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return {threads:safeThreads.length,messages:messageCount};
}

export function claimPendingMessageThread(pairing:{creator_id:string;account_id:string;platform:string}){
  const db=openDatabase();
  const row=db.prepare(`SELECT t.id,t.external_thread_id FROM message_threads t
    JOIN messaging_connections c ON c.id=t.connection_id
    LEFT JOIN message_thread_sync_state s ON s.thread_id=t.id
    WHERE t.creator_id=? AND c.account_id=? AND c.platform=?
      AND (s.thread_id IS NULL OR s.status IN ('pending','failed') OR (s.status='claimed' AND s.last_requested_at<datetime('now','-5 minutes')))
      AND COALESCE(s.attempts,0)<3
    ORDER BY t.unread_count DESC,t.id LIMIT 1`).get(pairing.creator_id,pairing.account_id,pairing.platform) as {id:number;external_thread_id:string}|undefined;
  if(!row)return undefined;
  db.prepare(`INSERT INTO message_thread_sync_state (thread_id,creator_id,status,attempts,last_requested_at)
    VALUES (?,?,'claimed',1,CURRENT_TIMESTAMP)
    ON CONFLICT(thread_id) DO UPDATE SET status='claimed',attempts=attempts+1,last_requested_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
    .run(row.id,pairing.creator_id);
  return row;
}

export function failPendingMessageThread(pairing:{creator_id:string;account_id:string;platform:string},threadId:number,error:string){
  const result=openDatabase().prepare(`UPDATE message_thread_sync_state SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP
    WHERE thread_id=? AND creator_id=? AND EXISTS (SELECT 1 FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id
      WHERE t.id=message_thread_sync_state.thread_id AND c.account_id=? AND c.platform=?)`)
    .run(error.slice(0,1000),threadId,pairing.creator_id,pairing.account_id,pairing.platform);
  if(result.changes!==1)throw new Error("Pending thread is outside this collector account.");
}

export function getMessageSyncSummary(creatorId:string){
  return openDatabase().prepare(`SELECT c.platform,
    SUM(CASE WHEN s.status='complete' THEN 1 ELSE 0 END) complete,
    SUM(CASE WHEN s.status='claimed' THEN 1 ELSE 0 END) claimed,
    SUM(CASE WHEN s.status='failed' THEN 1 ELSE 0 END) failed,
    SUM(CASE WHEN s.thread_id IS NULL OR s.status='pending' THEN 1 ELSE 0 END) pending
    FROM messaging_connections c JOIN message_threads t ON t.connection_id=c.id
    LEFT JOIN message_thread_sync_state s ON s.thread_id=t.id
    WHERE c.creator_id=? AND c.platform IN ('onlyfans','fansly') GROUP BY c.platform`).all(creatorId) as Array<{platform:string;complete:number;claimed:number;failed:number;pending:number}>;
}

export function getCreatorReport(creatorId: string) {
  const db = openDatabase();
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS variants,
      SUM(CASE WHEN p.status='draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN p.status='needs_approval' THEN 1 ELSE 0 END) AS needs_approval,
      SUM(CASE WHEN p.status='approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN p.scheduled_at IS NOT NULL AND p.status<>'published' THEN 1 ELSE 0 END) AS scheduled
    FROM post_packages p JOIN accounts a ON a.id=p.account_id
    WHERE a.creator_id=?
  `).get(creatorId) as Record<string, number>;
  const byPlatform = db.prepare(`
    SELECT a.platform, COUNT(p.id) AS variants,
      SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END) AS published,
      MAX(p.published_at) AS last_published_at
    FROM accounts a LEFT JOIN post_packages p ON p.account_id=a.id
    WHERE a.creator_id=?
    GROUP BY a.platform ORDER BY a.platform
  `).all(creatorId) as Array<{ platform: string; variants: number; published: number; last_published_at: string | null }>;
  const uniqueAssets = (db.prepare(`
    SELECT COUNT(DISTINCT pa.asset_id) AS count FROM post_package_assets pa
    JOIN post_packages p ON p.id=pa.post_package_id JOIN accounts a ON a.id=p.account_id
    WHERE a.creator_id=?
  `).get(creatorId) as { count: number }).count;
  return { totals, byPlatform, uniqueAssets };
}
