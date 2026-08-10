import type { CreatorRole } from "./authorization";

export type AuditActorRole = CreatorRole | "service";

export type AuditActor = {
  identity: string;
  role: AuditActorRole;
  creatorId: string;
};

type HumanContext = {
  email: string;
  creator: { creator_id: string; role: CreatorRole };
};

export function humanAuditActor(context: HumanContext): AuditActor {
  return {
    identity: context.email.toLowerCase(),
    role: context.creator.role,
    creatorId: context.creator.creator_id,
  };
}

export function rejectClientActorRole(input: Record<string, unknown>) {
  if ("actorRole" in input || "actor_role" in input || "effectiveRole" in input) {
    throw new Error("Actor role is derived from the authenticated identity.");
  }
}

export function isSameOriginRequest(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function identityAuditStatement(
  DB: D1Database,
  actor: AuditActor,
  action: string,
  subject: string,
  detail: Record<string, unknown> = {},
) {
  if (!actor.creatorId || !actor.identity || !action || !subject) throw new Error("Audit identity and scope are required.");
  return DB.prepare(`INSERT INTO identity_audit_events
    (id,creator_id,actor_email,actor_role,event_type,subject,detail)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor.creatorId, actor.identity, actor.role, action, subject, JSON.stringify(detail));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireServiceAuditActor(request: Request, DB: D1Database, creatorId: string) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token.length > 512 || !creatorId) throw new Error("Service credential is invalid.");
  const tokenHash = await sha256(token);
  const credential = await DB.prepare(`SELECT s.id,s.service_name
    FROM service_credentials s
    JOIN service_creator_grants g ON g.service_credential_id=s.id
    WHERE s.token_hash=? AND s.status='active'
      AND (s.expires_at IS NULL OR unixepoch(s.expires_at)>unixepoch(CURRENT_TIMESTAMP))
      AND g.creator_id=? AND g.status='active'
    LIMIT 1`).bind(tokenHash, creatorId).first<{ id: string; service_name: string }>();
  if (!credential) throw new Error("Service credential is invalid.");
  return {
    actor: { identity: `service:${credential.service_name}`, role: "service", creatorId } satisfies AuditActor,
    credentialId: credential.id,
  };
}
