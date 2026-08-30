-- THOT OS schema-only production baseline.
-- Generated from the complete local D1 migration replay; it contains no creator, account, content, consent, credential, or operator seed data.
-- The d1_migrations rows are schema provenance only, so future migrations begin at the correct boundary.
-- Do not apply this file to an existing D1 database.  Use it only when provisioning a new production database under the cutover runbook.
-- Source migration checksums:
-- 0001_adelaide_library.sql 10b2a42251bcb8c4e0914ee14ae6e63a6e16bf92008dc19cde1e9e3fc6153dc6
-- 0002_library_classification_events.sql b13c8181cf422c6f5e8dc9dccf2f6dae65cf507df5af4da9b6d872e1ef8a9b4c
-- 0003_operations_foundation.sql 33d4628aeeb09ec42a9fce819a5f4281dd224b04b2f17d4bd3df42415d4af032
-- 0004_reddit_scheduler.sql eb225557490c533f931368ef5060857487a0bd74e9a8e582d6cfda78f3e49acb
-- 0005_reddit_queue_controls.sql 41231b2f9b38d9b4dffb15d189a0b18e9143722a9c137ad38716c76ccd191ce6
-- 0006_instagram_operations.sql f9b059e208ab981dd3f3c0a1c3365ece38f59b6d7dfc82b2021525bb7b7501ee
-- 0007_vault_bridge.sql 224d63a813197375a6d4e57c7497c44105ce6297d49cec0ba273e4140eae5a80
-- 0008_reddit_native_bridge.sql 2beeb80a5e70986d029556d4d56afcd41eb8b1b452794c7975d113b30675ba9f
-- 0009_unified_messages.sql 10cef6399ec21dfa2191811619daea50eb442b011f016509e56fff8d055e7753
-- 0010_telegram_connector.sql 7a73e5e3899275436ff23f42d468f59f2f3c6b599142407adc63791d42095172
-- 0011_instagram_completion.sql 1c79ff32ea4411819d2771911922e5895a8de35c33eab6cf6b697f77d5a3eda6
-- 0012_instagram_replies.sql 577b6128640eb166d53992a34c72d6ebdb23a66459ac65a0f8935da9ff7d3e3e
-- 0013_instagram_reply_window.sql 65eb6d054588c56b611a7a77e16f050a14a3a51e9fe11f3b1c24fe865b9a0a81
-- 0014_instagram_message_subscription.sql b95bc3f0d2b49088f17f5d5541f3a5b94568a2b153b570285363a62c501f11e2
-- 0015_message_attachments.sql 1c69135a902badeed4e6e21d63a1bf16c5d9dc1192064bb0812f260cded76d4f
-- 0016_telegram_fansly_messages.sql 158229b1df56561dfa3c3b772136e5a800424388b4213a69f53ad1420cf42602
-- 0017_reddit_community_events.sql 37fd370f245a448c2e5b7a6c8670bfdc111e32dd315112e3773f0815d50505f8
-- 0018_creator_identity_profiles.sql f8e1bb1662e0fab8e5345983373f4d666ef12bc95fc26bb736c40684155de0fd
-- 0019_actor_role_audit.sql 70ad156c2e894c3eb1fab47f89e8bb836986431741a4ffc8b6361240c6f5d7b7
-- 0020_actor_role_contract.sql 8929cd24e814f8a858cc8d1fa4b01d61b593573e92d281dec86113edb74e3999
-- 0021_creator_dropbox_source.sql e94306c2b4ca55c46303a7d53cd4f469d6f6410bb1a7f4df501f67553e991686
-- 0022_asset_preview_queue.sql bff15521c327fc4fb44221b4f629ece31a3b5b1c9e87011c590e712dc24c5541
-- 0023_fansly_account_invariant.sql 5d35c5507fa268bacc2bc5f22e3ea31c5d551a3f6f51bee3cd9b058ef624b3f3
-- 0024_finance_foundation.sql 6d66ce06ad5289d14f2be92562a6583e60a4ddc7ab399c36cb0c3fc9160a209e
-- 0025_reddit_composio_native_api.sql d20863e4bcc41afe013f2514f6a9f3da5ff50ada148a72d6c04bdfbf9b8400ab
-- 0026_retire_reddit_browser_bridge.sql be24ab173b7310a81c5c8b58cd9404a0696f41c865c2d6b019b92db26fc77431
-- 0027_reddit_post_flairs.sql 1a30baf6155f42433dcc343297d8566b10407ebc4253e766fa80163a6bcf72c2
-- 0028_migration_ledger.sql efdc454682d7afac6e78b0e9dc75cb057aab7c4295a515b71211366d9e655fe9
-- 0029_service_principal_capabilities.sql bc78ed7fe45da8f2f9365314c4f49c12ce94bc98242e75e6b1dc6ca68ea508e8
-- 0030_canonical_control_plane.sql 5af26213782ae8b41d748f8cb8adbe0697cbd03f4256ef98fd810814bbd70fc8
-- 0031_service_auth_activation_support.sql b588a4db5dbe1276fde28165a569f29f938dabee6c1d386aaa19da0f6ff02948
-- 0032_service_auth_compatibility.sql 93ac4104a7acfb38e2ebba847fc296f5c170ec418b0e6e9b83e411361184161f
-- 0033_tenant_integrity_and_quarantine.sql 067db9a9a789e64559639ba42d56b9a7589ad0e5761ac7cd2de71e9d8d9087a9
-- 0034_public_profiles_and_approved_links.sql f6bc1eae648d729684cb862dffc2e9580f86f16509a1e21616e85c391bf00d8d
-- 0035_delivery_outbox_and_metric_observations.sql 52b4cc45f47ff1c80933491cd5ae89a4872716566023e76511b60534e26d9767
-- 0036_public_profile_authoring_guards.sql 62e7d2140b80b7ebeffc50f1cf2dbb5e62f0d9e8460e0ada731c264616d53df8
-- 0037_instagram_analytics_collection_runs.sql 184f296e49fb0b1a7be8d7d19211aaa464d913cae06692cb6d3f9e632e692dcf
-- 0038_instagram_analytics_metric_coverage.sql 4f67076eca0b6e4196c8f6683f4b8cacf2554b00042993fd624f6be795c4b73a
-- 0039_production_environment_audit_contract.sql 132aca9a09b09bfb349bb4c5bcef7923e975a732f1eecdd3d018dbd45953ad9c
-- 0040_creator_profile_interactions.sql d79b782e42cc7a7924caa2d2c3ee435dd62f9b6de43f238a52b4cf5d73284df3
-- 0041_creator_profile_appearance.sql 88e3e139d41bf64285a334ac9731bee70fd7e50af7ab85232d62bfba9db37977
-- 0042_creator_profile_image_derivatives.sql 5c727792884d1eca6919be804633e0b20d7f911433b013492b7464abde09f352
-- 0043_creator_profile_projection_delivery.sql 64d84accfe04a9c968c1121f6a6750ee69dbb24b8ebd2fa6656973629004063e
-- 0044_onlyfans_upload_bridge.sql 0e05068cace10bf881d5d5de95c96bd6063db9dee46ccf6caae542bb30995413
-- 0045_onlyfans_authorized_delivery.sql 9d71946d845db2a3024f6c6350e305b108bd00a22927516e71ebc676e59202b7
-- 0046_onlyfans_sequential_batches.sql aaa6819075edb50d1a97d4e2b35c078df663b5827e3d4d2d27af1b111c3063ef
-- 0047_onlyfans_supervised_delivery.sql 8b3a0212d0f21917b0bac1dba7a7bb58c7cfc4bf943496fea2a3ad2bfe859233
-- 0048_onlyfans_grouped_message_delivery.sql 6a4be245fe175490f067c5c08ee2b03a528df04d4e31440582b68596ce11c34d
-- 0044_creator_r2_library.sql 0f3d0a0f618ecb45c23b5655f543a7e6687fe541535e58c39d5b5bac724e4ff2
-- 0045_finished_media_uploads.sql aa43dafebb51faaf994eb732a3881af47597e3110c3450eefaa15692ba49a886
-- 0049_creator_onboarding_access_vault.sql e75dad101e52a5414f7311b27bebbd53e158a87134d56c474e638573877a114f
-- 0050_r2_native_source_media.sql c681a99484a73d8f9ada88ce6ffae2399a42eec06ee522a2e4d1558ae6060801
-- 0051_r2_source_media_hardening.sql 52361888de0b4d5bc139caeeb972e049d729cd08d0404dda025b407d96da81b1
-- 0052_creator_scoped_r2_readiness.sql 18f08784500f20f579af07bce92027fc6ef1553a15f707de1a5bacd3bcf49939

PRAGMA foreign_keys = ON;

CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO d1_migrations (id, name) VALUES (1, '0001_adelaide_library.sql');
INSERT INTO d1_migrations (id, name) VALUES (2, '0002_library_classification_events.sql');
INSERT INTO d1_migrations (id, name) VALUES (3, '0003_operations_foundation.sql');
INSERT INTO d1_migrations (id, name) VALUES (4, '0004_reddit_scheduler.sql');
INSERT INTO d1_migrations (id, name) VALUES (5, '0005_reddit_queue_controls.sql');
INSERT INTO d1_migrations (id, name) VALUES (6, '0006_instagram_operations.sql');
INSERT INTO d1_migrations (id, name) VALUES (7, '0007_vault_bridge.sql');
INSERT INTO d1_migrations (id, name) VALUES (8, '0008_reddit_native_bridge.sql');
INSERT INTO d1_migrations (id, name) VALUES (9, '0009_unified_messages.sql');
INSERT INTO d1_migrations (id, name) VALUES (10, '0010_telegram_connector.sql');
INSERT INTO d1_migrations (id, name) VALUES (11, '0011_instagram_completion.sql');
INSERT INTO d1_migrations (id, name) VALUES (12, '0012_instagram_replies.sql');
INSERT INTO d1_migrations (id, name) VALUES (13, '0013_instagram_reply_window.sql');
INSERT INTO d1_migrations (id, name) VALUES (14, '0014_instagram_message_subscription.sql');
INSERT INTO d1_migrations (id, name) VALUES (15, '0015_message_attachments.sql');
INSERT INTO d1_migrations (id, name) VALUES (16, '0016_telegram_fansly_messages.sql');
INSERT INTO d1_migrations (id, name) VALUES (17, '0017_reddit_community_events.sql');
INSERT INTO d1_migrations (id, name) VALUES (18, '0018_creator_identity_profiles.sql');
INSERT INTO d1_migrations (id, name) VALUES (19, '0019_actor_role_audit.sql');
INSERT INTO d1_migrations (id, name) VALUES (20, '0020_actor_role_contract.sql');
INSERT INTO d1_migrations (id, name) VALUES (21, '0021_creator_dropbox_source.sql');
INSERT INTO d1_migrations (id, name) VALUES (22, '0022_asset_preview_queue.sql');
INSERT INTO d1_migrations (id, name) VALUES (23, '0023_fansly_account_invariant.sql');
INSERT INTO d1_migrations (id, name) VALUES (24, '0024_finance_foundation.sql');
INSERT INTO d1_migrations (id, name) VALUES (25, '0025_reddit_composio_native_api.sql');
INSERT INTO d1_migrations (id, name) VALUES (26, '0026_retire_reddit_browser_bridge.sql');
INSERT INTO d1_migrations (id, name) VALUES (27, '0027_reddit_post_flairs.sql');
INSERT INTO d1_migrations (id, name) VALUES (28, '0028_migration_ledger.sql');
INSERT INTO d1_migrations (id, name) VALUES (29, '0029_service_principal_capabilities.sql');
INSERT INTO d1_migrations (id, name) VALUES (30, '0030_canonical_control_plane.sql');
INSERT INTO d1_migrations (id, name) VALUES (31, '0031_service_auth_activation_support.sql');
INSERT INTO d1_migrations (id, name) VALUES (32, '0032_service_auth_compatibility.sql');
INSERT INTO d1_migrations (id, name) VALUES (33, '0033_tenant_integrity_and_quarantine.sql');
INSERT INTO d1_migrations (id, name) VALUES (34, '0034_public_profiles_and_approved_links.sql');
INSERT INTO d1_migrations (id, name) VALUES (35, '0035_delivery_outbox_and_metric_observations.sql');
INSERT INTO d1_migrations (id, name) VALUES (36, '0036_public_profile_authoring_guards.sql');
INSERT INTO d1_migrations (id, name) VALUES (37, '0037_instagram_analytics_collection_runs.sql');
INSERT INTO d1_migrations (id, name) VALUES (38, '0038_instagram_analytics_metric_coverage.sql');
INSERT INTO d1_migrations (id, name) VALUES (39, '0039_production_environment_audit_contract.sql');
INSERT INTO d1_migrations (id, name) VALUES (40, '0040_creator_profile_interactions.sql');
INSERT INTO d1_migrations (id, name) VALUES (41, '0041_creator_profile_appearance.sql');
INSERT INTO d1_migrations (id, name) VALUES (42, '0042_creator_profile_image_derivatives.sql');
INSERT INTO d1_migrations (id, name) VALUES (43, '0043_creator_profile_projection_delivery.sql');
INSERT INTO d1_migrations (id, name) VALUES (44, '0044_onlyfans_upload_bridge.sql');
INSERT INTO d1_migrations (id, name) VALUES (45, '0045_onlyfans_authorized_delivery.sql');
INSERT INTO d1_migrations (id, name) VALUES (46, '0046_onlyfans_sequential_batches.sql');
INSERT INTO d1_migrations (id, name) VALUES (47, '0047_onlyfans_supervised_delivery.sql');
INSERT INTO d1_migrations (id, name) VALUES (48, '0048_onlyfans_grouped_message_delivery.sql');
INSERT INTO d1_migrations (id, name) VALUES (49, '0044_creator_r2_library.sql');
INSERT INTO d1_migrations (id, name) VALUES (50, '0045_finished_media_uploads.sql');
INSERT INTO d1_migrations (id, name) VALUES (51, '0049_creator_onboarding_access_vault.sql');
INSERT INTO d1_migrations (id, name) VALUES (52, '0050_r2_native_source_media.sql');
INSERT INTO d1_migrations (id, name) VALUES (53, '0051_r2_source_media_hardening.sql');
INSERT INTO d1_migrations (id, name) VALUES (54, '0052_creator_scoped_r2_readiness.sql');

