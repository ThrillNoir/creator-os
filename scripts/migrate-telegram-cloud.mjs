import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const arguments_ = process.argv.slice(2);
if (arguments_[0] !== "--environment" || arguments_[1] !== "staging" || !arguments_.includes("--execute")) {
  throw new Error("Refusing remote D1 migration. Use --environment staging --execute only after a fresh backup and an explicitly approved migration runbook.");
}

const root = resolve(import.meta.dirname, "..");
const local = new Database(resolve(root, ".creator-os/creator-os.sqlite"), { readonly: true });
const pairing = local.prepare(`SELECT creator_id,chat_id,telegram_user_id,telegram_username,display_name,last_update_id,paired_at
  FROM telegram_creator_pairings WHERE creator_id='adelaide' AND status='paired'`).get();
const agency = local.prepare("SELECT display_name FROM agency_integrations WHERE service='telegram' AND status='connected'").get();
const history = local.prepare(`SELECT id,message_text,status,telegram_message_id,error,created_at,completed_at
  FROM telegram_creator_messages WHERE creator_id='adelaide' ORDER BY id`).all();
local.close();

if (!pairing || !agency?.display_name) throw new Error("Adelaide’s paired Telegram chat and connected agency bot are required.");

const text = (value) => value == null ? "NULL" : `CAST(X'${Buffer.from(String(value)).toString("hex")}' AS TEXT)`;
const number = (value) => Number.isFinite(Number(value)) ? String(Number(value)) : "0";
const statements = [
  `INSERT INTO telegram_connector_state (creator_id,connection_id,chat_id,telegram_user_id,telegram_username,display_name,expected_bot_username,status,next_update_id)
    VALUES ('adelaide','adelaide-messages-telegram',${text(pairing.chat_id)},${text(pairing.telegram_user_id)},${text(pairing.telegram_username)},${text(pairing.display_name)},${text(String(agency.display_name).replace(/^@/, ""))},'pending_validation',${number(Number(pairing.last_update_id) + 1)})
    ON CONFLICT(creator_id) DO UPDATE SET connection_id=excluded.connection_id,chat_id=excluded.chat_id,telegram_user_id=excluded.telegram_user_id,
      telegram_username=excluded.telegram_username,display_name=excluded.display_name,expected_bot_username=excluded.expected_bot_username,
      next_update_id=MAX(telegram_connector_state.next_update_id,excluded.next_update_id),updated_at=CURRENT_TIMESTAMP;`,
  `INSERT OR IGNORE INTO message_threads (id,creator_id,connection_id,external_thread_id,participant_name,participant_handle,subject,unread_count,last_message_at,status)
    VALUES ('adelaide-telegram-private','adelaide','adelaide-messages-telegram','telegram-private','Adelaide',${text(pairing.telegram_username ? `@${String(pairing.telegram_username).replace(/^@/, "")}` : "")},'Agency ↔ creator',0,${text(history.at(-1)?.completed_at ?? pairing.paired_at)},'open');`,
  ...history.flatMap((item) => [
    `INSERT OR IGNORE INTO telegram_send_log (id,creator_id,connection_id,message_text,status,provider_message_id,requested_by,error,completed_at,created_at)
      VALUES ('local-telegram-${number(item.id)}','adelaide','adelaide-messages-telegram',${text(item.message_text)},${text(item.status === "sending" ? "queued" : item.status)},${text(item.telegram_message_id)},'Local HQ import',${text(item.error)},${text(item.completed_at)},${text(item.created_at)});`,
    `INSERT OR IGNORE INTO messages (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status,created_at)
      VALUES ('local-telegram-message-${number(item.id)}','adelaide','adelaide-telegram-private',${text(item.telegram_message_id ?? `local-${item.id}`)},'outbound','agency',${text(item.message_text)},${text(item.completed_at ?? item.created_at)},${text(item.status === "sent" ? "sent" : "failed")},${text(item.created_at)});`,
  ]),
  `UPDATE messaging_connections SET display_name='Agency Telegram bot',handle=${text(agency.display_name)},status='migration_pending',last_error='Awaiting cloud identity validation',updated_at=CURRENT_TIMESTAMP WHERE id='adelaide-messages-telegram' AND creator_id='adelaide';`,
  `INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail) VALUES ('telegram-local-import','adelaide','adelaide-messages-telegram','local_history_imported','migration','{"sendReceipts":${history.length}}') ON CONFLICT(id) DO NOTHING;`,
];

const wrangler = resolve(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler");
const result = spawnSync(wrangler, ["d1", "execute", "thot-os-staging", "--remote", "--command", statements.join("\n")], {
  cwd: resolve(root, "cloudflare/thot-os-next"),
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "3e7cfa6efb7a97825f1dc24515410c63" },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Migrated Adelaide Telegram pairing metadata and ${history.length} local send receipts.`);
