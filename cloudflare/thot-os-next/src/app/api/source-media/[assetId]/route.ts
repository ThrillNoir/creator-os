import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { getCreatorMediaSourceState, immutableR2IdentityMatches, noStoreJson, sourceMediaObjectHeaders } from "@/lib/source-media";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!assetId || assetId.length > 200) return noStoreJson({ ok: false, error: "invalid_asset" }, 400);
  const context = await requireCreatorContext("view");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const state = await getCreatorMediaSourceState(DB, context.creator.creator_id);
  if (state.active_backend !== "r2") return noStoreJson({ ok: false, error: "r2_source_not_active" }, 409);
  const record = await DB.prepare(`SELECT o.object_key,o.byte_count,o.verified_mime_type,o.sha256,o.r2_version,o.r2_etag
    FROM asset_storage_objects o JOIN assets a ON a.id=o.asset_id AND a.creator_id=o.creator_id
    WHERE o.creator_id=? AND o.asset_id=? AND o.provider='r2' AND o.storage_role='canonical_original'
      AND o.bucket_role='library_media' AND o.ingest_status='verified' AND o.source_provider='dropbox'
      AND o.source_revision IS a.dropbox_revision AND o.byte_count=a.bytes AND a.source_available=1
    ORDER BY o.verified_at DESC LIMIT 1`)
    .bind(context.creator.creator_id, assetId).first<{ object_key: string; byte_count: number; verified_mime_type: string; sha256: string; r2_version: string | null; r2_etag: string | null }>();
  if (!record) return noStoreJson({ ok: false, error: "source_object_not_verified" }, 404);
  if (!record.r2_version || !record.r2_etag) return noStoreJson({ ok: false, error: "source_object_identity_missing" }, 409);
  const object = await LIBRARY_MEDIA.get(record.object_key, { onlyIf: { etagMatches: record.r2_etag } });
  if (!object || !("body" in object) || !immutableR2IdentityMatches(record, object)) return noStoreJson({ ok: false, error: "source_object_integrity_failed" }, 409);
  return new Response(object.body, { headers: sourceMediaObjectHeaders(record.verified_mime_type, record.byte_count) });
}
