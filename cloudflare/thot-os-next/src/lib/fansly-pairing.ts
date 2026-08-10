import "server-only";

import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";

export type FanslyPairingDestination = "vault" | "messages";

export async function issueFanslyBridgePairing(destination: FanslyPairingDestination) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const { DB } = cloudflareEnv();
  const assignment = await creatorPrepare(DB, creatorId, `SELECT oa.id AS account_id,abp.profile_id,mc.id AS connection_id
    FROM operational_accounts oa JOIN account_browser_profiles abp ON abp.creator_id=oa.creator_id AND abp.account_id=oa.id
    JOIN browser_profiles bp ON bp.id=abp.profile_id AND bp.creator_id=abp.creator_id AND bp.status<>'revoked'
    LEFT JOIN messaging_connections mc ON mc.creator_id=oa.creator_id AND mc.account_id=oa.id AND mc.platform='fansly'
    WHERE oa.creator_id=@creator AND oa.platform='fansly' ORDER BY oa.label LIMIT 1`).first<{ account_id: string; profile_id: string; connection_id: string | null }>();
  if (!assignment) throw new Error("Assign this creator’s Fansly account to an active M1 Chrome profile first.");
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const actor = identity.email;
  const auditActor = humanAuditActor(identity);

  await DB.batch([
    creatorPrepare(DB, creatorId, "UPDATE bridge_credentials SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE creator_id=@creator AND account_id=? AND profile_id=? AND platform='fansly' AND status='active'").bind(assignment.account_id, assignment.profile_id),
    creatorPrepare(DB, creatorId, "INSERT INTO bridge_credentials (id,creator_id,account_id,profile_id,platform,token_hash,status,issued_by,expires_at) VALUES (?,@creator,?,?, 'fansly',?,'active',?,datetime('now','+90 days'))").bind(crypto.randomUUID(), assignment.account_id, assignment.profile_id, tokenHash, actor),
    creatorPrepare(DB, creatorId, "INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,@creator,?,'fansly_device_pairing_issued',?,?,?)").bind(crypto.randomUUID(), assignment.connection_id, actor, auditActor.role, JSON.stringify({ destination, profileId: assignment.profile_id })),
    identityAuditStatement(DB, auditActor, "bridge_credential_issued", assignment.account_id, { platform: "fansly", profileId: assignment.profile_id, destination }),
  ]).catch(async () => {
    await creatorPrepare(DB, creatorId, "DELETE FROM bridge_credentials WHERE creator_id=@creator AND account_id=? AND token_hash=?").bind(assignment.account_id, tokenHash).run();
    throw new Error("The Fansly device pairing could not be issued.");
  });

  const bridgeBaseUrl = (cloudflareEnv() as CloudflareEnv & { VAULT_BRIDGE_BASE_URL?: string }).VAULT_BRIDGE_BASE_URL ?? "https://thot-os-vault-bridge-staging.thot-os.workers.dev";
  const next = destination === "vault" ? "https://fansly.com/creator/vault" : "https://fansly.com/messages";
  return `${bridgeBaseUrl}/pair#creator_os_bridge_pair=${encodeURIComponent(token)}&platform=fansly&next=${encodeURIComponent(next)}`;
}
