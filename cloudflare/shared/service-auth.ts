export type InternalServiceIdentity = {
  credentialId: string;
  serviceName: string;
  creatorId: string;
  capability: string;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 40 || token.length > 512) throw new Error("Internal service credential is invalid.");
  return token;
}

/**
 * Authenticates an internal HTTP call independently of Cloudflare service-binding
 * topology. The raw bearer is held only by the caller; this helper verifies its
 * D1 hash, expected service name, expiry, and active creator grant.
 */
export async function requireInternalServiceForCreator(
  request: Request,
  db: D1Database,
  creatorId: string,
  expectedServiceName: string,
  expectedCapability: string,
): Promise<InternalServiceIdentity> {
  if (!creatorId || !expectedServiceName || !expectedCapability || request.headers.get("x-thot-os-service-capability") !== expectedCapability) throw new Error("Internal service credential is invalid.");
  const tokenHash = await sha256(bearerToken(request));
  const credential = await db.prepare(`SELECT c.id,p.principal_name
    FROM service_principal_credentials c
    JOIN service_principals p ON p.id=c.service_principal_id
    JOIN service_principal_creator_grants g ON g.service_principal_id=p.id
    WHERE c.token_hash=? AND p.principal_name=? AND c.status='active' AND p.status='active'
      AND (c.expires_at IS NULL OR unixepoch(c.expires_at)>unixepoch(CURRENT_TIMESTAMP))
      AND g.creator_id=? AND g.status='active'
      AND g.capability=?
    LIMIT 1`).bind(tokenHash, expectedServiceName, creatorId, expectedCapability).first<{ id: string; principal_name: string }>();
  if (!credential) throw new Error("Internal service credential is invalid.");
  return { credentialId: credential.id, serviceName: credential.principal_name, creatorId, capability: expectedCapability };
}

/** Records the authenticated machine principal before the route performs work. */
export function internalServiceAuditStatement(
  db: D1Database,
  identity: InternalServiceIdentity,
  route: string,
) {
  return db.prepare(`INSERT INTO identity_audit_events
    (id,creator_id,actor_email,actor_role,event_type,subject,detail)
    VALUES (?,?,?,'service','internal_service_request_authorized',?,?)`)
    .bind(
      crypto.randomUUID(),
      identity.creatorId,
      `service:${identity.serviceName}`,
      route,
      JSON.stringify({ credentialId: identity.credentialId, capability: identity.capability, route }),
    );
}
