import "server-only";

import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";

export type FanslyPairingDestination = "vault" | "messages";

export async function issueFanslyBridgePairing(destination: FanslyPairingDestination, requestedInstallationId: string) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const { DB } = cloudflareEnv();
  const installationId = requestedInstallationId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installationId)) {
    throw new Error("Copy the installation ID from the THOT OS extension in the Chrome profile being paired.");
  }
  const assignment = await creatorPrepare(DB, creatorId, `SELECT oa.id AS account_id,oa.external_identity_confirmed_at,abp.profile_id,bp.installation_id,mc.id AS connection_id
    FROM operational_accounts oa JOIN account_browser_profiles abp ON abp.creator_id=oa.creator_id AND abp.account_id=oa.id
    JOIN browser_profiles bp ON bp.id=abp.profile_id AND bp.creator_id=abp.creator_id AND bp.status<>'revoked'
    LEFT JOIN messaging_connections mc ON mc.creator_id=oa.creator_id AND mc.account_id=oa.id AND mc.platform='fansly'
    WHERE oa.creator_id=@creator AND oa.platform='fansly' ORDER BY oa.label LIMIT 1`).first<{ account_id: string; external_identity_confirmed_at: string | null; profile_id: string; installation_id: string; connection_id: string | null }>();
  if (!assignment) throw new Error("Add this creator’s Fansly account and assign its THOT OS Chrome profile first.");
  if (!assignment.external_identity_confirmed_at) throw new Error("Confirm the signed-in Fansly identity before pairing the bridge.");
  if (assignment.installation_id !== installationId) throw new Error("This extension installation is not the assigned Chrome profile. The existing bridge was not changed.");
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const actor = identity.email;
  const auditActor = humanAuditActor(identity);

  const inserted = await creatorPrepare(DB, creatorId, `INSERT INTO bridge_credentials (id,creator_id,account_id,profile_id,platform,token_hash,status,issued_by,expires_at)
      SELECT ?,oa.creator_id,oa.id,abp.profile_id,'fansly',?,'active',?,datetime('now','+90 days')
      FROM operational_accounts oa JOIN account_browser_profiles abp ON abp.creator_id=oa.creator_id AND abp.account_id=oa.id
      JOIN browser_profiles bp ON bp.id=abp.profile_id AND bp.creator_id=abp.creator_id
      WHERE oa.creator_id=@creator AND oa.id=? AND oa.platform='fansly' AND oa.external_identity_confirmed_at IS NOT NULL
        AND abp.profile_id=? AND bp.installation_id=? AND bp.status<>'revoked'
        AND NOT EXISTS (SELECT 1 FROM bridge_credentials bc WHERE bc.creator_id=oa.creator_id AND bc.account_id=oa.id
          AND bc.profile_id=abp.profile_id AND bc.platform='fansly' AND bc.status='active' AND bc.expires_at>CURRENT_TIMESTAMP)`)
    .bind(crypto.randomUUID(), tokenHash, actor, assignment.account_id, assignment.profile_id, installationId).run();
  if (inserted.meta?.changes !== 1) throw new Error("This account already has a live bridge or its assigned profile changed. The existing bridge was not changed.");

  await DB.batch([
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
