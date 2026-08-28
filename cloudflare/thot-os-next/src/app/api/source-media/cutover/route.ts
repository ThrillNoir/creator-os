import { humanAuditActor, identityAuditStatement, isSameOriginRequest, rejectClientActorRole } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { noStoreJson } from "@/lib/source-media";

type CutoverInput = { backend?: unknown; reason?: unknown; actorRole?: unknown; actor_role?: unknown; effectiveRole?: unknown };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const input = await request.json().catch(() => null) as CutoverInput | null;
  if (!input || typeof input !== "object") return noStoreJson({ ok: false, error: "invalid_cutover" }, 400);
  try { rejectClientActorRole(input as Record<string, unknown>); } catch { return noStoreJson({ ok: false, error: "invalid_cutover" }, 400); }
  const backend = input.backend === "r2" || input.backend === "dropbox" ? input.backend : "";
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 240) : "";
  if (!backend) return noStoreJson({ ok: false, error: "invalid_cutover" }, 400);
  const context = await requireCreatorContext("manage_identity");
  const env = cloudflareEnv();
  const { DB } = env;
  if (backend === "r2") {
    // R2 activation is deliberately not a browser mutation. The bounded
    // coordinator verifies creator coverage, live Worker metadata and
    // authenticated readiness evidence before it can update this state.
    return noStoreJson({ ok: false, error: "bounded_cutover_plan_required" }, 409);
  } else {
    await DB.batch([
      DB.prepare("UPDATE creator_media_source_states SET active_backend='dropbox',migration_state='rollback',dropbox_fallback_enabled=1,cutover_by=?,cutover_at=CURRENT_TIMESTAMP,rollback_reason=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(context.email, reason || "manual_rollback", context.creator.creator_id),
      DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?, 'rollback_completed',?)").bind(crypto.randomUUID(), context.creator.creator_id, context.email, context.creator.role, JSON.stringify({ backend: "dropbox", reason: reason || "manual_rollback" })),
      identityAuditStatement(DB, humanAuditActor(context), "source_media_rollback_completed", context.creator.creator_id, { backend: "dropbox", reason: reason || "manual_rollback" }),
    ]);
  }
  return noStoreJson({ ok: true, backend });
}
