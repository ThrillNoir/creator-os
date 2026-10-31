import { generateVideoThumbnail, MAX_VIDEO_BYTES } from "./video-thumbnail-local.mjs";
import { createHash } from "node:crypto";

// Cloudflare-binding-shaped ports, deliberately injected. This module neither
// creates credentials nor connects to remote storage on import.
const CREATOR = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ASSET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_STATES = "('canonical_verified','processing_queued','processing','playback_ready','processing_failed')";
const VERIFIED = `FROM assets a
  JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id
    AND ma.authority_kind='r2_native' AND ma.state='canonical_verified'
  JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    AND vp.canonical_storage_object_id=ma.canonical_storage_object_id
    AND vp.state IN ${VIDEO_STATES} AND vp.source_codec IN ('h264','h265')
  JOIN asset_storage_objects o ON o.id=ma.canonical_storage_object_id
    AND o.asset_id=a.id AND o.creator_id=a.creator_id
    AND o.provider='r2' AND o.storage_role='canonical_original'
    AND o.bucket_role='library_media' AND o.ingest_status='verified'
  WHERE a.source_available=1`;
const SOURCE_FIELDS = `a.creator_id AS creatorId,a.id AS assetId,a.preview_r2_key AS posterKey,
  o.object_key AS sourceKey,o.source_revision AS sourceRevision,o.r2_etag AS etag,
  o.r2_version AS version,o.byte_count AS bytes,vp.source_codec AS codec,
  ma.state AS state`;

