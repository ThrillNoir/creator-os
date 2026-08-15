export type InternalServiceIdentity = {
  credentialId: string;
  serviceName: string;
  creatorId: string;
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
): Promise<InternalServiceIdentity> {
  if (!creatorId || !expectedServiceName) throw new Error("Internal service credential is invalid.");
  const tokenHash = await sha256(bearerToken(request));
  const credential = await db.prepare(`SELECT s.id,s.service_name
    FROM service_credentials s
    JOIN service_creator_grants g ON g.service_credential_id=s.id
    WHERE s.token_hash=? AND s.service_name=? AND s.status='active'
      AND (s.expires_at IS NULL OR unixepoch(s.expires_at)>unixepoch(CURRENT_TIMESTAMP))
      AND g.creator_id=? AND g.status='active'
    LIMIT 1`).bind(tokenHash, expectedServiceName, creatorId).first<{ id: string; service_name: string }>();
  if (!credential) throw new Error("Internal service credential is invalid.");
  return { credentialId: credential.id, serviceName: credential.service_name, creatorId };
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
      JSON.stringify({ credentialId: identity.credentialId, route }),
    );
}