CREATE TABLE account_browser_profiles (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  PRIMARY KEY (creator_id, account_id),
  UNIQUE (profile_id, platform),
  FOREIGN KEY (profile_id, creator_id) REFERENCES browser_profiles(id, creator_id) ON DELETE RESTRICT
);

CREATE TABLE asset_classification_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy')));

CREATE TABLE asset_classifications (
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

CREATE TABLE asset_destinations (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  destination TEXT NOT NULL CHECK(destination IN ('instagram','facebook','tiktok','threads','x','reddit','subscription','ppv')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(asset_id, destination)
);

CREATE TABLE asset_ingest_parts (
  session_id TEXT NOT NULL REFERENCES asset_ingest_sessions(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK(part_number BETWEEN 1 AND 10000),
  byte_count INTEGER NOT NULL CHECK(byte_count > 0),
  etag TEXT,
  status TEXT NOT NULL CHECK(status IN ('uploading','uploaded','failed')),
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(session_id,part_number)
);

CREATE TABLE asset_ingest_sessions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT REFERENCES asset_storage_objects(id) ON DELETE SET NULL,
  source_revision TEXT,
  expected_sha256 TEXT NOT NULL CHECK(expected_sha256 GLOB '[0-9a-f]*' AND length(expected_sha256)=64),
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes >= 0),
  expected_mime_type TEXT NOT NULL CHECK(length(expected_mime_type) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK(status IN ('created','uploading','finalized','aborted','expired','failed')),
  expires_at TEXT NOT NULL,
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, object_key TEXT, multipart_upload_id TEXT, chunk_bytes INTEGER, uploaded_bytes INTEGER NOT NULL DEFAULT 0, actor_email TEXT, actor_role TEXT CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service')), finalization_state TEXT NOT NULL DEFAULT 'incomplete'
  CHECK(finalization_state IN ('incomplete','completing','completed_unreconciled','verifying','verified','failed','quarantined','expired','aborted')), completed_r2_version TEXT, completed_r2_etag TEXT, completion_observed_at TEXT, reconcile_attempts INTEGER NOT NULL DEFAULT 0 CHECK(reconcile_attempts >= 0),
  UNIQUE(creator_id, asset_id, source_revision, expected_sha256)
);

CREATE TABLE asset_paid_consent_attestations (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  evidence_platform TEXT NOT NULL CHECK(evidence_platform IN ('onlyfans','fansly')),
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  PRIMARY KEY(asset_id, person_id)
);

CREATE TABLE asset_people (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'creator_friend',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(asset_id, person_id)
);

CREATE TABLE asset_preview_jobs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_revision TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','processing','ready','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, asset_id)
);

CREATE TABLE asset_storage_objects (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('r2','dropbox')),
  storage_role TEXT NOT NULL CHECK(storage_role IN ('canonical_original','source_fallback','ephemeral_delivery')),
  bucket_role TEXT NOT NULL CHECK(bucket_role IN ('library_media','dropbox_source','delivery_ephemeral')),
  object_key TEXT NOT NULL CHECK(length(object_key) BETWEEN 1 AND 1024),
  original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 512),
  byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
  verified_mime_type TEXT NOT NULL CHECK(length(verified_mime_type) BETWEEN 1 AND 160),
  sha256 TEXT NOT NULL CHECK(sha256 GLOB '[0-9a-f]*' AND length(sha256)=64),
  source_provider TEXT NOT NULL CHECK(source_provider IN ('dropbox','m1_direct')),
  source_revision TEXT,
  ingest_status TEXT NOT NULL CHECK(ingest_status IN ('pending','uploading','verified','failed','archived')),
  storage_class TEXT NOT NULL DEFAULT 'Standard' CHECK(storage_class IN ('Standard','InfrequentAccess')),
  uploaded_at TEXT,
  verified_at TEXT,
  archived_at TEXT,
  failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, r2_version TEXT, r2_etag TEXT,
  UNIQUE(creator_id, asset_id, storage_role, sha256),
  UNIQUE(bucket_role, object_key)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  basename TEXT NOT NULL,
  extension TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  filename_class TEXT NOT NULL,
  repeated_basename INTEGER NOT NULL DEFAULT 0 CHECK(repeated_basename IN (0,1)),
  source_available INTEGER NOT NULL DEFAULT 1 CHECK(source_available IN (0,1)),
  creator_notes TEXT NOT NULL DEFAULT '',
  safety_level TEXT NOT NULL DEFAULT 'unreviewed',
  workflow_status TEXT NOT NULL DEFAULT 'available',
  indexed_at TEXT NOT NULL,
  dropbox_revision TEXT,
  preview_r2_key TEXT,
  media_r2_key TEXT,
  UNIQUE(creator_id, relative_path)
);

