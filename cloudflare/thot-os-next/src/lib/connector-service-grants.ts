import type { CreatorRole } from "./authorization";

const capabilities = {
  instagram: ["instagram.status.read", "instagram.connection.manage", "instagram.publish.execute", "instagram.sync.execute", "instagram.messages.sync", "instagram.messages.write"],
  telegram: ["telegram.status.read", "telegram.connection.manage", "telegram.messages.sync", "telegram.messages.write"],
  reddit: ["reddit.status.read", "reddit.connection.manage", "reddit.communities.read", "reddit.publish.execute"],
};

// Called only after authenticating the creator workspace and validating the account.
// These transport grants do not replace OAuth, publishing approval, or messaging authority.
export async function ensureConnectorServiceGrants(DB: D1Database, identity: { email: string; creator: { creator_id: string; role: CreatorRole } }, service: keyof typeof capabilities) {
  if (!identity.creator.creator_id || !identity.email || !(service === "telegram" ? ["agency_admin"] : ["agency_admin", "operator", "creator"]).includes(identity.creator.role)) throw new Error("Connector setup is not authorised.");
  const creatorId = identity.creator.creator_id;
  const principal = `thot-os-web-${service}`;
  const grants = capabilities[service];
  const results = await DB.batch(grants.map((capability) => DB.prepare(`INSERT OR IGNORE INTO service_principal_creator_grants (service_principal_id,creator_id,capability,status)
    SELECT p.id,?,?, 'active' FROM service_principals p
    WHERE p.principal_name=? AND p.status='active' AND EXISTS (
      SELECT 1 FROM service_principal_credentials c WHERE c.service_principal_id=p.id AND c.status='active'
        AND (c.expires_at IS NULL OR unixepoch(c.expires_at)>unixepoch(CURRENT_TIMESTAMP)))`).bind(creatorId, capability, principal)));
  const active = await DB.prepare(`SELECT COUNT(*) AS count FROM service_principal_creator_grants g JOIN service_principals p ON p.id=g.service_principal_id
    WHERE p.principal_name=? AND p.status='active' AND g.creator_id=? AND g.status='active' AND g.capability IN (${grants.map(() => "?").join(",")})
      AND EXISTS (SELECT 1 FROM service_principal_credentials c WHERE c.service_principal_id=p.id AND c.status='active'
        AND (c.expires_at IS NULL OR unixepoch(c.expires_at)>unixepoch(CURRENT_TIMESTAMP)))`).bind(principal, creatorId, ...grants).first<{ count: number }>();
  if (results.some((result) => Number(result.meta?.changes ?? 0) > 0)) await DB.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), creatorId, identity.email, identity.creator.role, `${service}_service_grants_provisioned`, principal, JSON.stringify({ capabilities: grants })).run();
  // INSERT OR IGNORE deliberately preserves revoked grants; reconnect cannot re-enable them.
  if (Number(active?.count ?? 0) !== grants.length) throw new Error(`${service} creator-scoped service permissions are not active.`);
}
