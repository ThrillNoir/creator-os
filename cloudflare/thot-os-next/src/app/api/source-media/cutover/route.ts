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
  const { DB } = cloudflareEnv();
  if (backend === "r2") {
    const counts = await DB.prepare(`SELECT
      SUM(CASE WHEN source_available=1 THEN 1 ELSE 0 END) AS source_assets,
      SUM(CASE WHEN source_available=1 AND EXISTS (
        SELECT 1 FROM asset_storage_objects o WHERE o.creator_id=assets.creator_id AND o.asset_id=assets.id
          AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
      ) THEN 1 ELSE 0 END) AS verified_assets
      FROM assets WHERE creator_id=?`).bind(context.creator.creator_id).first<{ source_assets: number; verified_assets: number }>();
    if (!counts?.source_assets || counts.verified_assets !== counts.source_assets) return noStoreJson({ ok: false, error: "verified_inventory_required" }, 409);
    await DB.batch([
      DB.prepare("UPDATE creator_media_source_states SET active_backend='r2',migration_state='r2_active',dropbox_fallback_enabled=0,cutover_by=?,cutover_at=CURRENT_TIMESTAMP,rollback_reason='',updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(context.email, context.creator.creator_id),
      DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?, 'cutover_completed',?)").bind(crypto.randomUUID(), context.creator.creator_id, context.email, context.creator.role, JSON.stringify({ backend: "r2", verifiedAssets: counts.verified_assets })),
      identityAuditStatement(DB, humanAuditActor(context), "source_media_cutover_completed", context.creator.creator_id, { backend: "r2", verifiedAssets: counts.verified_assets }),
    ]);
  } else {
    await DB.batch([
      DB.prepare("UPDATE creator_media_source_states SET active_backend='dropbox',migration_state='rollback',dropbox_fallback_enabled=1,cutover_by=?,cutover_at=CURRENT_TIMESTAMP,rollback_reason=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(context.email, reason || "manual_rollback", context.creator.creator_id),
      DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?, 'rollback_completed',?)").bind(crypto.randomUUID(), context.creator.creator_id, context.email, context.creator.role, JSON.stringify({ backend: "dropbox", reason: reason || "manual_rollback" })),
      identityAuditStatement(DB, humanAuditActor(context), "source_media_rollback_completed", context.creator.creator_id, { backend: "dropbox", reason: reason || "manual_rollback" }),
    ]);
  }
  return noStoreJson({ ok: true, backend });
}