CREATE TABLE bridge_credentials (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  issued_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_extension_version TEXT, last_protocol_version TEXT,
  FOREIGN KEY (profile_id, creator_id) REFERENCES browser_profiles(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE browser_profiles (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  installation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','paired','revoked')),
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, chrome_login_email TEXT NOT NULL DEFAULT '', device_label TEXT NOT NULL DEFAULT '', expected_platforms_json TEXT NOT NULL DEFAULT '[]', native_identity_verified_at TEXT,
  UNIQUE(creator_id, label),
  UNIQUE(id, creator_id)
);

CREATE TABLE creator_about_profiles (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  short_bio TEXT NOT NULL DEFAULT '', long_bio TEXT NOT NULL DEFAULT '', interests TEXT NOT NULL DEFAULT '',
  approved_background_facts TEXT NOT NULL DEFAULT '', location_disclosure_preference TEXT NOT NULL DEFAULT 'private',
  relationship_disclosure_preference TEXT NOT NULL DEFAULT 'private', approved_identifying_features TEXT NOT NULL DEFAULT '',
  public_talking_points TEXT NOT NULL DEFAULT '', private_facts TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_access_audit_events (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL COLLATE NOCASE, actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_adult_link_entities (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  retired_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id)
);

CREATE TABLE creator_adult_link_revisions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL,
  profile_version_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  destination_url TEXT NOT NULL CHECK(destination_url LIKE 'https://%'),
  destination_host TEXT NOT NULL CHECK(length(destination_host) BETWEEN 1 AND 253),
  icon_key TEXT NOT NULL DEFAULT 'link' CHECK(icon_key IN ('link','instagram','tiktok','x','reddit','fansly','onlyfans','email','phone')),
  category TEXT NOT NULL DEFAULT 'creator' CHECK(category IN ('social','creator','custom')),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, link_id),
  UNIQUE(profile_version_id, sort_order),
  FOREIGN KEY(link_id, creator_id) REFERENCES creator_adult_link_entities(id, creator_id) ON DELETE RESTRICT,
  FOREIGN KEY(profile_version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_adult_profile_appearances (
  profile_version_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  theme_key TEXT NOT NULL DEFAULT 'thot-noir',
  button_style TEXT NOT NULL DEFAULT 'solid-rounded',
  background_mode TEXT NOT NULL DEFAULT 'gradient',
  background_color TEXT NOT NULL DEFAULT '#0c0911',
  primary_color TEXT NOT NULL DEFAULT '#7655f6',
  text_color TEXT NOT NULL DEFAULT '#f8f5ff',
  card_color TEXT NOT NULL DEFAULT '#211a29',
  radius_scale TEXT NOT NULL DEFAULT 'comfortable',
  inherit_sfw_theme INTEGER NOT NULL DEFAULT 0 CHECK(inherit_sfw_theme IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_adult_profile_media (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_version_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  derivative_object_key TEXT NOT NULL UNIQUE CHECK(length(derivative_object_key) BETWEEN 1 AND 1024),
  alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text) <= 500),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, sort_order),
  UNIQUE(id, creator_id),
  FOREIGN KEY(profile_version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id, creator_id) REFERENCES assets(id, creator_id) ON DELETE RESTRICT
);

CREATE TABLE creator_adult_profile_publications (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES creator_adult_profiles(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('published','rolled_back','failed')),
  published_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  adult_snapshot_key TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, version_id, status),
  FOREIGN KEY(version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE RESTRICT
);

CREATE TABLE creator_adult_profile_versions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES creator_adult_profiles(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  adult_bio TEXT NOT NULL DEFAULT '' CHECK(length(adult_bio) <= 2000),
  content_checksum TEXT NOT NULL CHECK(length(content_checksum)=64),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','published','superseded','revoked')),
  approved_by TEXT COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, version_number),
  UNIQUE(id, creator_id),
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE creator_adult_profiles (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL UNIQUE REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','retired')),
  published_version_id TEXT,
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_brand_positioning (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  current_positioning TEXT NOT NULL DEFAULT '', desired_positioning TEXT NOT NULL DEFAULT '',
  primary_audience TEXT NOT NULL DEFAULT '', niches_themes TEXT NOT NULL DEFAULT '', differentiators TEXT NOT NULL DEFAULT '',
  visual_style TEXT NOT NULL DEFAULT '', content_pillars TEXT NOT NULL DEFAULT '', paid_content_proposition TEXT NOT NULL DEFAULT '',
  growth_priorities TEXT NOT NULL DEFAULT '', hard_boundaries TEXT NOT NULL DEFAULT '', inspiration_references TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_brand_voice_profiles (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  voice_summary TEXT NOT NULL DEFAULT '', tone_personality TEXT NOT NULL DEFAULT '', common_vocabulary TEXT NOT NULL DEFAULT '',
  phrases_to_avoid TEXT NOT NULL DEFAULT '', emoji_style TEXT NOT NULL DEFAULT '', caption_length_preference TEXT NOT NULL DEFAULT '',
  humour_style TEXT NOT NULL DEFAULT '', flirting_intensity TEXT NOT NULL DEFAULT '', forbidden_topics_claims TEXT NOT NULL DEFAULT '',
  creator_examples TEXT NOT NULL DEFAULT '', platform_variations TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_compliance_records (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL DEFAULT '',
  date_of_birth TEXT NOT NULL DEFAULT '',
  adult_verified_at TEXT,
  activated_by TEXT COLLATE NOCASE REFERENCES users(email),
  activated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_exceptions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical','high','medium','low')),
  status TEXT NOT NULL CHECK(status IN ('open','resolved','accepted')),
  summary TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  remediation TEXT NOT NULL,
  source TEXT NOT NULL,
  first_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  UNIQUE(creator_id, source, code)
);

CREATE TABLE creator_finance_settings (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  agency_split_bps INTEGER NOT NULL DEFAULT 0 CHECK(agency_split_bps BETWEEN 0 AND 10000),
  revenue_basis TEXT NOT NULL DEFAULT 'imported_net_earnings' CHECK(revenue_basis = 'imported_net_earnings'),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_media_release_attestations (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','revoked')),
  approved_by TEXT COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, surface),
  UNIQUE(id, creator_id),
  FOREIGN KEY(asset_id, creator_id) REFERENCES assets(id, creator_id) ON DELETE RESTRICT,
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE creator_media_source_cutover_receipts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  plan_sha256 TEXT NOT NULL UNIQUE CHECK(length(plan_sha256)=64),
  git_sha TEXT NOT NULL CHECK(length(git_sha)=40),
  asset_coverage_sha256 TEXT NOT NULL CHECK(length(asset_coverage_sha256)=64),
  readiness_evidence_sha256 TEXT NOT NULL CHECK(length(readiness_evidence_sha256)=64),
  applied_by TEXT NOT NULL,
  rollback_of_plan_sha256 TEXT CHECK(rollback_of_plan_sha256 IS NULL OR length(rollback_of_plan_sha256)=64),
  action TEXT NOT NULL CHECK(action IN ('r2_cutover','dropbox_rollback')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_media_source_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES asset_ingest_sessions(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service')),
  event_type TEXT NOT NULL CHECK(event_type IN ('intent_created','part_uploaded','ingest_verified','ingest_failed','cutover_requested','cutover_completed','rollback_completed')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_media_source_states (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  active_backend TEXT NOT NULL DEFAULT 'dropbox' CHECK(active_backend IN ('dropbox','r2')),
  migration_state TEXT NOT NULL DEFAULT 'dropbox' CHECK(migration_state IN ('dropbox','planned','transferring','verified','r2_active','rollback','retired')),
  dropbox_fallback_enabled INTEGER NOT NULL DEFAULT 1 CHECK(dropbox_fallback_enabled IN (0,1)),
  cutover_by TEXT,
  cutover_at TEXT,
  rollback_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_memberships (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('agency_admin','operator','creator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id, user_email)
);

CREATE TABLE creator_onboarding_profiles (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL DEFAULT '',
  preferred_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  time_zone TEXT NOT NULL DEFAULT '',
  uses_chrome INTEGER NOT NULL DEFAULT 0 CHECK(uses_chrome IN (0,1)),
  adult_verification_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK(adult_verification_status IN ('not_started','submitted','verified','rejected')),
  contract_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK(contract_status IN ('not_started','pending','active','expired','terminated')),
  consent_status TEXT NOT NULL DEFAULT 'not_recorded'
    CHECK(consent_status IN ('not_recorded','pending','recorded','withdrawn')),
  restricted_admin_notes TEXT NOT NULL DEFAULT '',
  workflow_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(workflow_state IN ('draft','creator_review','admin_review','active')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_onboarding_receipts (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL UNIQUE REFERENCES creators(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE RESTRICT,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_onboarding_sections (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL CHECK(section_key IN ('identity','social_profiles','paid_platforms','chrome_access','brand_voice','positioning','about_me')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','creator_review','admin_review','complete')),
  updated_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  PRIMARY KEY(creator_id,section_key)
);

CREATE TABLE creator_profile_image_attachments (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  image_role TEXT NOT NULL CHECK(image_role IN ('avatar','background')),
  public_profile_version_id TEXT,
  adult_profile_version_id TEXT,
  derivative_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'attached' CHECK(status IN ('attached','detached')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detached_at TEXT,
  UNIQUE(id, creator_id),
  FOREIGN KEY(public_profile_version_id, creator_id) REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE,
  FOREIGN KEY(adult_profile_version_id, creator_id) REFERENCES creator_adult_profile_versions(id, creator_id) ON DELETE CASCADE,
  FOREIGN KEY(derivative_id, creator_id) REFERENCES creator_profile_image_derivatives(id, creator_id) ON DELETE RESTRICT,
  CHECK((surface='public_sfw' AND public_profile_version_id IS NOT NULL AND adult_profile_version_id IS NULL) OR (surface='adult_profile' AND adult_profile_version_id IS NOT NULL AND public_profile_version_id IS NULL))
);

CREATE TABLE creator_profile_image_derivatives (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL,
  derivative_kind TEXT NOT NULL CHECK(derivative_kind IN ('display','preview')),
  object_key TEXT NOT NULL UNIQUE CHECK(length(object_key) BETWEEN 1 AND 1024),
  content_type TEXT NOT NULL CHECK(content_type='image/webp'),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1280),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1280),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(upload_id, derivative_kind),
  UNIQUE(id, creator_id),
  FOREIGN KEY(upload_id, creator_id) REFERENCES creator_profile_image_uploads(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_profile_image_uploads (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  image_role TEXT NOT NULL CHECK(image_role IN ('avatar','background')),
  original_object_key TEXT NOT NULL UNIQUE CHECK(length(original_object_key) BETWEEN 1 AND 1024),
  declared_content_type TEXT NOT NULL CHECK(length(declared_content_type) BETWEEN 1 AND 120),
  detected_content_type TEXT,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 12582912),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL CHECK(status IN ('uploaded','processing','processed','rejected','detached')),
  reason_code TEXT NOT NULL DEFAULT '' CHECK(length(reason_code) <= 80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id)
);

CREATE TABLE creator_profile_projection_deliveries (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation_outbox(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK(surface IN ('public_sfw','adult_profile')),
  action TEXT NOT NULL CHECK(action IN ('publish','withdraw')),
  profile_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  snapshot_key TEXT NOT NULL CHECK(length(snapshot_key) BETWEEN 1 AND 512),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error_code TEXT,
  projected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(surface, action, profile_id, version_id)
);

CREATE TABLE creator_public_contact_methods (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_version_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('sms','email')),
  contact_value TEXT NOT NULL CHECK(length(contact_value) BETWEEN 3 AND 320),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, channel),
  UNIQUE(id, creator_id),
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_public_link_entities (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  retired_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id)
);

CREATE TABLE creator_public_link_revisions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL,
  profile_version_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  destination_url TEXT NOT NULL CHECK(destination_url LIKE 'https://%'),
  destination_host TEXT NOT NULL CHECK(length(destination_host) BETWEEN 1 AND 253),
  icon_key TEXT NOT NULL DEFAULT 'link' CHECK(icon_key IN ('link','instagram','tiktok','x','reddit','fansly','onlyfans','email','phone')),
  category TEXT NOT NULL DEFAULT 'social' CHECK(category IN ('social','creator','custom')),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, link_id),
  UNIQUE(profile_version_id, sort_order),
  FOREIGN KEY(link_id, creator_id) REFERENCES creator_public_link_entities(id, creator_id) ON DELETE RESTRICT,
  FOREIGN KEY(profile_version_id, creator_id) REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_public_links (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_version_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  destination_url TEXT NOT NULL CHECK(destination_url LIKE 'https://%'),
  destination_host TEXT NOT NULL CHECK(length(destination_host) BETWEEN 1 AND 253),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 999),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_version_id, sort_order),
  UNIQUE(id, creator_id),
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_public_media (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  public_object_key TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text) <= 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','revoked')),
  approved_by TEXT COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id),
  FOREIGN KEY(asset_id, creator_id) REFERENCES assets(id, creator_id) ON DELETE RESTRICT,
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE creator_public_profile_details (
  profile_version_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  public_display_name TEXT NOT NULL DEFAULT '' CHECK(length(public_display_name) <= 120),
  public_bio TEXT NOT NULL DEFAULT '' CHECK(length(public_bio) <= 2000),
  profile_media_id TEXT,
  banner_media_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, theme_key TEXT NOT NULL DEFAULT 'thot-noir', button_style TEXT NOT NULL DEFAULT 'solid-rounded', background_mode TEXT NOT NULL DEFAULT 'gradient', background_color TEXT NOT NULL DEFAULT '#0c0911', primary_color TEXT NOT NULL DEFAULT '#7655f6', text_color TEXT NOT NULL DEFAULT '#f8f5ff', card_color TEXT NOT NULL DEFAULT '#211a29', radius_scale TEXT NOT NULL DEFAULT 'comfortable',
  FOREIGN KEY(profile_version_id, creator_id)
    REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE CASCADE
);

CREATE TABLE creator_public_profile_publications (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES creator_public_profiles(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('published','rolled_back','failed')),
  published_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  public_snapshot_key TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, version_id, status),
  FOREIGN KEY(version_id, creator_id) REFERENCES creator_public_profile_versions(id, creator_id) ON DELETE RESTRICT
);

CREATE TABLE creator_public_profile_versions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES creator_public_profiles(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  headline TEXT NOT NULL DEFAULT '' CHECK(length(headline) <= 280),
  bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 2000),
  avatar_media_id TEXT,
  content_checksum TEXT NOT NULL CHECK(length(content_checksum)=64),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','published','superseded','revoked')),
  approved_by TEXT COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, version_number),
  UNIQUE(id, creator_id),
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE creator_public_profiles (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL UNIQUE REFERENCES creators(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK(slug GLOB '[a-z0-9][a-z0-9-]*'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','retired')),
  published_version_id TEXT,
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE creator_source_media_consumer_readiness (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL CHECK(service_name IN ('web','vault','instagram','reddit')),
  capability TEXT NOT NULL DEFAULT 'r2-source-v2' CHECK(capability='r2-source-v2'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','compatible','blocked','revoked')),
  worker_version TEXT,
  deployment_evidence_sha256 TEXT CHECK(deployment_evidence_sha256 IS NULL OR length(deployment_evidence_sha256)=64),
  health_evidence_sha256 TEXT CHECK(health_evidence_sha256 IS NULL OR length(health_evidence_sha256)=64),
  asset_coverage_sha256 TEXT CHECK(asset_coverage_sha256 IS NULL OR length(asset_coverage_sha256)=64),
  reason_code TEXT NOT NULL DEFAULT 'not_verified' CHECK(length(reason_code) BETWEEN 1 AND 120),
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(creator_id,service_name),
  CHECK(status <> 'compatible' OR (worker_version IS NOT NULL AND deployment_evidence_sha256 IS NOT NULL AND health_evidence_sha256 IS NOT NULL AND asset_coverage_sha256 IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE TABLE creators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  initials TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '#6f4df6',
  status TEXT NOT NULL DEFAULT 'active',
  dropbox_root TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, dropbox_link TEXT);

CREATE TABLE external_operation_receipts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL REFERENCES operation_outbox(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_operation_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','uncertain','confirmed','failed','cancelled')),
  verification_detail TEXT NOT NULL DEFAULT '{}',
  first_attempt_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(operation_id, provider)
);

CREATE TABLE finance_audit_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator')),
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE finance_daily_metrics (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly','stripe')),
  period_date TEXT NOT NULL CHECK(period_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  gross_revenue_minor INTEGER,
  refunds_minor INTEGER,
  net_revenue_minor INTEGER NOT NULL,
  subscribers INTEGER,
  import_id TEXT NOT NULL REFERENCES finance_imports(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id, platform, period_date, currency)
);

CREATE TABLE finance_imports (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('onlyfans','fansly','stripe')),
  source_name TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  row_count INTEGER NOT NULL CHECK(row_count > 0 AND row_count <= 400),
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, platform, content_hash)
);

CREATE TABLE "identity_audit_events" (
  id TEXT PRIMARY KEY,
  creator_id TEXT REFERENCES creators(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL COLLATE NOCASE,
  actor_role TEXT NOT NULL DEFAULT 'legacy'
    CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy')),
  event_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instagram_analytics_collection_runs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual','cron')),
  status TEXT NOT NULL CHECK(status IN ('running','completed','skipped','failed')),
  force_requested INTEGER NOT NULL DEFAULT 0 CHECK(force_requested IN (0,1)),
  media_count INTEGER NOT NULL DEFAULT 0 CHECK(media_count >= 0),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error TEXT
, media_insights_attempted INTEGER NOT NULL DEFAULT 0, media_insights_succeeded INTEGER NOT NULL DEFAULT 0, complete_metric_media INTEGER NOT NULL DEFAULT 0, missing_view_media INTEGER NOT NULL DEFAULT 0, missing_save_media INTEGER NOT NULL DEFAULT 0, missing_share_media INTEGER NOT NULL DEFAULT 0);

CREATE TABLE instagram_analytics_snapshots (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  reach INTEGER,
  follower_count INTEGER,
  accounts_engaged INTEGER,
  total_interactions INTEGER,
  profile_views INTEGER,
  website_clicks INTEGER,
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instagram_media_metric_observations (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  permalink TEXT,
  media_type TEXT,
  media_product_type TEXT,
  published_at TEXT,
  like_count INTEGER,
  comments_count INTEGER,
  view_count INTEGER,
  saved_count INTEGER,
  shares_count INTEGER,
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'instagram_api' CHECK(source IN ('instagram_api','creator_import')),
  UNIQUE(creator_id, media_id, collected_at)
);

CREATE TABLE instagram_media_metrics (
  creator_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  permalink TEXT,
  media_type TEXT,
  media_product_type TEXT,
  published_at TEXT,
  like_count INTEGER,
  comments_count INTEGER,
  view_count INTEGER,
  saved_count INTEGER,
  shares_count INTEGER,
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id, media_id)
);

CREATE TABLE instagram_reply_drafts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','approved','sending','sent','failed','uncertain','cancelled')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  provider_message_id TEXT,
  error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instagram_sync_state (
  creator_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  last_messages_sync_at TEXT,
  last_analytics_sync_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE media_fetch_tickets (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('instagram_container','telegram_private_download')),
  platform TEXT NOT NULL CHECK(platform IN ('instagram','telegram')),
  receipt_correlation_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  max_fetches INTEGER NOT NULL DEFAULT 1 CHECK(max_fetches BETWEEN 1 AND 20),
  fetch_count INTEGER NOT NULL DEFAULT 0 CHECK(fetch_count >= 0),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('shared_post','story','image','video','audio','file')),
  external_url TEXT,
  object_key TEXT,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','unavailable','failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE(creator_id,message_id,source_key)
);

CREATE TABLE message_threads (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  external_thread_id TEXT NOT NULL,
  participant_name TEXT NOT NULL DEFAULT '',
  participant_handle TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, participant_external_id TEXT NOT NULL DEFAULT '',
  UNIQUE(connection_id, external_thread_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  external_message_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  sender_type TEXT NOT NULL DEFAULT 'unknown',
  body TEXT NOT NULL,
  sent_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'observed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, external_message_id)
);

CREATE TABLE messaging_audit_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES messaging_connections(id) ON DELETE SET NULL,
  thread_id TEXT REFERENCES message_threads(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy')));

CREATE TABLE messaging_connections (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'observe' CHECK(mode IN ('observe','assist','operate')),
  read_enabled INTEGER NOT NULL DEFAULT 0 CHECK(read_enabled IN (0,1)),
  write_enabled INTEGER NOT NULL DEFAULT 0 CHECK(write_enabled IN (0,1)),
  outbound_validated INTEGER NOT NULL DEFAULT 0 CHECK(outbound_validated IN (0,1)),
  emergency_paused INTEGER NOT NULL DEFAULT 0 CHECK(emergency_paused IN (0,1)),
  status TEXT NOT NULL DEFAULT 'not_connected',
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, platform, display_name)
);

CREATE TABLE "migration_ledger_events" (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES "migration_ledger_runs"(id) ON DELETE RESTRICT,
  record_id TEXT REFERENCES "migration_ledger_records"(id) ON DELETE RESTRICT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'RUN_CREATED',
    'RECORD_PLANNED',
    'RECORD_APPLIED',
    'RECORD_SKIPPED',
    'RECORD_REJECTED',
    'VERIFICATION_PASSED',
    'VERIFICATION_FAILED',
    'KILL_SWITCH_BLOCKED'
  )),
  actor_identity TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "migration_ledger_records" (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES "migration_ledger_runs"(id) ON DELETE RESTRICT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_record_ref TEXT NOT NULL,
  source_record_checksum TEXT NOT NULL CHECK(length(source_record_checksum)=64),
  target_table TEXT,
  target_record_id TEXT,
  target_before_checksum TEXT CHECK(target_before_checksum IS NULL OR length(target_before_checksum)=64),
  target_after_checksum TEXT CHECK(target_after_checksum IS NULL OR length(target_after_checksum)=64),
  operation TEXT NOT NULL CHECK(operation IN ('INSERT','SKIP','ARCHIVE','MANUAL_REVIEW','VERIFY')),
  result TEXT NOT NULL CHECK(result IN ('PLANNED','APPLIED','SKIPPED','ARCHIVED','VERIFIED','FAILED','REJECTED')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, domain, source_table, source_record_ref)
);

CREATE TABLE "migration_ledger_runs" (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK(environment IN ('staging','production')),
  source_snapshot_label TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64),
  target_database_id TEXT NOT NULL,
  target_snapshot_sha256 TEXT NOT NULL CHECK(length(target_snapshot_sha256)=64),
  target_migration_state_sha256 TEXT NOT NULL CHECK(length(target_migration_state_sha256)=64),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  tool_git_sha TEXT NOT NULL,
  approval_ref TEXT NOT NULL,
  operator_identity TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, source_snapshot_sha256, manifest_sha256)
);

CREATE TABLE migration_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE onlyfans_delivery_controls (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','enabled','paused','emergency_stopped')),
  changed_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT, batch_delivery_verified_by TEXT COLLATE NOCASE REFERENCES users(email), batch_delivery_verified_at TEXT, delivery_mode TEXT NOT NULL DEFAULT 'supervised'
  CHECK(delivery_mode IN ('supervised','automatic')), minimum_bridge_version TEXT NOT NULL DEFAULT '0.22.0',
  PRIMARY KEY (creator_id, account_id)
);

CREATE TABLE onlyfans_upload_batches (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES onlyfans_upload_targets(id) ON DELETE RESTRICT,
  profile_id TEXT NOT NULL REFERENCES browser_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','paused','emergency_stopped','blocked','message_delivery_complete','vault_verified')),
  asset_count INTEGER NOT NULL CHECK(asset_count BETWEEN 1 AND 50),
  authorized_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  authorized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paused_by TEXT COLLATE NOCASE REFERENCES users(email),
  paused_at TEXT,
  stopped_by TEXT COLLATE NOCASE REFERENCES users(email),
  stopped_at TEXT,
  blocked_at TEXT,
  message_delivery_completed_at TEXT,
  vault_verified_by TEXT COLLATE NOCASE REFERENCES users(email),
  vault_verified_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE onlyfans_upload_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES onlyfans_upload_jobs(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE onlyfans_upload_jobs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES onlyfans_upload_targets(id) ON DELETE RESTRICT,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform='onlyfans'),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','claimed','attaching','send_authorized','staged','verified','failed','outcome_uncertain','cancelled')),
  approved_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  send_authorized_at TEXT,
  sent_at TEXT,
  completed_at TEXT,
  verified_by TEXT COLLATE NOCASE REFERENCES users(email),
  verified_at TEXT,
  error TEXT,
  receipt TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, send_authorized_by TEXT COLLATE NOCASE REFERENCES users(email), attachment_attempt_started_at TEXT, send_attempt_started_at TEXT, send_attempt_installation_id TEXT, message_verified_at TEXT, vault_verified_at TEXT, batch_id TEXT REFERENCES onlyfans_upload_batches(id) ON DELETE RESTRICT, batch_sequence INTEGER, asset_source_revision TEXT, frozen_media_key TEXT, frozen_media_sha256 TEXT, frozen_media_bytes INTEGER, frozen_media_content_type TEXT, media_staged_at TEXT, native_attachment_verified_at TEXT, awaiting_human_send_at TEXT, native_message_id TEXT, attempt_id TEXT,
  UNIQUE(creator_id,account_id,asset_id)
);

CREATE TABLE onlyfans_upload_targets (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES browser_profiles(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK(platform='onlyfans'),
  expected_recipient_handle TEXT NOT NULL,
  native_thread_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  configured_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  configured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by TEXT COLLATE NOCASE REFERENCES users(email),
  verified_at TEXT,
  revoked_by TEXT COLLATE NOCASE REFERENCES users(email),
  revoked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, account_id),
  UNIQUE(creator_id, native_thread_path),
  FOREIGN KEY (profile_id, creator_id) REFERENCES browser_profiles(id, creator_id) ON DELETE RESTRICT
);

CREATE TABLE operation_outbox (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('preview_dispatch','public_profile_publish','social_publish','message_send')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatching','delivered','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE operational_accounts (
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, account_kind TEXT NOT NULL DEFAULT 'social' CHECK(account_kind IN ('social','paid','other')), login_email TEXT NOT NULL DEFAULT '', profile_url TEXT NOT NULL DEFAULT '', account_purpose TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), connection_method TEXT NOT NULL DEFAULT 'not_configured', creator_visible INTEGER NOT NULL DEFAULT 1 CHECK(creator_visible IN (0,1)), administrator_notes TEXT NOT NULL DEFAULT '', native_identity_verified_at TEXT, pairing_state TEXT NOT NULL DEFAULT 'not_paired', bridge_last_seen_at TEXT, capabilities_json TEXT NOT NULL DEFAULT '[]', private_upload_destination TEXT NOT NULL DEFAULT '',
  UNIQUE(creator_id, platform, label)
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  stage_name TEXT,
  consent_status TEXT NOT NULL DEFAULT 'not_recorded',
  tagging_preference TEXT NOT NULL DEFAULT 'ask_each_time',
  private_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE premium_message_drafts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('fansly','onlyfans')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','claimed','sent','failed','cancelled')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  error TEXT,
  receipt TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE premium_thread_sync_state (
  thread_id TEXT PRIMARY KEY REFERENCES message_threads(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','complete','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_requested_at TEXT,
  last_completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_connection_attempts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  connected_account_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','expired')),
  expires_at TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_connections (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  connected_account_id TEXT NOT NULL,
  composio_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','expired','pending','failed')),
  external_account_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  identity_confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(creator_id, service)
);

CREATE TABLE public_link_conversion_receipts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  public_link_id TEXT NOT NULL,
  source TEXT NOT NULL,
  external_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('verified','rejected')),
  observed_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_reference)
);

CREATE TABLE reddit_bridge_tokens (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reddit_communities (
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, flairs_checked_at TEXT,
  UNIQUE(creator_id, name)
);

CREATE TABLE reddit_community_events (
  id TEXT PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES reddit_communities(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy')));

CREATE TABLE reddit_community_flairs (
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  community_id INTEGER NOT NULL REFERENCES reddit_communities(id) ON DELETE CASCADE,
  flair_id TEXT NOT NULL,
  flair_text TEXT NOT NULL,
  text_editable INTEGER NOT NULL DEFAULT 0 CHECK(text_editable IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (creator_id,community_id,flair_id)
);

CREATE TABLE scheduler_runs (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  error TEXT
);

CREATE TABLE "service_auth_activation_runs" (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment IN ('staging','production')),
  plan_sha256 TEXT NOT NULL CHECK(length(plan_sha256)=64),
  registry_sha256 TEXT NOT NULL CHECK(length(registry_sha256)=64),
  backup_receipt_sha256 TEXT NOT NULL CHECK(length(backup_receipt_sha256)=64),
  target_database_id TEXT NOT NULL,
  target_migration_state_sha256 TEXT NOT NULL CHECK(length(target_migration_state_sha256)=64),
  git_sha TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  operator_identity TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(environment, plan_sha256)
);

CREATE TABLE "service_auth_activation_steps" (
  id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES "service_auth_activation_runs"(id) ON DELETE RESTRICT,
  step TEXT NOT NULL CHECK(step IN ('PLANNED','SECRET_STAGED','D1_ACTIVE','VERIFIED','ACTIVE','FAILED','ROLLBACK_REQUIRED','REVOKED')),
  principal_name TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE service_auth_telemetry (
  id TEXT PRIMARY KEY,
  creator_id TEXT REFERENCES creators(id) ON DELETE RESTRICT,
  principal_name TEXT,
  auth_path TEXT NOT NULL CHECK(auth_path IN ('legacy','canonical')),
  capability TEXT,
  route TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('allowed','denied')),
  detail TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE service_creator_grants (
  service_credential_id TEXT NOT NULL REFERENCES service_credentials(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY (service_credential_id, creator_id)
);

CREATE TABLE service_credentials (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE service_principal_audit_events (
  id TEXT PRIMARY KEY,
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  credential_id TEXT REFERENCES service_principal_credentials(id) ON DELETE RESTRICT,
  creator_id TEXT REFERENCES creators(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE service_principal_creator_grants (
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY (service_principal_id, creator_id, capability)
);

CREATE TABLE service_principal_credentials (
  id TEXT PRIMARY KEY,
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE service_principals (
  id TEXT PRIMARY KEY,
  principal_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE social_post_events (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy')));

CREATE TABLE social_posts (
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, attempt_count INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, last_attempt_at TEXT, failure_reviewed_at TEXT, failure_reviewed_by TEXT, provider_container_id TEXT, provider_container_type TEXT, device_claimed_at TEXT, device_receipt TEXT NOT NULL DEFAULT '{}', reddit_flair_id TEXT, reddit_flair_text TEXT,
  UNIQUE(creator_id, platform, source_local_id)
);

CREATE TABLE source_media_consumer_capabilities (
  service_name TEXT PRIMARY KEY CHECK(service_name IN ('web','vault','instagram','reddit')),
  capability TEXT NOT NULL DEFAULT 'r2-source-v2' CHECK(capability='r2-source-v2'),
  status TEXT NOT NULL CHECK(status IN ('pending','compatible','blocked','revoked')),
  worker_version TEXT,
  evidence_sha256 TEXT CHECK(evidence_sha256 IS NULL OR length(evidence_sha256)=64),
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE telegram_bot_state (
  id TEXT PRIMARY KEY,
  next_update_id INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  last_polled_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE telegram_connector_state (
  creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  expected_bot_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_validation' CHECK(status IN ('pending_validation','connected','failed','revoked')),
  next_update_id INTEGER NOT NULL DEFAULT 0,
  identity_confirmed_at TEXT,
  last_polled_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE telegram_media_handoffs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_object_id TEXT NOT NULL REFERENCES asset_storage_objects(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('blocked','queued','sending','sent','failed','uncertain','cancelled')),
  provider_message_id TEXT,
  sha256 TEXT NOT NULL CHECK(sha256 GLOB '[0-9a-f]*' AND length(sha256)=64),
  byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(creator_id, asset_id, storage_object_id, idempotency_key)
);

CREATE TABLE telegram_poll_runs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  updates_seen INTEGER NOT NULL DEFAULT 0,
  messages_imported INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE telegram_send_log (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES messaging_connections(id) ON DELETE SET NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','cancelled')),
  provider_message_id TEXT,
  requested_by TEXT NOT NULL,
  error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, claimed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE tenant_integrity_exceptions (
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

CREATE TABLE users (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vault_bridge_tokens (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform='fansly'),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vault_credentials (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES operational_accounts(id) ON DELETE SET NULL,
  credential_group TEXT NOT NULL CHECK(credential_group IN ('social','paid','chrome','other')),
  label TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '', login_email TEXT NOT NULL DEFAULT '',
  wrapped_dek BLOB NOT NULL, wrapped_dek_nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL, ciphertext_nonce BLOB NOT NULL,
  key_version INTEGER NOT NULL CHECK(key_version > 0),
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  shared_with_creator INTEGER NOT NULL DEFAULT 0 CHECK(shared_with_creator IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  last_native_password_confirmation_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE(id,creator_id)
);

CREATE TABLE vault_pin_verifiers (
  id TEXT PRIMARY KEY,
  identity_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
  creator_id TEXT REFERENCES creators(id) ON DELETE CASCADE,
  pin_scope TEXT NOT NULL CHECK(pin_scope IN ('creator','administrator')),
  salt BLOB NOT NULL, verifier BLOB NOT NULL, kdf_iterations INTEGER NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0, failure_cycles INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((pin_scope='creator' AND creator_id IS NOT NULL) OR (pin_scope='administrator' AND creator_id IS NULL)),
  UNIQUE(identity_email,creator_id,pin_scope)
);

CREATE TABLE vault_step_up_sessions (
  id TEXT PRIMARY KEY,
  identity_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('agency_admin','operator','creator')),
  pin_scope TEXT NOT NULL CHECK(pin_scope IN ('creator','administrator')),
  expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vault_upload_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES vault_upload_jobs(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, actor_role TEXT NOT NULL DEFAULT 'legacy'
  CHECK(actor_role IN ('agency_admin','operator','creator','viewer','service','legacy')));

CREATE TABLE vault_upload_jobs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES operational_accounts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('fansly','myroomz')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','claimed','staged','verified','failed','cancelled')),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  completed_at TEXT,
  error TEXT,
  receipt TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX asset_classification_events_creator_asset
  ON asset_classification_events(creator_id,asset_id,created_at DESC);

CREATE INDEX asset_classifications_creator_safety
  ON asset_classifications(creator_id, safety, is_teaser, is_multi);

CREATE INDEX asset_destinations_creator_destination
  ON asset_destinations(creator_id, destination, asset_id);

CREATE INDEX asset_ingest_parts_session_status
  ON asset_ingest_parts(session_id,status,part_number);

CREATE INDEX asset_ingest_sessions_expiry
  ON asset_ingest_sessions(status, expires_at);

CREATE INDEX asset_ingest_sessions_finalization
  ON asset_ingest_sessions(finalization_state,updated_at);

CREATE INDEX asset_people_creator_asset
  ON asset_people(creator_id, asset_id);

CREATE INDEX asset_preview_jobs_creator_status
  ON asset_preview_jobs(creator_id, status, updated_at DESC);

CREATE INDEX asset_storage_objects_asset_source_revision
  ON asset_storage_objects(creator_id, asset_id, source_provider, source_revision, sha256);

CREATE INDEX asset_storage_objects_creator_asset_status
  ON asset_storage_objects(creator_id, asset_id, storage_role, ingest_status, updated_at DESC);

CREATE INDEX assets_creator_available_modified
  ON assets(creator_id, source_available, modified_at DESC);

CREATE UNIQUE INDEX assets_id_creator_pair
  ON assets(id, creator_id);

CREATE INDEX bridge_credentials_scope
  ON bridge_credentials(creator_id, account_id, profile_id, platform, status, expires_at);

CREATE INDEX creator_access_audit_scope ON creator_access_audit_events(creator_id,created_at DESC);

CREATE INDEX creator_adult_profile_media_render
  ON creator_adult_profile_media(profile_version_id, enabled, sort_order);

CREATE INDEX creator_exceptions_open_scope
  ON creator_exceptions(creator_id, status, severity, last_observed_at DESC);

CREATE INDEX creator_media_source_cutover_receipts_creator_created
  ON creator_media_source_cutover_receipts(creator_id,created_at DESC);

CREATE INDEX creator_media_source_events_creator_created
  ON creator_media_source_events(creator_id,created_at DESC);

CREATE INDEX creator_memberships_user
  ON creator_memberships(user_email, status, creator_id);

CREATE INDEX creator_onboarding_receipts_creator_created
  ON creator_onboarding_receipts(creator_id, created_at DESC);

CREATE UNIQUE INDEX creator_profile_image_attachment_active_adult_role
  ON creator_profile_image_attachments(creator_id,adult_profile_version_id,image_role)
  WHERE status='attached' AND surface='adult_profile';

CREATE UNIQUE INDEX creator_profile_image_attachment_active_public_role
  ON creator_profile_image_attachments(creator_id,public_profile_version_id,image_role)
  WHERE status='attached' AND surface='public_sfw';

CREATE INDEX creator_profile_projection_deliveries_pending
  ON creator_profile_projection_deliveries(status, updated_at);

CREATE INDEX creator_public_link_revisions_redirect
  ON creator_public_link_revisions(profile_version_id, link_id, enabled);

CREATE INDEX creator_public_links_version_order
  ON creator_public_links(profile_version_id, sort_order);

CREATE INDEX creator_public_profile_publications_creator_created
  ON creator_public_profile_publications(creator_id, created_at DESC);

CREATE INDEX creator_public_profile_versions_profile_status
  ON creator_public_profile_versions(profile_id, status, version_number DESC);

CREATE INDEX creator_source_media_readiness_creator_status
  ON creator_source_media_consumer_readiness(creator_id,status,service_name);

CREATE INDEX external_operation_receipts_reconcile
  ON external_operation_receipts(provider, status, updated_at);

CREATE INDEX finance_audit_creator_time
  ON finance_audit_events(creator_id, created_at DESC);

CREATE INDEX finance_daily_metrics_creator_period
  ON finance_daily_metrics(creator_id, period_date DESC, platform, currency);

CREATE INDEX finance_imports_creator_time
  ON finance_imports(creator_id, imported_at DESC);

CREATE INDEX identity_audit_creator_created
  ON identity_audit_events(creator_id, created_at DESC);

CREATE INDEX idx_instagram_analytics_creator_time
  ON instagram_analytics_snapshots (creator_id, collected_at DESC);

CREATE INDEX idx_message_attachments_message
  ON message_attachments(creator_id,message_id,status);

CREATE INDEX idx_reddit_community_events_community_created
  ON reddit_community_events(community_id, created_at DESC);

CREATE INDEX idx_reddit_community_events_creator_created
  ON reddit_community_events(creator_id, created_at DESC);

CREATE INDEX instagram_analytics_collection_runs_creator_time
  ON instagram_analytics_collection_runs(creator_id, started_at DESC);

CREATE UNIQUE INDEX instagram_analytics_collection_runs_one_active
  ON instagram_analytics_collection_runs(creator_id)
  WHERE status='running';

CREATE INDEX instagram_analytics_collection_runs_recovery
  ON instagram_analytics_collection_runs(status, started_at, creator_id);

CREATE INDEX instagram_media_metric_observations_time
  ON instagram_media_metric_observations(creator_id, media_id, collected_at DESC);

CREATE INDEX instagram_reply_drafts_creator_thread_time
  ON instagram_reply_drafts(creator_id, thread_id, created_at DESC);

CREATE UNIQUE INDEX instagram_reply_drafts_one_active_body
  ON instagram_reply_drafts(creator_id, thread_id, body)
  WHERE status IN ('draft','approved','sending');

CREATE INDEX media_fetch_tickets_lookup
  ON media_fetch_tickets(token_hash, expires_at, revoked_at);

CREATE INDEX message_threads_creator_activity
  ON message_threads(creator_id, last_message_at DESC, updated_at DESC);

CREATE INDEX messages_creator_thread_time
  ON messages(creator_id, thread_id, sent_at, created_at);

CREATE INDEX messaging_audit_creator_time
  ON messaging_audit_events(creator_id, created_at DESC);

CREATE INDEX messaging_connections_creator_platform
  ON messaging_connections(creator_id, platform, status);

CREATE INDEX migration_ledger_events_run_created
  ON migration_ledger_events(run_id, created_at DESC);

CREATE INDEX migration_ledger_records_creator_domain_created
  ON migration_ledger_records(creator_id, domain, created_at DESC);

CREATE INDEX migration_ledger_runs_creator_created
  ON migration_ledger_runs(creator_id, created_at DESC);

CREATE INDEX onlyfans_upload_batches_scope_queue
  ON onlyfans_upload_batches(creator_id,account_id,profile_id,status,created_at);

CREATE INDEX onlyfans_upload_events_scope ON onlyfans_upload_events(creator_id,job_id,created_at);

CREATE INDEX onlyfans_upload_jobs_authorized_queue
  ON onlyfans_upload_jobs(creator_id,account_id,status,send_authorized_at,created_at);

CREATE INDEX onlyfans_upload_jobs_batch_queue
  ON onlyfans_upload_jobs(batch_id,batch_sequence,status,created_at);

CREATE INDEX onlyfans_upload_jobs_frozen_media
  ON onlyfans_upload_jobs(creator_id,account_id,status,frozen_media_key);

CREATE INDEX onlyfans_upload_jobs_queue ON onlyfans_upload_jobs(creator_id,account_id,status,created_at);

CREATE INDEX onlyfans_upload_targets_scope ON onlyfans_upload_targets(creator_id,account_id,status);

CREATE INDEX operation_outbox_creator_created
  ON operation_outbox(creator_id, created_at DESC);

CREATE INDEX operation_outbox_dispatch
  ON operation_outbox(operation_type, status, next_attempt_at, created_at);

CREATE INDEX operational_accounts_creator_platform
  ON operational_accounts(creator_id, platform);

CREATE UNIQUE INDEX operational_accounts_id_creator_pair
  ON operational_accounts(id, creator_id);

CREATE UNIQUE INDEX operational_accounts_one_fansly_per_creator
  ON operational_accounts(creator_id)
  WHERE platform='fansly';

CREATE UNIQUE INDEX people_id_creator_pair
  ON people(id, creator_id);

CREATE INDEX premium_message_drafts_creator_thread
  ON premium_message_drafts(creator_id,thread_id,created_at DESC);

CREATE INDEX provider_connection_attempts_pending
  ON provider_connection_attempts(creator_id, service, status, expires_at);

CREATE INDEX reddit_bridge_tokens_lookup
  ON reddit_bridge_tokens(token_hash,status,expires_at);

CREATE UNIQUE INDEX reddit_communities_id_creator_pair
  ON reddit_communities(id, creator_id);

CREATE INDEX reddit_community_flairs_available
  ON reddit_community_flairs(creator_id,community_id,active,flair_text);

CREATE INDEX service_auth_activation_steps_run_created
  ON service_auth_activation_steps(activation_id, created_at DESC);

CREATE INDEX service_auth_telemetry_creator_observed
  ON service_auth_telemetry(creator_id, observed_at DESC);

CREATE INDEX service_auth_telemetry_path_observed
  ON service_auth_telemetry(auth_path, observed_at DESC);

CREATE INDEX service_creator_grants_creator
  ON service_creator_grants(creator_id, status, service_credential_id);

CREATE INDEX service_principal_audit_events_principal_created
  ON service_principal_audit_events(service_principal_id, created_at DESC);

CREATE INDEX service_principal_creator_grants_scope
  ON service_principal_creator_grants(creator_id, capability, status, service_principal_id);

CREATE INDEX service_principal_credentials_lookup
  ON service_principal_credentials(service_principal_id, status, expires_at);

CREATE INDEX social_post_events_creator_post
  ON social_post_events(creator_id, post_id, created_at DESC);

CREATE INDEX social_posts_creator_failure_review
  ON social_posts(creator_id, platform, status, failure_reviewed_at);

CREATE INDEX social_posts_creator_platform_status
  ON social_posts(creator_id, platform, status, scheduled_at);

CREATE UNIQUE INDEX social_posts_id_creator_pair
  ON social_posts(id, creator_id);

CREATE INDEX telegram_media_handoffs_creator_status
  ON telegram_media_handoffs(creator_id, status, created_at DESC);

CREATE INDEX telegram_poll_runs_creator_time
  ON telegram_poll_runs(creator_id, started_at DESC);

CREATE INDEX telegram_send_log_creator_time
  ON telegram_send_log(creator_id, created_at DESC);

CREATE INDEX vault_bridge_tokens_lookup
  ON vault_bridge_tokens(token_hash,status,expires_at);

CREATE INDEX vault_credentials_creator_account ON vault_credentials(creator_id,account_id,status);

CREATE INDEX vault_credentials_creator_group ON vault_credentials(creator_id,credential_group,status,updated_at DESC);

CREATE UNIQUE INDEX vault_pin_admin_identity ON vault_pin_verifiers(identity_email) WHERE pin_scope='administrator';

CREATE UNIQUE INDEX vault_pin_creator_identity ON vault_pin_verifiers(identity_email,creator_id) WHERE pin_scope='creator';

CREATE INDEX vault_step_up_scope ON vault_step_up_sessions(identity_email,creator_id,expires_at);

CREATE UNIQUE INDEX vault_upload_jobs_active_asset
  ON vault_upload_jobs(creator_id,account_id,asset_id)
  WHERE status IN ('approved','claimed','staged','verified');

CREATE INDEX vault_upload_jobs_queue
  ON vault_upload_jobs(creator_id,platform,status,created_at);

CREATE TRIGGER asset_classification_actor_role_contract_insert
BEFORE INSERT ON asset_classification_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER asset_classification_actor_role_contract_update
BEFORE UPDATE ON asset_classification_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER asset_classifications_asset_creator_insert
BEFORE INSERT ON asset_classifications
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_creator_mismatch');
END;

CREATE TRIGGER asset_classifications_asset_creator_update
BEFORE UPDATE OF asset_id, creator_id ON asset_classifications
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_creator_mismatch');
END;

CREATE TRIGGER asset_classifications_teaser_creator_insert
BEFORE INSERT ON asset_classifications
WHEN NEW.teaser_for_asset_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.teaser_for_asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_teaser_creator_mismatch');
END;

CREATE TRIGGER asset_classifications_teaser_creator_update
BEFORE UPDATE OF teaser_for_asset_id, creator_id ON asset_classifications
WHEN NEW.teaser_for_asset_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.teaser_for_asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_classification_teaser_creator_mismatch');
END;

CREATE TRIGGER asset_destinations_asset_creator_insert
BEFORE INSERT ON asset_destinations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_destination_creator_mismatch');
END;

CREATE TRIGGER asset_destinations_asset_creator_update
BEFORE UPDATE OF asset_id, creator_id ON asset_destinations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_destination_creator_mismatch');
END;

CREATE TRIGGER asset_ingest_part_creator_scope_insert
BEFORE INSERT ON asset_ingest_parts
WHEN NOT EXISTS (
  SELECT 1 FROM asset_ingest_sessions s
  WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'asset_ingest_part_creator_mismatch'); END;

CREATE TRIGGER asset_ingest_part_creator_scope_update
BEFORE UPDATE OF session_id,creator_id ON asset_ingest_parts
WHEN NOT EXISTS (
  SELECT 1 FROM asset_ingest_sessions s
  WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'asset_ingest_part_creator_mismatch'); END;

CREATE TRIGGER asset_ingest_session_creator_scope_insert
BEFORE INSERT ON asset_ingest_sessions
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR (NEW.storage_object_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id))
BEGIN SELECT RAISE(ABORT,'asset_ingest_session_creator_mismatch'); END;

CREATE TRIGGER asset_ingest_session_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id ON asset_ingest_sessions
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR (NEW.storage_object_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id))
BEGIN SELECT RAISE(ABORT,'asset_ingest_session_creator_mismatch'); END;

CREATE TRIGGER asset_paid_consent_creator_insert
BEFORE INSERT ON asset_paid_consent_attestations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_paid_consent_creator_mismatch');
END;

CREATE TRIGGER asset_paid_consent_creator_update
BEFORE UPDATE OF asset_id, person_id, creator_id ON asset_paid_consent_attestations
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_paid_consent_creator_mismatch');
END;

CREATE TRIGGER asset_people_creator_insert
BEFORE INSERT ON asset_people
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_person_creator_mismatch');
END;

CREATE TRIGGER asset_people_creator_update
BEFORE UPDATE OF asset_id, person_id, creator_id ON asset_people
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'asset_person_creator_mismatch');
END;

CREATE TRIGGER asset_storage_object_creator_scope_insert
BEFORE INSERT ON asset_storage_objects
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'asset_storage_object_creator_mismatch'); END;

CREATE TRIGGER asset_storage_object_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id ON asset_storage_objects
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'asset_storage_object_creator_mismatch'); END;

CREATE TRIGGER asset_storage_object_r2_identity_insert
BEFORE INSERT ON asset_storage_objects
WHEN NEW.provider='r2' AND NEW.ingest_status='verified'
  AND (NEW.r2_version IS NULL OR length(NEW.r2_version)=0 OR NEW.r2_etag IS NULL OR length(NEW.r2_etag)=0)
BEGIN SELECT RAISE(ABORT,'verified_r2_identity_required'); END;

CREATE TRIGGER asset_storage_object_r2_identity_update
BEFORE UPDATE OF provider,ingest_status,r2_version,r2_etag ON asset_storage_objects
WHEN NEW.provider='r2' AND NEW.ingest_status='verified'
  AND (NEW.r2_version IS NULL OR length(NEW.r2_version)=0 OR NEW.r2_etag IS NULL OR length(NEW.r2_etag)=0)
BEGIN SELECT RAISE(ABORT,'verified_r2_identity_required'); END;

CREATE TRIGGER creator_access_audit_actor_scope BEFORE INSERT ON creator_access_audit_events
WHEN NOT EXISTS (SELECT 1 FROM creator_memberships WHERE creator_id=NEW.creator_id AND lower(user_email)=lower(NEW.actor_email) AND role=NEW.actor_role AND status='active')
BEGIN SELECT RAISE(ABORT,'creator_access_audit_actor_scope_invalid'); END;

CREATE TRIGGER creator_access_audit_immutable_delete BEFORE DELETE ON creator_access_audit_events BEGIN SELECT RAISE(ABORT,'creator_access_audit_append_only'); END;

CREATE TRIGGER creator_access_audit_immutable_update BEFORE UPDATE ON creator_access_audit_events BEGIN SELECT RAISE(ABORT,'creator_access_audit_append_only'); END;

CREATE TRIGGER creator_adult_link_revision_draft_only
BEFORE INSERT ON creator_adult_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_link_revision_requires_draft_version'); END;

CREATE TRIGGER creator_adult_link_revision_draft_update_only
BEFORE UPDATE ON creator_adult_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_link_revision_requires_draft_version'); END;

CREATE TRIGGER creator_adult_media_requires_release
BEFORE INSERT ON creator_adult_profile_media
WHEN NOT EXISTS (
  SELECT 1 FROM creator_adult_profile_versions v
  JOIN assets a ON a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1
  JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id AND c.safety='nsfw'
  JOIN creator_media_release_attestations r ON r.asset_id=a.id AND r.creator_id=a.creator_id AND r.surface='adult_profile' AND r.status='approved'
  WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft'
    AND NOT EXISTS (
      SELECT 1 FROM asset_people ap
      LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
      WHERE ap.asset_id=a.id AND ap.creator_id=a.creator_id AND pc.person_id IS NULL
    )
)
BEGIN SELECT RAISE(ABORT,'adult_media_requires_approved_release'); END;

CREATE TRIGGER creator_adult_media_requires_release_update
BEFORE UPDATE OF asset_id,profile_version_id,derivative_object_key,enabled ON creator_adult_profile_media
WHEN NOT EXISTS (
  SELECT 1 FROM creator_adult_profile_versions v
  JOIN assets a ON a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1
  JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id AND c.safety='nsfw'
  JOIN creator_media_release_attestations r ON r.asset_id=a.id AND r.creator_id=a.creator_id AND r.surface='adult_profile' AND r.status='approved'
  WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft'
    AND NOT EXISTS (
      SELECT 1 FROM asset_people ap
      LEFT JOIN asset_paid_consent_attestations pc ON pc.asset_id=ap.asset_id AND pc.creator_id=ap.creator_id AND pc.person_id=ap.person_id AND pc.revoked_at IS NULL
      WHERE ap.asset_id=a.id AND ap.creator_id=a.creator_id AND pc.person_id IS NULL
    )
)
BEGIN SELECT RAISE(ABORT,'adult_media_requires_approved_release'); END;

CREATE TRIGGER creator_adult_profile_appearance_draft_only
BEFORE INSERT ON creator_adult_profile_appearances
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_profile_appearance_requires_draft_version'); END;

CREATE TRIGGER creator_adult_profile_appearance_draft_update_only
BEFORE UPDATE ON creator_adult_profile_appearances
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_profile_appearance_requires_draft_version'); END;

CREATE TRIGGER creator_adult_profile_publication_scope
BEFORE INSERT ON creator_adult_profile_publications
WHEN NOT EXISTS (
  SELECT 1
  FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v
    ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'adult_profile_publication_scope_invalid'); END;

CREATE TRIGGER creator_adult_profile_publication_scope_update
BEFORE UPDATE OF profile_id, creator_id, version_id ON creator_adult_profile_publications
WHEN NOT EXISTS (
  SELECT 1
  FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v
    ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)
BEGIN SELECT RAISE(ABORT,'adult_profile_publication_scope_invalid'); END;

CREATE TRIGGER creator_adult_profile_published_version
BEFORE UPDATE OF published_version_id,status ON creator_adult_profiles
WHEN NEW.published_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM creator_adult_profile_versions v
  WHERE v.id=NEW.published_version_id AND v.profile_id=NEW.id AND v.creator_id=NEW.creator_id AND v.status IN ('approved','published')
)
BEGIN SELECT RAISE(ABORT,'adult_profile_requires_approved_version'); END;

CREATE TRIGGER creator_adult_profile_single_draft
BEFORE INSERT ON creator_adult_profile_versions
WHEN NEW.status='draft' AND EXISTS (SELECT 1 FROM creator_adult_profile_versions v WHERE v.profile_id=NEW.profile_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'adult_profile_already_has_a_draft'); END;

CREATE TRIGGER creator_adult_profile_version_creator_scope
BEFORE INSERT ON creator_adult_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'adult_profile_version_creator_mismatch'); END;

CREATE TRIGGER creator_adult_profile_version_creator_scope_update
BEFORE UPDATE OF profile_id, creator_id ON creator_adult_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_adult_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'adult_profile_version_creator_mismatch'); END;

CREATE TRIGGER creator_adult_profile_version_immutable
BEFORE UPDATE OF adult_bio,content_checksum ON creator_adult_profile_versions
WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'adult_profile_version_is_immutable'); END;

CREATE TRIGGER creator_adult_profile_version_no_draft_reopen
BEFORE UPDATE OF status ON creator_adult_profile_versions
WHEN OLD.status<>'draft' AND NEW.status='draft'
BEGIN SELECT RAISE(ABORT,'adult_profile_version_cannot_reopen_draft'); END;

CREATE TRIGGER creator_adult_profile_version_requires_approval
BEFORE UPDATE OF status,approved_by,approved_at ON creator_adult_profile_versions
WHEN OLD.status='draft' AND NEW.status IN ('approved','published') AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL)
BEGIN SELECT RAISE(ABORT,'adult_profile_version_requires_explicit_approval'); END;

CREATE TRIGGER creator_media_source_event_creator_scope_insert
BEFORE INSERT ON creator_media_source_events
WHEN (NEW.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id))
  OR (NEW.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_ingest_sessions s WHERE s.id=NEW.session_id AND s.creator_id=NEW.creator_id))
BEGIN SELECT RAISE(ABORT,'creator_media_source_event_creator_mismatch'); END;

CREATE TRIGGER creator_media_source_state_creator_insert
AFTER INSERT ON creators
BEGIN
  INSERT OR IGNORE INTO creator_media_source_states (creator_id,active_backend,migration_state,dropbox_fallback_enabled)
  VALUES (NEW.id,'dropbox','dropbox',1);
END;

CREATE TRIGGER creator_memberships_creator_workspace_insert
BEFORE INSERT ON creator_memberships
WHEN NEW.status='active' AND NEW.role='creator' AND EXISTS (
  SELECT 1 FROM creator_memberships
  WHERE lower(user_email)=lower(NEW.user_email)
    AND status='active'
    AND creator_id<>NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT, 'creator_identity_must_be_single_workspace');
END;

CREATE TRIGGER creator_memberships_creator_workspace_update
BEFORE UPDATE OF role,status ON creator_memberships
WHEN NEW.status='active' AND NEW.role='creator' AND EXISTS (
  SELECT 1 FROM creator_memberships
  WHERE lower(user_email)=lower(NEW.user_email)
    AND status='active'
    AND creator_id<>NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT, 'creator_identity_must_be_single_workspace');
END;

CREATE TRIGGER creator_memberships_staff_class_insert
BEFORE INSERT ON creator_memberships
WHEN NEW.status='active' AND NEW.role<>'creator' AND EXISTS (
  SELECT 1 FROM creator_memberships
  WHERE lower(user_email)=lower(NEW.user_email)
    AND status='active'
    AND role='creator'
    AND creator_id<>NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT, 'creator_identity_cannot_be_staff');
END;

CREATE TRIGGER creator_memberships_staff_class_update
BEFORE UPDATE OF role,status ON creator_memberships
WHEN NEW.status='active' AND NEW.role<>'creator' AND EXISTS (
  SELECT 1 FROM creator_memberships
  WHERE lower(user_email)=lower(NEW.user_email)
    AND status='active'
    AND role='creator'
    AND creator_id<>NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT, 'creator_identity_cannot_be_staff');
END;

CREATE TRIGGER creator_profile_image_attachment_draft_only
BEFORE INSERT ON creator_profile_image_attachments
WHEN (NEW.surface='public_sfw' AND NOT EXISTS (SELECT 1 FROM creator_public_profile_versions WHERE id=NEW.public_profile_version_id AND creator_id=NEW.creator_id AND status='draft'))
  OR (NEW.surface='adult_profile' AND NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions WHERE id=NEW.adult_profile_version_id AND creator_id=NEW.creator_id AND status='draft'))
BEGIN SELECT RAISE(ABORT,'profile_image_attachment_requires_draft'); END;

CREATE TRIGGER creator_profile_image_attachment_draft_update_only
BEFORE UPDATE OF creator_id, surface, image_role, public_profile_version_id, adult_profile_version_id, derivative_id, status
ON creator_profile_image_attachments
WHEN (NEW.surface='public_sfw' AND NOT EXISTS (SELECT 1 FROM creator_public_profile_versions WHERE id=NEW.public_profile_version_id AND creator_id=NEW.creator_id AND status='draft'))
  OR (NEW.surface='adult_profile' AND NOT EXISTS (SELECT 1 FROM creator_adult_profile_versions WHERE id=NEW.adult_profile_version_id AND creator_id=NEW.creator_id AND status='draft'))
BEGIN SELECT RAISE(ABORT,'profile_image_detach_requires_draft'); END;

CREATE TRIGGER creator_profile_image_attachment_scope
BEFORE INSERT ON creator_profile_image_attachments
WHEN NOT EXISTS (
  SELECT 1 FROM creator_profile_image_derivatives d
  JOIN creator_profile_image_uploads u ON u.id=d.upload_id AND u.creator_id=d.creator_id
  WHERE d.id=NEW.derivative_id AND d.creator_id=NEW.creator_id AND d.derivative_kind='display'
    AND u.surface=NEW.surface AND u.image_role=NEW.image_role AND u.status='processed'
)
BEGIN SELECT RAISE(ABORT,'profile_image_attachment_scope_invalid'); END;

CREATE TRIGGER creator_profile_image_attachment_scope_update
BEFORE UPDATE OF creator_id, surface, image_role, public_profile_version_id, adult_profile_version_id, derivative_id, status
ON creator_profile_image_attachments
WHEN NOT EXISTS (
  SELECT 1 FROM creator_profile_image_derivatives d
  JOIN creator_profile_image_uploads u ON u.id=d.upload_id AND u.creator_id=d.creator_id
  WHERE d.id=NEW.derivative_id AND d.creator_id=NEW.creator_id AND d.derivative_kind='display'
    AND u.surface=NEW.surface AND u.image_role=NEW.image_role AND u.status='processed'
)
BEGIN SELECT RAISE(ABORT,'profile_image_attachment_scope_invalid'); END;

CREATE TRIGGER creator_profile_projection_delivery_scope_insert
BEFORE INSERT ON creator_profile_projection_deliveries
WHEN (NEW.surface='public_sfw' AND NOT EXISTS (
  SELECT 1 FROM creator_public_profiles p
  JOIN creator_public_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)) OR (NEW.surface='adult_profile' AND NOT EXISTS (
  SELECT 1 FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
))
BEGIN SELECT RAISE(ABORT,'creator_profile_projection_delivery_scope_invalid'); END;

CREATE TRIGGER creator_profile_projection_delivery_scope_update
BEFORE UPDATE OF creator_id, surface, profile_id, version_id ON creator_profile_projection_deliveries
WHEN (NEW.surface='public_sfw' AND NOT EXISTS (
  SELECT 1 FROM creator_public_profiles p
  JOIN creator_public_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
)) OR (NEW.surface='adult_profile' AND NOT EXISTS (
  SELECT 1 FROM creator_adult_profiles p
  JOIN creator_adult_profile_versions v ON v.id=NEW.version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
  WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id
))
BEGIN SELECT RAISE(ABORT,'creator_profile_projection_delivery_scope_invalid'); END;

CREATE TRIGGER creator_public_contact_method_draft_only
BEFORE INSERT ON creator_public_contact_methods
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_contact_requires_draft_version'); END;

CREATE TRIGGER creator_public_contact_method_draft_update_only
BEFORE UPDATE ON creator_public_contact_methods
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_contact_requires_draft_version'); END;

CREATE TRIGGER creator_public_link_revision_draft_only
BEFORE INSERT ON creator_public_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_link_revision_requires_draft_version'); END;

CREATE TRIGGER creator_public_link_revision_draft_update_only
BEFORE UPDATE ON creator_public_link_revisions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_link_revision_requires_draft_version'); END;

CREATE TRIGGER creator_public_links_version_creator_insert
BEFORE INSERT ON creator_public_links
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN
  SELECT RAISE(ABORT, 'public_link_requires_draft_version_for_creator');
END;

CREATE TRIGGER creator_public_links_version_creator_update
BEFORE UPDATE OF profile_version_id, creator_id, label, destination_url, destination_host, sort_order ON creator_public_links
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN
  SELECT RAISE(ABORT, 'public_link_requires_draft_version_for_creator');
END;

CREATE TRIGGER creator_public_media_sfw_asset_insert
BEFORE INSERT ON creator_public_media
WHEN NOT EXISTS (SELECT 1 FROM assets a JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
                 WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1 AND c.safety='sfw')
BEGIN
  SELECT RAISE(ABORT, 'public_media_requires_approved_sfw_asset');
END;

CREATE TRIGGER creator_public_media_sfw_asset_update
BEFORE UPDATE OF asset_id, creator_id ON creator_public_media
WHEN NOT EXISTS (SELECT 1 FROM assets a JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
                 WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id AND a.source_available=1 AND c.safety='sfw')
BEGIN
  SELECT RAISE(ABORT, 'public_media_requires_approved_sfw_asset');
END;

CREATE TRIGGER creator_public_profile_details_draft_only
BEFORE INSERT ON creator_public_profile_details
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.profile_version_id AND v.creator_id=NEW.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_profile_details_require_draft_version'); END;

CREATE TRIGGER creator_public_profile_details_draft_update_only
BEFORE UPDATE ON creator_public_profile_details
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=OLD.profile_version_id AND v.creator_id=OLD.creator_id AND v.status='draft')
BEGIN SELECT RAISE(ABORT,'public_profile_details_require_draft_version'); END;

CREATE TRIGGER creator_public_profile_publication_creator_insert
BEFORE INSERT ON creator_public_profile_publications
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.version_id AND v.profile_id=NEW.profile_id AND v.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_publication_creator_mismatch');
END;

CREATE TRIGGER creator_public_profile_published_version
BEFORE UPDATE OF published_version_id, status ON creator_public_profiles
WHEN NEW.published_version_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM creator_public_profile_versions v WHERE v.id=NEW.published_version_id AND v.profile_id=NEW.id AND v.creator_id=NEW.creator_id AND v.status IN ('approved','published'))
BEGIN
  SELECT RAISE(ABORT, 'public_profile_requires_approved_version');
END;

CREATE TRIGGER creator_public_profile_single_draft
BEFORE INSERT ON creator_public_profile_versions
WHEN NEW.status='draft'
 AND EXISTS (
   SELECT 1 FROM creator_public_profile_versions v
   WHERE v.profile_id=NEW.profile_id AND v.creator_id=NEW.creator_id AND v.status='draft'
 )
BEGIN
  SELECT RAISE(ABORT, 'public_profile_already_has_a_draft_version');
END;

CREATE TRIGGER creator_public_profile_slug_immutable_after_publication
BEFORE UPDATE OF slug ON creator_public_profiles
WHEN OLD.published_version_id IS NOT NULL AND NEW.slug<>OLD.slug
BEGIN
  SELECT RAISE(ABORT, 'public_profile_slug_is_immutable_after_publication');
END;

CREATE TRIGGER creator_public_profile_version_no_reopen
BEFORE UPDATE OF status ON creator_public_profile_versions
WHEN OLD.status<>'draft' AND NEW.status='draft'
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_cannot_return_to_draft');
END;

CREATE TRIGGER creator_source_media_readiness_creator_insert
AFTER INSERT ON creators
BEGIN
  INSERT OR IGNORE INTO creator_source_media_consumer_readiness (creator_id,service_name,status,reason_code)
  VALUES
    (NEW.id,'web','pending','awaiting_creator_coverage'),
    (NEW.id,'vault','blocked','consumer_not_verified'),
    (NEW.id,'instagram','blocked','consumer_not_verified'),
    (NEW.id,'reddit','blocked','consumer_not_verified');
END;

CREATE TRIGGER external_operation_receipt_creator_insert
BEFORE INSERT ON external_operation_receipts
WHEN NOT EXISTS (SELECT 1 FROM operation_outbox o WHERE o.id=NEW.operation_id AND o.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'external_operation_receipt_creator_mismatch');
END;

CREATE TRIGGER external_operation_receipt_creator_update
BEFORE UPDATE OF operation_id, creator_id ON external_operation_receipts
WHEN NOT EXISTS (SELECT 1 FROM operation_outbox o WHERE o.id=NEW.operation_id AND o.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'external_operation_receipt_creator_mismatch');
END;

CREATE TRIGGER identity_audit_actor_role_contract_insert
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER identity_audit_actor_role_contract_update
BEFORE UPDATE ON identity_audit_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER identity_audit_creator_required
BEFORE INSERT ON identity_audit_events
WHEN NEW.creator_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'audit_effective_creator_required');
END;

CREATE TRIGGER identity_audit_human_scope
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role NOT IN ('service','legacy') AND NOT EXISTS (
  SELECT 1 FROM creator_memberships m
  JOIN users u ON lower(u.email)=lower(m.user_email)
  WHERE m.creator_id=NEW.creator_id
    AND lower(m.user_email)=lower(NEW.actor_email)
    AND m.role=NEW.actor_role
    AND m.status='active'
    AND u.status='active'
)
BEGIN
  SELECT RAISE(ABORT, 'audit_human_actor_scope_invalid');
END;

CREATE TRIGGER identity_audit_service_scope
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role='service'
  AND NOT EXISTS (
    SELECT 1 FROM service_credentials s
    JOIN service_creator_grants g ON g.service_credential_id=s.id
    WHERE lower(NEW.actor_email)=lower('service:' || s.service_name)
      AND g.creator_id=NEW.creator_id
      AND s.status='active'
      AND g.status='active'
      AND (s.expires_at IS NULL OR unixepoch(s.expires_at)>unixepoch(CURRENT_TIMESTAMP))
  )
  AND NOT EXISTS (
    SELECT 1 FROM service_principal_credentials c
    JOIN service_principals p ON p.id=c.service_principal_id
    JOIN service_principal_creator_grants g ON g.service_principal_id=p.id
    WHERE lower(NEW.actor_email)=lower('service:' || p.principal_name)
      AND g.creator_id=NEW.creator_id
      AND c.status='active'
      AND p.status='active'
      AND g.status='active'
      AND (c.expires_at IS NULL OR unixepoch(c.expires_at)>unixepoch(CURRENT_TIMESTAMP))
  )
BEGIN
  SELECT RAISE(ABORT, 'audit_service_actor_scope_invalid');
END;

CREATE TRIGGER media_fetch_ticket_creator_scope_insert
BEFORE INSERT ON media_fetch_tickets
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified')
BEGIN SELECT RAISE(ABORT,'media_fetch_ticket_creator_mismatch'); END;

CREATE TRIGGER media_fetch_ticket_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id ON media_fetch_tickets
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified')
BEGIN SELECT RAISE(ABORT,'media_fetch_ticket_creator_mismatch'); END;

CREATE TRIGGER messaging_audit_actor_role_contract_insert
BEFORE INSERT ON messaging_audit_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER messaging_audit_actor_role_contract_update
BEFORE UPDATE ON messaging_audit_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER migration_ledger_events_creator_scope
BEFORE INSERT ON migration_ledger_events
WHEN NOT EXISTS (
  SELECT 1 FROM migration_ledger_runs run
  WHERE run.id=NEW.run_id AND run.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_creator_scope');
END;

CREATE TRIGGER migration_ledger_events_immutable_delete
BEFORE DELETE ON migration_ledger_events
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_events_immutable_update
BEFORE UPDATE ON migration_ledger_events
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_events_record_scope
BEFORE INSERT ON migration_ledger_events
WHEN NEW.record_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM migration_ledger_records record
  WHERE record.id=NEW.record_id AND record.run_id=NEW.run_id AND record.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_record_scope');
END;

CREATE TRIGGER migration_ledger_records_creator_scope
BEFORE INSERT ON migration_ledger_records
WHEN NOT EXISTS (
  SELECT 1 FROM migration_ledger_runs run
  WHERE run.id=NEW.run_id AND run.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_creator_scope');
END;

CREATE TRIGGER migration_ledger_records_immutable_delete
BEFORE DELETE ON migration_ledger_records
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_records_immutable_update
BEFORE UPDATE ON migration_ledger_records
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_runs_immutable_delete
BEFORE DELETE ON migration_ledger_runs
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER migration_ledger_runs_immutable_update
BEFORE UPDATE ON migration_ledger_runs
BEGIN
  SELECT RAISE(ABORT,'migration_ledger_append_only');
END;

CREATE TRIGGER onlyfans_batch_scope_insert
BEFORE INSERT ON onlyfans_upload_batches
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND status='active' AND verified_at IS NOT NULL)
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_batch_scope_mismatch'); END;

CREATE TRIGGER onlyfans_batch_scope_update
BEFORE UPDATE OF creator_id,account_id,target_id,profile_id ON onlyfans_upload_batches
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id)
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_batch_scope_mismatch'); END;

CREATE TRIGGER onlyfans_delivery_control_scope_insert
BEFORE INSERT ON onlyfans_delivery_controls
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_delivery_control_scope_mismatch'); END;

CREATE TRIGGER onlyfans_delivery_control_scope_update
BEFORE UPDATE OF creator_id,account_id ON onlyfans_delivery_controls
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_delivery_control_scope_mismatch'); END;

CREATE TRIGGER onlyfans_job_batch_scope_insert
BEFORE INSERT ON onlyfans_upload_jobs
WHEN NEW.batch_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM onlyfans_upload_batches b
  WHERE b.id=NEW.batch_id AND b.creator_id=NEW.creator_id AND b.account_id=NEW.account_id AND b.target_id=NEW.target_id
)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_batch_scope_mismatch'); END;

CREATE TRIGGER onlyfans_job_batch_scope_update
BEFORE UPDATE OF batch_id,creator_id,account_id,target_id ON onlyfans_upload_jobs
WHEN NEW.batch_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM onlyfans_upload_batches b
  WHERE b.id=NEW.batch_id AND b.creator_id=NEW.creator_id AND b.account_id=NEW.account_id AND b.target_id=NEW.target_id
)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_batch_scope_mismatch'); END;

CREATE TRIGGER onlyfans_job_scope_insert
BEFORE INSERT ON onlyfans_upload_jobs
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id AND status='active')
  OR NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.asset_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_scope_mismatch'); END;

CREATE TRIGGER onlyfans_job_scope_update
BEFORE UPDATE OF creator_id,account_id,target_id,asset_id,platform ON onlyfans_upload_jobs
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM onlyfans_upload_targets WHERE id=NEW.target_id AND creator_id=NEW.creator_id AND account_id=NEW.account_id)
  OR NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.asset_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT, 'onlyfans_upload_job_scope_mismatch'); END;

CREATE TRIGGER onlyfans_target_account_scope_insert
BEFORE INSERT ON onlyfans_upload_targets
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_target_scope_mismatch'); END;

CREATE TRIGGER onlyfans_target_account_scope_update
BEFORE UPDATE OF creator_id,account_id,profile_id,platform ON onlyfans_upload_targets
WHEN NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id AND platform='onlyfans')
  OR NOT EXISTS (SELECT 1 FROM account_browser_profiles WHERE creator_id=NEW.creator_id AND account_id=NEW.account_id AND profile_id=NEW.profile_id AND platform='onlyfans')
BEGIN SELECT RAISE(ABORT, 'onlyfans_target_scope_mismatch'); END;

CREATE TRIGGER public_profile_version_approval_transition
BEFORE UPDATE OF status, approved_by, approved_at ON creator_public_profile_versions
WHEN OLD.status='draft' AND NEW.status IN ('approved','published')
 AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_requires_explicit_approval');
END;

CREATE TRIGGER public_profile_version_creator_insert
BEFORE INSERT ON creator_public_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_creator_mismatch');
END;

CREATE TRIGGER public_profile_version_creator_update
BEFORE UPDATE OF profile_id, creator_id ON creator_public_profile_versions
WHEN NOT EXISTS (SELECT 1 FROM creator_public_profiles p WHERE p.id=NEW.profile_id AND p.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_creator_mismatch');
END;

CREATE TRIGGER public_profile_version_immutable_after_approval
BEFORE UPDATE OF display_name, headline, bio, avatar_media_id, content_checksum ON creator_public_profile_versions
WHEN OLD.status<>'draft'
BEGIN
  SELECT RAISE(ABORT, 'public_profile_version_is_immutable');
END;

CREATE TRIGGER reddit_community_actor_role_contract_insert
BEFORE INSERT ON reddit_community_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER reddit_community_actor_role_contract_update
BEFORE UPDATE ON reddit_community_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER reddit_community_flairs_creator_insert
BEFORE INSERT ON reddit_community_flairs
WHEN NOT EXISTS (
  SELECT 1 FROM reddit_communities c
  WHERE c.id=NEW.community_id AND c.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'reddit_flair_creator_scope');
END;

CREATE TRIGGER reddit_community_flairs_creator_update
BEFORE UPDATE OF creator_id,community_id ON reddit_community_flairs
WHEN NOT EXISTS (
  SELECT 1 FROM reddit_communities c
  WHERE c.id=NEW.community_id AND c.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'reddit_flair_creator_scope');
END;

CREATE TRIGGER service_auth_activation_runs_append_only_delete
BEFORE DELETE ON service_auth_activation_runs
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_runs_append_only');
END;

CREATE TRIGGER service_auth_activation_runs_append_only_update
BEFORE UPDATE ON service_auth_activation_runs
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_runs_append_only');
END;

CREATE TRIGGER service_auth_activation_steps_append_only_delete
BEFORE DELETE ON service_auth_activation_steps
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_steps_append_only');
END;

CREATE TRIGGER service_auth_activation_steps_append_only_update
BEFORE UPDATE ON service_auth_activation_steps
BEGIN
  SELECT RAISE(ABORT,'service_auth_activation_steps_append_only');
END;

CREATE TRIGGER service_auth_telemetry_append_only_delete
BEFORE DELETE ON service_auth_telemetry
BEGIN
  SELECT RAISE(ABORT,'service_auth_telemetry_append_only');
END;

CREATE TRIGGER service_auth_telemetry_append_only_update
BEFORE UPDATE ON service_auth_telemetry
BEGIN
  SELECT RAISE(ABORT,'service_auth_telemetry_append_only');
END;

CREATE TRIGGER service_principal_audit_events_append_only_delete
BEFORE DELETE ON service_principal_audit_events
BEGIN
  SELECT RAISE(ABORT,'service_principal_audit_events_append_only');
END;

CREATE TRIGGER service_principal_audit_events_append_only_update
BEFORE UPDATE ON service_principal_audit_events
BEGIN
  SELECT RAISE(ABORT,'service_principal_audit_events_append_only');
END;

CREATE TRIGGER social_post_actor_role_contract_insert
BEFORE INSERT ON social_post_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER social_post_actor_role_contract_update
BEFORE UPDATE ON social_post_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER social_post_events_creator_insert
BEFORE INSERT ON social_post_events
WHEN NOT EXISTS (SELECT 1 FROM social_posts sp WHERE sp.id=NEW.post_id AND sp.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'social_post_event_creator_mismatch');
END;

CREATE TRIGGER social_post_events_creator_update
BEFORE UPDATE OF post_id, creator_id ON social_post_events
WHEN NOT EXISTS (SELECT 1 FROM social_posts sp WHERE sp.id=NEW.post_id AND sp.creator_id=NEW.creator_id)
BEGIN
  SELECT RAISE(ABORT, 'social_post_event_creator_mismatch');
END;

CREATE TRIGGER social_posts_related_creator_insert
BEFORE INSERT ON social_posts
WHEN (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts oa WHERE oa.id=NEW.account_id AND oa.creator_id=NEW.creator_id))
  OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id))
  OR (NEW.community_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reddit_communities rc WHERE rc.id=NEW.community_id AND rc.creator_id=NEW.creator_id))
BEGIN
  SELECT RAISE(ABORT, 'social_post_creator_mismatch');
END;

CREATE TRIGGER social_posts_related_creator_update
BEFORE UPDATE OF creator_id, account_id, asset_id, community_id ON social_posts
WHEN (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts oa WHERE oa.id=NEW.account_id AND oa.creator_id=NEW.creator_id))
  OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id))
  OR (NEW.community_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reddit_communities rc WHERE rc.id=NEW.community_id AND rc.creator_id=NEW.creator_id))
BEGIN
  SELECT RAISE(ABORT, 'social_post_creator_mismatch');
END;

CREATE TRIGGER telegram_media_handoff_creator_scope_insert
BEFORE INSERT ON telegram_media_handoffs
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified' AND o.sha256=NEW.sha256 AND o.byte_count=NEW.byte_count)
BEGIN SELECT RAISE(ABORT,'telegram_media_handoff_creator_mismatch'); END;

CREATE TRIGGER telegram_media_handoff_creator_scope_update
BEFORE UPDATE OF creator_id,asset_id,storage_object_id,sha256,byte_count ON telegram_media_handoffs
WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.creator_id=NEW.creator_id)
  OR NOT EXISTS (SELECT 1 FROM asset_storage_objects o WHERE o.id=NEW.storage_object_id AND o.creator_id=NEW.creator_id AND o.asset_id=NEW.asset_id AND o.ingest_status='verified' AND o.sha256=NEW.sha256 AND o.byte_count=NEW.byte_count)
BEGIN SELECT RAISE(ABORT,'telegram_media_handoff_creator_mismatch'); END;

CREATE TRIGGER vault_credentials_account_scope_insert BEFORE INSERT ON vault_credentials
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'vault_credential_creator_scope_invalid'); END;

CREATE TRIGGER vault_credentials_account_scope_update BEFORE UPDATE OF creator_id,account_id ON vault_credentials
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operational_accounts WHERE id=NEW.account_id AND creator_id=NEW.creator_id)
BEGIN SELECT RAISE(ABORT,'vault_credential_creator_scope_invalid'); END;

CREATE TRIGGER vault_step_up_membership_scope BEFORE INSERT ON vault_step_up_sessions
WHEN NOT EXISTS (SELECT 1 FROM creator_memberships WHERE creator_id=NEW.creator_id AND lower(user_email)=lower(NEW.identity_email) AND role=NEW.actor_role AND status='active')
BEGIN SELECT RAISE(ABORT,'vault_step_up_actor_scope_invalid'); END;

CREATE TRIGGER vault_upload_actor_role_contract_insert
BEFORE INSERT ON vault_upload_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER vault_upload_actor_role_contract_update
BEFORE UPDATE ON vault_upload_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;
