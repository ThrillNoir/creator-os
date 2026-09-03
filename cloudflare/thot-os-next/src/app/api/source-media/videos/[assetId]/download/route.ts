import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { parseSingleRange } from "@/lib/source-media-algorithms";
import { immutableR2IdentityMatches, noStoreHeaders, noStoreJson } from "@/lib/source-media";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return noStoreJson({ ok: false, error: "invalid_asset" }, 400);
  const context = await requireCreatorContext("view");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const record = await DB.prepare(`SELECT o.object_key,o.byte_count,o.verified_mime_type,o.r2_version,o.r2_etag
    FROM asset_video_playback_states vp
    JOIN asset_storage_objects o ON o.id=vp.canonical_storage_object_id AND o.creator_id=vp.creator_id AND o.asset_id=vp.asset_id
    JOIN assets a ON a.id=vp.asset_id AND a.creator_id=vp.creator_id
    WHERE vp.creator_id=? AND vp.asset_id=? AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')
      AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
      AND a.source_available=1`).bind(context.creator.creator_id, assetId)
    .first<{ object_key: string; byte_count: number; verified_mime_type: string; r2_version: string | null; r2_etag: string | null }>();
  if (!record || !record.r2_version || !record.r2_etag) return noStoreJson({ ok: false, error: "video_original_unavailable" }, 404);
  const head = await LIBRARY_MEDIA.head(record.object_key);
  if (!immutableR2IdentityMatches(record, head)) return noStoreJson({ ok: false, error: "source_object_integrity_failed" }, 409);
  const range = parseSingleRange(request.headers.get("range"), record.byte_count);
  if (range === "invalid") return new Response(null, { status: 416, headers: noStoreHeaders({ "content-range": `bytes */${record.byte_count}`, "accept-ranges": "bytes" }) });
  const object = await LIBRARY_MEDIA.get(record.object_key, { onlyIf: { etagMatches: record.r2_etag }, ...(range ? { range } : {}) });
  if (!object || !("body" in object) || !immutableR2IdentityMatches(record, object)) return noStoreJson({ ok: false, error: "source_object_integrity_failed" }, 409);
  const length = range?.length ?? record.byte_count;
  const headers = noStoreHeaders({
    "content-type": record.verified_mime_type,
    "content-length": String(length),
    "content-disposition": new URL(request.url).searchParams.get("preview") === "1" ? "inline" : "attachment",
    "accept-ranges": "bytes",
  });
  return new Response(object.body, { status: range ? 206 : 200, headers: range ? { ...headers, "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${record.byte_count}` } : headers });
}
