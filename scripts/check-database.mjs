import Database from "better-sqlite3";
import path from "node:path";

const databasePath = path.resolve(".creator-os", "creator-os.sqlite");
const db = new Database(databasePath, { readonly: true });
const integrity = db.pragma("quick_check", { simple: true });
const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM creators) AS creators,
    (SELECT COUNT(*) FROM assets) AS assets,
    (SELECT COUNT(*) FROM accounts) AS accounts,
    (SELECT COUNT(*) FROM post_packages) AS post_packages,
    (SELECT COUNT(*) FROM approvals) AS approvals,
    (SELECT COUNT(*) FROM agent_tasks) AS agent_tasks,
    (SELECT COUNT(*) FROM automation_events) AS automation_events,
    (SELECT COUNT(*) FROM workflow_receipts) AS workflow_receipts,
    (SELECT COUNT(*) FROM platform_connections) AS platform_connections,
    (SELECT COUNT(*) FROM local_bridge_connections) AS local_bridge_connections,
    (SELECT COUNT(*) FROM messaging_connections) AS messaging_connections,
    (SELECT COUNT(*) FROM message_threads) AS message_threads,
    (SELECT COUNT(*) FROM messages) AS messages,
    (SELECT COUNT(*) FROM message_drafts) AS message_drafts,
    (SELECT COUNT(*) FROM messaging_audit_events) AS messaging_audit_events,
    (SELECT COUNT(*) FROM local_bridge_pairings) AS local_bridge_pairings,
    (SELECT COUNT(*) FROM local_bridge_outbound_jobs) AS local_bridge_outbound_jobs,
    (SELECT COUNT(*) FROM message_thread_sync_state) AS message_thread_sync_states,
    (SELECT COUNT(*) FROM vault_upload_jobs) AS vault_upload_jobs,
    (SELECT COUNT(*) FROM publication_jobs) AS publication_jobs,
    (SELECT COUNT(*) FROM analytics_imports) AS analytics_imports,
    (SELECT COUNT(*) FROM analytics_metrics) AS analytics_metrics,
    (SELECT COUNT(*) FROM instagram_media_analytics) AS instagram_media_analytics,
    (SELECT COUNT(*) FROM instagram_follower_activity) AS instagram_follower_activity,
    (SELECT COUNT(*) FROM telegram_handoffs) AS telegram_handoffs,
    (SELECT COUNT(*) FROM agency_integrations) AS agency_integrations,
    (SELECT COUNT(*) FROM telegram_creator_pairings WHERE status='paired') AS telegram_pairings,
    (SELECT COUNT(*) FROM telegram_pairing_invites WHERE status IN ('waiting','awaiting_confirmation')) AS active_telegram_pairing_invites,
    (SELECT COUNT(*) FROM post_publication_matches) AS publication_matches,
    (SELECT COUNT(*) FROM post_outcome_snapshots) AS outcome_snapshots,
    (SELECT COUNT(*) FROM creator_reminders) AS creator_reminders,
    (SELECT COUNT(*) FROM reddit_communities) AS reddit_communities,
    (SELECT COUNT(*) FROM reddit_post_targets) AS reddit_post_targets
`).get();
const migrations = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
const requiredMigration = "036_automation_control_plane";
const latestMigrationApplied = migrations.some((migration) => migration.version === requiredMigration);
const requiredIndexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'
  AND name IN ('vault_upload_active_asset_unique','vault_upload_claim_queue','local_bridge_outbound_claim_queue','analytics_import_content_unique','assets_creator_available_modified','workflow_receipts_receipt_key','automation_events_creator_status','workflow_receipts_creator_created')`).all();
db.close();

if (integrity !== "ok" || !latestMigrationApplied || requiredIndexes.length !== 8) {
  console.error({ integrity, counts, migrations, latestMigrationApplied, requiredIndexes });
  process.exit(1);
}
console.log({ integrity, counts, migrations, latestMigrationApplied, requiredIndexes });
