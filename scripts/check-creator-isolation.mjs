import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve(".creator-os", "creator-os.sqlite"), { readonly: true });
const checks = [
  ["post primary asset/account", `
    SELECT p.id FROM post_packages p
    JOIN assets x ON x.id=p.asset_id
    JOIN accounts a ON a.id=p.account_id
    WHERE x.creator_id<>a.creator_id
  `],
  ["carousel assets", `
    SELECT pa.post_package_id FROM post_package_assets pa
    JOIN post_packages p ON p.id=pa.post_package_id
    JOIN accounts a ON a.id=p.account_id
    JOIN assets x ON x.id=pa.asset_id
    WHERE x.creator_id<>a.creator_id
  `],
  ["attached people", `
    SELECT pp.post_package_id FROM post_package_people pp
    JOIN post_packages p ON p.id=pp.post_package_id
    JOIN accounts a ON a.id=p.account_id
    JOIN people x ON x.id=pp.person_id
    WHERE x.creator_id<>a.creator_id
  `],
  ["asset classifications", `
    SELECT c.asset_id FROM asset_classifications c
    LEFT JOIN assets a ON a.id=c.asset_id
    LEFT JOIN assets parent ON parent.id=c.teaser_for_asset_id
    WHERE a.id IS NULL OR a.creator_id<>c.creator_id
      OR (c.teaser_for_asset_id IS NOT NULL AND (parent.id IS NULL OR parent.creator_id<>c.creator_id))
  `],
  ["asset destinations", `
    SELECT d.asset_id FROM asset_destinations d
    LEFT JOIN assets a ON a.id=d.asset_id
    WHERE a.id IS NULL OR a.creator_id<>d.creator_id
  `],
  ["asset creator friends", `
    SELECT ap.asset_id FROM asset_people ap
    LEFT JOIN assets a ON a.id=ap.asset_id
    LEFT JOIN people p ON p.id=ap.person_id
    WHERE a.id IS NULL OR p.id IS NULL OR a.creator_id<>ap.creator_id OR p.creator_id<>ap.creator_id
  `],
  ["paid-use attestations", `
    SELECT c.asset_id FROM asset_paid_consent_attestations c
    LEFT JOIN assets a ON a.id=c.asset_id
    LEFT JOIN people p ON p.id=c.person_id
    WHERE a.id IS NULL OR p.id IS NULL OR a.creator_id<>c.creator_id OR p.creator_id<>c.creator_id
  `],
  ["asset classification audit", `
    SELECT e.id FROM asset_classification_events e
    LEFT JOIN assets a ON a.id=e.asset_id
    WHERE a.id IS NULL OR a.creator_id<>e.creator_id
  `],
  ["voice profiles", `
    SELECT v.creator_id FROM creator_voice_profiles v
    LEFT JOIN creators c ON c.id=v.creator_id
    WHERE c.id IS NULL
  `],
  ["research findings", `
    SELECT r.id FROM research_findings r
    LEFT JOIN creators c ON c.id=r.creator_id
    WHERE c.id IS NULL
  `],
  ["agent tasks", `
    SELECT t.id FROM agent_tasks t
    LEFT JOIN creators c ON c.id=t.creator_id
    LEFT JOIN post_packages p ON p.id=t.post_package_id
    LEFT JOIN accounts a ON a.id=p.account_id
    WHERE c.id IS NULL OR (t.post_package_id IS NOT NULL AND a.creator_id<>t.creator_id)
  `],
  ["automation events", `
    SELECT e.id FROM automation_events e
    LEFT JOIN creators c ON c.id=e.creator_id
    WHERE c.id IS NULL
  `],
  ["workflow receipts", `
    SELECT r.id FROM workflow_receipts r
    LEFT JOIN creators c ON c.id=r.creator_id
    LEFT JOIN automation_events e ON e.id=r.event_id
    WHERE c.id IS NULL OR (r.event_id IS NOT NULL AND (e.id IS NULL OR e.creator_id<>r.creator_id))
  `],
  ["platform connections", `
    SELECT pc.id FROM platform_connections pc
    LEFT JOIN creators c ON c.id=pc.creator_id
    LEFT JOIN accounts a ON a.id=pc.account_id
    WHERE c.id IS NULL OR a.id IS NULL OR a.creator_id<>pc.creator_id
  `],
  ["local bridge connections", `
    SELECT b.id FROM local_bridge_connections b
    LEFT JOIN creators c ON c.id=b.creator_id
    LEFT JOIN accounts a ON a.id=b.account_id
    WHERE c.id IS NULL OR a.id IS NULL OR a.creator_id<>b.creator_id OR a.platform<>b.platform
      OR b.platform NOT IN ('onlyfans','fansly')
  `],
  ["messaging connections", `
    SELECT m.id FROM messaging_connections m
    LEFT JOIN creators c ON c.id=m.creator_id
    LEFT JOIN accounts a ON a.id=m.account_id
    WHERE c.id IS NULL OR (m.account_id IS NOT NULL AND (a.id IS NULL OR a.creator_id<>m.creator_id OR a.platform<>m.platform))
  `],
  ["message threads", `
    SELECT t.id FROM message_threads t
    LEFT JOIN messaging_connections m ON m.id=t.connection_id
    WHERE m.id IS NULL OR m.creator_id<>t.creator_id
  `],
  ["messages", `
    SELECT x.id FROM messages x LEFT JOIN message_threads t ON t.id=x.thread_id
    WHERE t.id IS NULL OR t.creator_id<>x.creator_id
  `],
  ["message drafts", `
    SELECT d.id FROM message_drafts d LEFT JOIN message_threads t ON t.id=d.thread_id
    WHERE t.id IS NULL OR t.creator_id<>d.creator_id
  `],
  ["messaging audit", `
    SELECT e.id FROM messaging_audit_events e
    LEFT JOIN messaging_connections m ON m.id=e.connection_id
    LEFT JOIN message_threads t ON t.id=e.thread_id
    LEFT JOIN message_drafts d ON d.id=e.draft_id
    WHERE (e.connection_id IS NOT NULL AND (m.id IS NULL OR m.creator_id<>e.creator_id))
       OR (e.thread_id IS NOT NULL AND (t.id IS NULL OR t.creator_id<>e.creator_id))
       OR (e.draft_id IS NOT NULL AND (d.id IS NULL OR d.creator_id<>e.creator_id))
  `],
  ["local bridge pairings", `
    SELECT p.id FROM local_bridge_pairings p
    LEFT JOIN creators c ON c.id=p.creator_id
    LEFT JOIN accounts a ON a.id=p.account_id
    WHERE c.id IS NULL OR a.id IS NULL OR a.creator_id<>p.creator_id OR a.platform<>p.platform
      OR p.platform NOT IN ('onlyfans','fansly')
  `],
  ["local bridge outbound jobs", `
    SELECT j.id FROM local_bridge_outbound_jobs j
    LEFT JOIN creators c ON c.id=j.creator_id
    LEFT JOIN accounts a ON a.id=j.account_id
    LEFT JOIN messaging_connections m ON m.id=j.connection_id
    LEFT JOIN message_threads t ON t.id=j.thread_id
    LEFT JOIN message_drafts d ON d.id=j.draft_id
    WHERE c.id IS NULL OR a.id IS NULL OR m.id IS NULL OR t.id IS NULL OR d.id IS NULL
      OR a.creator_id<>j.creator_id OR m.creator_id<>j.creator_id
      OR t.creator_id<>j.creator_id OR d.creator_id<>j.creator_id
      OR a.platform<>j.platform OR m.platform<>j.platform OR j.platform NOT IN ('onlyfans','fansly')
  `],
  ["vault upload jobs", `
    SELECT j.id FROM vault_upload_jobs j
    LEFT JOIN creators c ON c.id=j.creator_id
    LEFT JOIN accounts a ON a.id=j.account_id
    LEFT JOIN assets x ON x.id=j.asset_id
    LEFT JOIN messaging_connections m ON m.id=j.connection_id
    WHERE c.id IS NULL OR a.id IS NULL OR x.id IS NULL OR m.id IS NULL
      OR a.creator_id<>j.creator_id OR x.creator_id<>j.creator_id OR m.creator_id<>j.creator_id
      OR a.platform<>j.platform OR m.platform<>j.platform OR j.platform NOT IN ('onlyfans','fansly')
  `],
  ["publication jobs", `
    SELECT j.id FROM publication_jobs j
    LEFT JOIN creators c ON c.id=j.creator_id
    LEFT JOIN accounts a ON a.id=j.account_id
    LEFT JOIN post_packages p ON p.id=j.post_package_id
    WHERE c.id IS NULL OR a.id IS NULL OR p.id IS NULL OR a.creator_id<>j.creator_id
  `],
  ["analytics metrics", `
    SELECT m.id FROM analytics_metrics m
    LEFT JOIN creators c ON c.id=m.creator_id
    LEFT JOIN analytics_imports i ON i.id=m.import_id
    WHERE c.id IS NULL OR i.id IS NULL OR i.creator_id<>m.creator_id
  `],
  ["Instagram analytics", `
    SELECT m.id FROM instagram_media_analytics m
    LEFT JOIN creators c ON c.id=m.creator_id
    LEFT JOIN accounts a ON a.id=m.account_id
    WHERE c.id IS NULL OR a.id IS NULL OR a.creator_id<>m.creator_id OR a.platform<>'instagram'
  `],
  ["Instagram follower activity", `
    SELECT f.id FROM instagram_follower_activity f
    LEFT JOIN creators c ON c.id=f.creator_id
    LEFT JOIN accounts a ON a.id=f.account_id
    WHERE c.id IS NULL OR a.id IS NULL OR a.creator_id<>f.creator_id OR a.platform<>'instagram'
  `],
  ["Telegram pairings", `
    SELECT p.creator_id FROM telegram_creator_pairings p
    LEFT JOIN creator_service_connections s ON s.id=p.service_connection_id
    LEFT JOIN agency_integrations i ON i.id=p.agency_integration_id
    LEFT JOIN creators c ON c.id=p.creator_id
    WHERE c.id IS NULL OR i.id IS NULL OR i.service<>'telegram' OR s.id IS NULL OR s.service<>'telegram'
  `],
  ["Telegram handoffs", `
    SELECT h.id FROM telegram_handoffs h
    LEFT JOIN post_packages p ON p.id=h.post_package_id
    LEFT JOIN accounts a ON a.id=p.account_id
    WHERE p.id IS NULL OR a.id IS NULL OR a.creator_id<>h.creator_id
  `],
  ["publication matches", `
    SELECT m.id FROM post_publication_matches m LEFT JOIN post_packages p ON p.id=m.post_package_id
    LEFT JOIN accounts a ON a.id=m.account_id WHERE p.id IS NULL OR a.id IS NULL OR a.creator_id<>m.creator_id OR m.platform<>a.platform
  `],
  ["outcome snapshots", `
    SELECT s.id FROM post_outcome_snapshots s LEFT JOIN post_publication_matches m ON m.id=s.publication_match_id
    WHERE m.id IS NULL OR m.creator_id<>s.creator_id
  `],
  ["creator reminders", `
    SELECT r.id FROM creator_reminders r LEFT JOIN post_packages p ON p.id=r.post_package_id
    LEFT JOIN accounts a ON a.id=p.account_id WHERE p.id IS NULL OR a.id IS NULL OR a.creator_id<>r.creator_id
  `],
  ["reddit communities", `
    SELECT r.id FROM reddit_communities r
    LEFT JOIN creators c ON c.id=r.creator_id
    WHERE c.id IS NULL
  `],
  ["reddit targets", `
    SELECT t.id FROM reddit_post_targets t
    LEFT JOIN reddit_communities c ON c.id=t.community_id
    LEFT JOIN post_packages p ON p.id=t.post_package_id
    LEFT JOIN accounts a ON a.id=p.account_id
    WHERE c.id IS NULL OR p.id IS NULL OR a.id IS NULL
      OR c.creator_id<>t.creator_id OR a.creator_id<>t.creator_id
  `],
];

const failures = [];
for (const [name, sql] of checks) {
  const rows = db.prepare(sql).all();
  if (rows.length) failures.push({ name, rows });
}
db.close();

if (failures.length) {
  console.error({ isolation: "failed", failures });
  process.exit(1);
}
console.log({ isolation: "ok", checks: checks.map(([name]) => name) });
