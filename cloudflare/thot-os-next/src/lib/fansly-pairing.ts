import "server-only";

import { requireAccessIdentity } from "@/lib/access";
import { cloudflareEnv } from "@/lib/cloudflare";

export type FanslyPairingDestination = "vault" | "messages";

export async function issueFanslyBridgePairing(destination: FanslyPairingDestination) {
  const identity = await requireAccessIdentity();
  const { DB } = cloudflareEnv();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const actor = identity.email ?? "connect@thrillnoir.com";

  await DB.batch([
    DB.prepare("UPDATE vault_bridge_tokens SET status='revoked' WHERE creator_id='adelaide' AND account_id='adelaide-fansly-main' AND platform='fansly' AND status='active'"),
    DB.prepare("INSERT INTO vault_bridge_tokens (id,creator_id,account_id,platform,token_hash,status,expires_at) VALUES (?,'adelaide','adelaide-fansly-main','fansly',?,'active',datetime('now','+90 days'))").bind(crypto.randomUUID(), tokenHash),
    DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail) VALUES (?,'adelaide','adelaide-messages-fansly','fansly_device_pairing_issued',?,?)").bind(crypto.randomUUID(), actor, JSON.stringify({ destination })),
  ]).catch(async () => {
    await DB.prepare("DELETE FROM vault_bridge_tokens WHERE creator_id='adelaide' AND account_id='adelaide-fansly-main' AND token_hash=?").bind(tokenHash).run();
    throw new Error("The Fansly device pairing could not be issued.");
  });

  return `https://fansly.com/${destination === "vault" ? "creator/vault" : "messages"}#creator_os_cloud_pair=${encodeURIComponent(token)}`;
}
