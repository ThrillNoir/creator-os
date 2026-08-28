import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { getCreatorMediaSourceState, noStoreJson, sourceMediaObjectHeaders } from "@/lib/source-media";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!assetId || assetId.length > 200) return noStoreJson({ ok: false, error: "invalid_asset" }, 400);
  const context = await requireCreatorContext("view");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const state = await getCreatorMediaSourceState(DB, context.creator.creator_id);
  if (state.active_backend !== "r2") return noStoreJson({ ok: false, error: "r2_source_not_active" }, 409);
  const record = await DB.prepare(`SELECT object_key,byte_count,verified_mime_type,sha256
    FROM asset_storage_objects WHERE creator_id=? AND asset_id=? AND provider='r2' AND storage_role='canonical_original'
      AND bucket_role='library_media' AND ingest_status='verified' ORDER BY verified_at DESC LIMIT 1`)
    .bind(context.creator.creator_id, assetId).first<{ object_key: string; byte_count: number; verified_mime_type: string; sha256: string }>();
  if (!record) return noStoreJson({ ok: false, error: "source_object_not_verified" }, 404);
  const object = await LIBRARY_MEDIA.get(record.object_key);
  // The object was byte-for-byte hashed before its verified D1 record was
  // created. Delivery repeats the immutable size check and never falls back to
  // Dropbox while R2 is active; CLI-imported objects need not expose custom
  // metadata to satisfy this boundary.
  if (!object || object.size !== record.byte_count) return noStoreJson({ ok: false, error: "source_object_integrity_failed" }, 409);
  return new Response(object.body, { headers: sourceMediaObjectHeaders(record.verified_mime_type, record.byte_count) });
}
