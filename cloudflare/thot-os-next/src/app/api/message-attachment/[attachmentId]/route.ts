import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { immutableR2IdentityMatches } from "@/lib/source-media";

export async function GET(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const context = await requireCreatorContext();
  const { attachmentId } = await params;
  if (!/^instagram-attachment-[a-f0-9]{40}$/.test(attachmentId)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const { DB, PREVIEWS, LIBRARY_MEDIA } = cloudflareEnv();
  const attachment = await DB.prepare(`SELECT a.object_key,a.asset_id,a.asset_sha256,a.asset_bytes,a.asset_mime_type,a.asset_r2_version,a.asset_r2_etag,a.mime_type FROM message_attachments a
    JOIN messages m ON m.id=a.message_id AND m.creator_id=a.creator_id
    JOIN message_threads t ON t.id=m.thread_id AND t.creator_id=m.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.status='ready' AND (a.object_key IS NOT NULL OR a.asset_id IS NOT NULL)`)
    .bind(attachmentId, context.creator.creator_id).first<{ object_key: string | null; asset_id: string | null; asset_sha256: string | null; asset_bytes: number | null; asset_mime_type: string | null; asset_r2_version: string | null; asset_r2_etag: string | null; mime_type: string | null }>();
  if (!attachment) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const rangeHeader = request.headers.get("range");
  let bucket: R2Bucket = PREVIEWS;
  let objectKey = attachment.object_key;
  let expected: { byte_count: number; r2_version: string; r2_etag: string; mime_type: string; sha256: string } | null = null;
  if (attachment.asset_id) {
    if (!LIBRARY_MEDIA) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    const source = await DB.prepare(`SELECT o.object_key,o.byte_count,o.verified_mime_type AS mime_type,o.sha256,o.r2_version,o.r2_etag
      FROM asset_storage_objects o JOIN assets a ON a.id=o.asset_id AND a.creator_id=o.creator_id
      JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
      WHERE o.creator_id=? AND o.asset_id=? AND o.provider='r2' AND o.storage_role='canonical_original'
        AND o.bucket_role='library_media' AND o.ingest_status='verified' AND o.object_key=a.media_r2_key
        AND a.source_available=1 AND ma.state IN ('canonical_verified','preview_ready')
        AND ma.canonical_storage_object_id=o.id
        AND o.r2_version IS NOT NULL AND o.r2_etag IS NOT NULL ORDER BY o.verified_at DESC LIMIT 1`)
      .bind(context.creator.creator_id, attachment.asset_id).first<{ object_key: string; byte_count: number; mime_type: string; sha256: string; r2_version: string; r2_etag: string }>();
    if (!source) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    if (source.sha256 !== attachment.asset_sha256 || source.byte_count !== attachment.asset_bytes || source.mime_type !== attachment.asset_mime_type || source.r2_version !== attachment.asset_r2_version || source.r2_etag !== attachment.asset_r2_etag) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    bucket = LIBRARY_MEDIA;
    objectKey = source.object_key;
    expected = source;
    if (!immutableR2IdentityMatches(source, await bucket.head(objectKey))) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!objectKey) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const object = await bucket.get(objectKey, expected ? { onlyIf: { etagMatches: expected.r2_etag }, ...(rangeHeader ? { range: request.headers } : {}) } : rangeHeader ? { range: request.headers } : undefined);
  if (!object) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  if (expected && (!('body' in object) || !immutableR2IdentityMatches(expected, object))) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-type": object.httpMetadata?.contentType ?? expected?.mime_type ?? attachment.mime_type ?? "application/octet-stream",
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
  });
  let status = 200;
  if (object.range && "offset" in object.range && typeof object.range.offset === "number" && "length" in object.range && typeof object.range.length === "number") {
    status = 206;
    headers.set("content-length", String(object.range.length));
    headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(object.body, { status, headers });
}