function assertIds(creatorId, assetId) {
  if (!CREATOR.test(creatorId) || (assetId != null && !ASSET.test(assetId))) throw new Error("invalid_thumbnail_scope");
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function sameObject(record, source) {
  return record && record.key === source.sourceKey && record.version === source.version
    && record.etag === source.etag && record.size === source.bytes;
}
function changes(result) {
  const count = result?.meta?.changes ?? result?.changes;
  if (!Number.isInteger(count) || count < 0) throw new Error("ambiguous_d1_update");
  return count;
}
const CAS = `UPDATE assets SET preview_r2_key=?
  WHERE id=? AND creator_id=? AND preview_r2_key IS NULL AND source_available=1
    AND EXISTS (SELECT 1 FROM asset_media_authorities ma
      JOIN asset_video_playback_states vp ON vp.asset_id=ma.asset_id AND vp.creator_id=ma.creator_id
        AND vp.canonical_storage_object_id=ma.canonical_storage_object_id
      JOIN asset_storage_objects o ON o.id=ma.canonical_storage_object_id
        AND o.asset_id=ma.asset_id AND o.creator_id=ma.creator_id
      WHERE ma.asset_id=assets.id AND ma.creator_id=assets.creator_id
        AND ma.authority_kind='r2_native' AND ma.state='canonical_verified'
        AND vp.state IN ${VIDEO_STATES} AND vp.source_codec=?
        AND o.provider='r2' AND o.storage_role='canonical_original'
        AND o.bucket_role='library_media' AND o.ingest_status='verified'
        AND o.object_key=? AND o.source_revision=? AND o.r2_etag=?
        AND o.r2_version=? AND o.byte_count=?)`;

export function createVideoThumbnailStorageAdapter({ DB, LIBRARY_MEDIA, PREVIEWS, COMMIT_REFERENCE = null }) {
  if (!DB?.prepare || !LIBRARY_MEDIA?.head || !LIBRARY_MEDIA?.get || !PREVIEWS?.head || !PREVIEWS?.put) {
    throw new Error("thumbnail_storage_bindings_missing");
  }
  if (COMMIT_REFERENCE && typeof COMMIT_REFERENCE.commit !== "function") throw new Error("thumbnail_commit_binding_invalid");
  return {
    async loadSource(creatorId, assetId) {
      assertIds(creatorId, assetId);
      return DB.prepare(`SELECT ${SOURCE_FIELDS} ${VERIFIED} AND a.creator_id=? AND a.id=?`)
        .bind(creatorId, assetId).first();
    },
    async listCandidates(creatorId, afterId = "", limit = 5) {
      assertIds(creatorId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 25 || (afterId && !ASSET.test(afterId))) throw new Error("invalid_thumbnail_page");
      const result = await DB.prepare(`SELECT a.id AS assetId,o.byte_count AS bytes ${VERIFIED}
        AND a.creator_id=? AND a.preview_r2_key IS NULL AND a.id>? ORDER BY a.id LIMIT ?`)
        .bind(creatorId, afterId, limit).all();
      if (!Array.isArray(result?.results)) throw new Error("ambiguous_thumbnail_page");
      return result.results;
    },
    async openSource(source, { signal } = {}) {
      assertIds(source.creatorId, source.assetId);
      if (signal?.aborted) throw new Error("source_open_aborted");
      const head = await LIBRARY_MEDIA.head(source.sourceKey, { signal });
      if (!sameObject(head, source)) throw new Error("source_object_identity_changed");
      if (signal?.aborted) throw new Error("source_open_aborted");
      const object = await LIBRARY_MEDIA.get(source.sourceKey, { onlyIf: { etagMatches: source.etag }, signal });
      if (!sameObject(object, source) || !object.body) throw new Error("source_object_identity_changed");
      if (signal?.aborted) { await object.body.cancel?.(); throw new Error("source_open_aborted"); }
      return { sourceKey: source.sourceKey, version: object.version, etag: object.etag,
        bytes: object.size, stream: object.body };
    },
    async commitPosterIfUnchanged(source, poster) {
      assertIds(source.creatorId, source.assetId);
      if (!poster.bytes?.length || poster.objectId !== digest(`${source.creatorId}:${source.assetId}`)
        || poster.key !== `creators/${source.creatorId}/assets/${poster.objectId}/previews/${digest(poster.bytes)}.jpg`)
        throw new Error("poster_identity_invalid");
      // Fast preflight avoids writing a derivative when a manual poster already won.
      const current = await this.loadSource(source.creatorId, source.assetId);
      if (!current || current.posterKey || current.sourceKey !== source.sourceKey
        || current.sourceRevision !== source.sourceRevision || current.version !== source.version
        || current.etag !== source.etag || current.bytes !== source.bytes || current.codec !== source.codec) return false;
      const head = await LIBRARY_MEDIA.head(source.sourceKey);
      if (!sameObject(head, source)) throw new Error("source_object_identity_changed");
      const existing = await PREVIEWS.head(poster.key);
      if (existing && (existing.customMetadata?.creator_id !== source.creatorId
        || existing.customMetadata?.asset_id !== source.assetId
        || existing.customMetadata?.derivative !== "video_poster_v1")) throw new Error("poster_key_collision");
      if (!existing) {
        const stored = await PREVIEWS.put(poster.key, poster.bytes, {
          httpMetadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
          customMetadata: { creator_id: source.creatorId, asset_id: source.assetId, derivative: "video_poster_v1" },
        });
        if (!stored) throw new Error("poster_storage_failed");
      }
      if (COMMIT_REFERENCE) return COMMIT_REFERENCE.commit(source, poster.key);
      const result = await DB.prepare(CAS).bind(poster.key, source.assetId, source.creatorId,
        source.codec, source.sourceKey, source.sourceRevision, source.etag, source.version, source.bytes).run();
      const count = changes(result);
      if (count > 1) throw new Error("ambiguous_d1_update");
      return count === 1;
    },
  };
}

export async function runVideoThumbnailBatch({ adapter, creatorId, afterId = "", execute = false,
  maxItems = 5, maxSourceBytes = MAX_VIDEO_BYTES, maxFailures = 3, expectedAssetIds = null }) {
  assertIds(creatorId);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 25
    || (afterId && !ASSET.test(afterId))
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > MAX_VIDEO_BYTES
    || !Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 5) throw new Error("invalid_thumbnail_batch_limit");
  const candidates = await adapter.listCandidates(creatorId, afterId, maxItems);
  if (expectedAssetIds && (candidates.length !== expectedAssetIds.length
    || candidates.some((item, index) => item.assetId !== expectedAssetIds[index]))) throw new Error("thumbnail_batch_changed");
  const results = [];
  let bytes = 0;
  let failures = 0;
  for (const item of candidates) {
    if (!ASSET.test(item.assetId) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_VIDEO_BYTES) {
      throw new Error("invalid_thumbnail_candidate");
    }
    if (bytes + item.bytes > maxSourceBytes) { results.push({ assetId: item.assetId, status: "deferred_budget" }); continue; }
    bytes += item.bytes;
    if (!execute) { results.push({ assetId: item.assetId, status: "planned" }); continue; }
    try {
      const result = await generateVideoThumbnail({ creatorId, assetId: item.assetId, ...adapter });
      results.push({ assetId: item.assetId, status: result.status });
    } catch (error) {
      // Report stable codes only; never put private source keys or provider responses in receipts.
      const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "thumbnail_job_failed";
      results.push({ assetId: item.assetId, status: "error", code });
      if (++failures >= maxFailures) break;
    }
  }
  return { creatorId, dryRun: !execute, sourceBytesBudgeted: bytes,
    nextCursor: results.at(-1)?.assetId ?? null, results };
}
