import { cloudflareEnv } from "@/lib/cloudflare";
import { humanAuditActor, identityAuditStatement, isSameOriginRequest, rejectClientActorRole } from "@/lib/audit-identity";
import { requireCreatorContext } from "@/lib/identity";

function enabled() {
  return (cloudflareEnv() as CloudflareEnv & { STAGING_QA_ENABLED?: string }).STAGING_QA_ENABLED === "1";
}

export async function POST(request: Request) {
  if (!enabled()) return Response.json({ ok: false }, { status: 404 });
  if (!isSameOriginRequest(request)) {
    return Response.json({ ok: false }, { status: 403 });
  }
  const input: Record<string, unknown> = await request.json<Record<string, unknown>>().catch(() => ({}));
  try {
    rejectClientActorRole(input);
  } catch {
    return Response.json({ ok: false, error: "actor_role_is_server_derived" }, { status: 400 });
  }
  const creatorId = String(input.creatorId ?? "").trim();
  if (!creatorId) return Response.json({ ok: false, error: "creator_scope_required" }, { status: 400 });
  const context = await requireCreatorContext("mutate", creatorId);
  const actor = humanAuditActor(context);
  const subject = `authorization-probe:${crypto.randomUUID()}`;
  await identityAuditStatement(cloudflareEnv().DB, actor, "staging_qa_human_mutation", subject, { surface: "staging_qa" }).run();
  return Response.json({ ok: true, creatorId: actor.creatorId, actorRole: actor.role }, { headers: { "cache-control": "no-store" } });
}
