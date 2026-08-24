import { cloudflareEnv } from "@/lib/cloudflare";
import { rejectClientActorRole, requireServiceAuditActor } from "@/lib/audit-identity";

function enabled() {
  return (cloudflareEnv() as CloudflareEnv & { STAGING_QA_ENABLED?: string }).STAGING_QA_ENABLED === "1";
}

export async function POST(request: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  const input: Record<string, unknown> = await request.json<Record<string, unknown>>().catch(() => ({}));
  try {
    rejectClientActorRole(input);
  } catch {
    return Response.json({ ok: false, error: "actor_role_is_server_derived" }, { status: 400 });
  }
  const creatorId = String(input.creatorId ?? "").trim();
  if (!creatorId) return Response.json({ ok: false, error: "creator_scope_required" }, { status: 400 });
  const { DB } = cloudflareEnv();
  let service;
  try {
    service = await requireServiceAuditActor(request, DB, creatorId);
  } catch {
    return Response.json({ ok: false }, { status: 404 });
  }
  const subject = `authorization-probe:${crypto.randomUUID()}`;
  await DB.batch([
    DB.prepare("UPDATE service_principal_credentials SET last_seen_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(service.credentialId),
    DB.prepare(`INSERT INTO service_principal_audit_events
      (id,service_principal_id,credential_id,creator_id,event_type,actor_identity,detail)
      VALUES (?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(), service.principalId, service.credentialId, service.actor.creatorId,
        "staging_qa_service_mutation", service.actor.identity,
        JSON.stringify({ authPath: "canonical", subject, surface: "staging_qa" }),
      ),
  ]);
  return Response.json({ ok: true, creatorId: service.actor.creatorId, actorRole: service.actor.role }, { headers: { "cache-control": "no-store" } });
}
