import { humanAuditActor, identityAuditStatement, isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { archiveTerminalVideoIngest, expireVideoIngest, failVideoIngestAfterAbort } from "@/lib/native-video-lifecycle";
import { expectedPartBytes, hashAndValidateR2Object, noStoreJson, safeFailureCode } from "@/lib/source-media";

type Context = Awaited<ReturnType<typeof requireCreatorContext>>;
type Session = { id: string; asset_id: string; storage_object_id: string; object_key: string; multipart_upload_id: string | null; expected_sha256: string; expected_bytes: number; expected_mime_type: string; chunk_bytes: number; status: string; finalization_state: string; expires_at: string };
type Part = { part_number: number; etag: string | null; byte_count: number; status: string };
function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

async function quarantine(DB: D1Database, session: Session, creatorId: string, failure: string, context: Context) {
  await archiveTerminalVideoIngest(DB, session, creatorId, "failed", failure, { audit: humanAuditActor(context), email: context.email, role: context.creator.role });
}

async function verifyAndPersist(DB: D1Database, bucket: R2Bucket, session: Session, creatorId: string, context: Context) {
  await DB.prepare("UPDATE asset_video_ingest_sessions SET finalization_state='verifying',reconcile_attempts=reconcile_attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(session.id, creatorId).run();
  const verified = await hashAndValidateR2Object(bucket, session.object_key, undefined, { allowVideo: true });
  if (!verified.codec || !["h264", "h265"].includes(verified.codec) || verified.byteCount !== session.expected_bytes || verified.sha256 !== session.expected_sha256 || verified.detectedMime !== session.expected_mime_type) {
    await quarantine(DB, session, creatorId, "source_media_verification_failed", context);
    throw new Error("source_media_verification_failed");
  }
  await DB.batch([
    DB.prepare("UPDATE asset_video_ingest_sessions SET status='finalized',finalization_state='verified',completed_r2_version=?,completed_r2_etag=?,completion_observed_at=COALESCE(completion_observed_at,CURRENT_TIMESTAMP),multipart_upload_id=NULL,uploaded_bytes=?,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(verified.r2Version, verified.r2Etag, verified.byteCount, session.id, creatorId),
    DB.prepare("UPDATE asset_storage_objects SET ingest_status='verified',verified_mime_type=?,sha256=?,r2_version=?,r2_etag=?,uploaded_at=COALESCE(uploaded_at,CURRENT_TIMESTAMP),verified_at=CURRENT_TIMESTAMP,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND ingest_status<>'verified'").bind(verified.detectedMime, verified.sha256, verified.r2Version, verified.r2Etag, session.storage_object_id, creatorId),
    DB.prepare("UPDATE asset_media_authorities SET state='canonical_verified',preview_failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND authority_kind='r2_native' AND state='ingesting'").bind(session.asset_id, creatorId),
    DB.prepare("UPDATE asset_video_playback_states SET state='canonical_verified',source_codec=?,playback_provider='none',playback_external_id=NULL,playback_manifest_path=NULL,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=?").bind(verified.codec, session.asset_id, creatorId),
    DB.prepare("INSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'ingest_verified',?)").bind(crypto.randomUUID(), creatorId, session.asset_id, session.id, context.email, context.creator.role, JSON.stringify({ byteCount: verified.byteCount, mimeType: verified.detectedMime, codec: verified.codec, playback: "provider_not_configured" })),
    identityAuditStatement(DB, humanAuditActor(context), "native_video_ingest_verified", session.asset_id, { byteCount: verified.byteCount, mimeType: verified.detectedMime, codec: verified.codec, playback: "provider_not_configured" }),
  ]);
  return verified.codec;
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { sessionId } = await params;
  if (!validUuid(sessionId)) return noStoreJson({ ok: false, error: "invalid_session" }, 400);
  const context = await requireCreatorContext("mutate");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const session = await DB.prepare("SELECT id,asset_id,storage_object_id,object_key,multipart_upload_id,expected_sha256,expected_bytes,expected_mime_type,chunk_bytes,status,finalization_state,expires_at FROM asset_video_ingest_sessions WHERE id=? AND creator_id=?").bind(sessionId, context.creator.creator_id).first<Session>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  if (session.status === "finalized" && session.finalization_state === "verified") {
    const playback = await DB.prepare("SELECT state,source_codec,playback_provider FROM asset_video_playback_states WHERE asset_id=? AND creator_id=?").bind(session.asset_id, context.creator.creator_id).first<{ state: string; source_codec: string | null; playback_provider: string }>();
    return noStoreJson({ ok: true, sessionId: session.id, status: "finalized", replay: true, playback: playback?.state === "playback_ready" ? "ready" : "provider_not_configured", sourceCodec: playback?.source_codec ?? undefined });
  }
  if (["quarantined", "failed", "expired", "aborted"].includes(session.finalization_state)) return noStoreJson({ ok: false, error: `session_${session.finalization_state}` }, 409);
  if (["completing", "completed_unreconciled", "verifying"].includes(session.finalization_state)) {
    try {
      const head = await LIBRARY_MEDIA.head(session.object_key);
      if (!head) {
        const result = await failVideoIngestAfterAbort(DB, LIBRARY_MEDIA, session, context.creator.creator_id, "multipart_completion_failed", { audit: humanAuditActor(context), email: context.email, role: context.creator.role });
        return noStoreJson({ ok: false, error: result.failed ? "session_failed" : "completion_abort_uncertain" }, result.failed ? 422 : 503);
      }
      await DB.prepare("UPDATE asset_video_ingest_sessions SET finalization_state='completed_unreconciled',completed_r2_version=?,completed_r2_etag=?,completion_observed_at=COALESCE(completion_observed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(head.version, head.etag, session.id, context.creator.creator_id).run();
      const sourceCodec = await verifyAndPersist(DB, LIBRARY_MEDIA, session, context.creator.creator_id, context);
      return noStoreJson({ ok: true, sessionId: session.id, status: "finalized", reconciled: true, playback: "provider_not_configured", sourceCodec });
    } catch (error) { return noStoreJson({ ok: false, error: safeFailureCode(error, "reconciliation_required") }, 409); }
  }
  if (!session.multipart_upload_id || Date.parse(session.expires_at) <= Date.now()) {
    const result = await expireVideoIngest(DB, LIBRARY_MEDIA, session, context.creator.creator_id, { audit: humanAuditActor(context), email: context.email, role: context.creator.role });
    return noStoreJson({ ok: false, error: result.expired ? "session_expired" : "expiry_abort_uncertain" }, result.expired ? 410 : 503);
  }
  const parts = (await DB.prepare("SELECT part_number,etag,byte_count,status FROM asset_video_ingest_parts WHERE session_id=? ORDER BY part_number").bind(session.id).all<Part>()).results;
  const partCount = Math.ceil(session.expected_bytes / session.chunk_bytes);
  if (parts.length !== partCount || parts.some((part, index) => part.status !== "uploaded" || !part.etag || part.part_number !== index + 1 || part.byte_count !== expectedPartBytes(session.expected_bytes, index + 1, session.chunk_bytes))) return noStoreJson({ ok: false, error: "parts_incomplete" }, 409);
  const claimed = await DB.prepare("UPDATE asset_video_ingest_sessions SET finalization_state='completing',failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete' AND status IN ('created','uploading')").bind(session.id, context.creator.creator_id).run();
  if (!claimed.meta?.changes) return noStoreJson({ ok: false, error: "finalization_in_progress" }, 409);
  try {
    const completed = await LIBRARY_MEDIA.resumeMultipartUpload(session.object_key, session.multipart_upload_id).complete(parts.map((part) => ({ partNumber: part.part_number, etag: part.etag! })));
    await DB.prepare("UPDATE asset_video_ingest_sessions SET finalization_state='completed_unreconciled',completed_r2_version=?,completed_r2_etag=?,completion_observed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='completing'").bind(completed.version, completed.etag, session.id, context.creator.creator_id).run();
    const sourceCodec = await verifyAndPersist(DB, LIBRARY_MEDIA, session, context.creator.creator_id, context);
    return noStoreJson({ ok: true, sessionId: session.id, status: "finalized", playback: "provider_not_configured", sourceCodec });
  } catch (error) {
    const failure = safeFailureCode(error, "completed_unreconciled");
    await DB.prepare("UPDATE asset_video_ingest_sessions SET failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(failure, session.id, context.creator.creator_id).run().catch(() => undefined);
    return noStoreJson({ ok: false, error: failure === "source_media_verification_failed" ? failure : "completion_requires_reconciliation" }, failure === "source_media_verification_failed" ? 422 : 503);
  }
}
