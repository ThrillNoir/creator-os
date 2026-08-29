import { identityAuditStatement, type AuditActor } from "@/lib/audit-identity";

export type VideoIngestSession = {
  id: string;
  asset_id: string;
  storage_object_id: string;
  object_key: string;
  multipart_upload_id: string | null;
  finalization_state: string;
};

type LifecycleActor = { email: string; role: string; audit: AuditActor };

/**
 * A confirmed multipart abort makes every uploaded part unusable. Transition
 * every projection in the same D1 batch so no Library card can stay in the
 * misleading `uploading` state after a terminal ingest outcome.
 */
export async function archiveTerminalVideoIngest(
  DB: D1Database,
  session: VideoIngestSession,
  creatorId: string,
  outcome: "expired" | "failed" | "aborted",
  failureCode: string,
  actor: LifecycleActor,
) {
  const finalization = outcome === "expired" ? "expired" : outcome === "aborted" ? "aborted" : "failed";
  await DB.batch([
    DB.prepare("UPDATE asset_video_ingest_sessions SET status=?,finalization_state=?,failure_code=?,multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state<>'verified'")
      .bind(outcome, finalization, failureCode, session.id, creatorId),
    DB.prepare("UPDATE asset_video_ingest_parts SET status='failed',failure_code=COALESCE(failure_code,?),updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND creator_id=? AND status<>'failed'")
      .bind(failureCode, session.id, creatorId),
    DB.prepare("UPDATE asset_storage_objects SET ingest_status='failed',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND ingest_status<>'verified'")
      .bind(failureCode, session.storage_object_id, creatorId),
    DB.prepare("UPDATE asset_media_authorities SET state='archived',preview_failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND authority_kind='r2_native' AND state<>'canonical_verified'")
      .bind(failureCode, session.asset_id, creatorId),
    DB.prepare("UPDATE asset_video_playback_states SET state='archived',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state<>'playback_ready'")
      .bind(failureCode, session.asset_id, creatorId),
    DB.prepare("UPDATE assets SET source_available=0,indexed_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND source_available<>0")
      .bind(session.asset_id, creatorId),
    DB.prepare("INSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'ingest_failed',?)")
      .bind(crypto.randomUUID(), creatorId, session.asset_id, session.id, actor.email, actor.role, JSON.stringify({ outcome, failureCode })),
    identityAuditStatement(DB, actor.audit, "native_video_ingest_terminal", session.asset_id, { outcome, failureCode }),
  ]);
}

/** Abort first. If R2 does not positively acknowledge the abort, preserve the
 * multipart identity and leave projections untouched for bounded recovery. */
export async function expireVideoIngest(
  DB: D1Database,
  bucket: R2Bucket,
  session: VideoIngestSession,
  creatorId: string,
  actor: LifecycleActor,
) {
  if (!session.multipart_upload_id) return { expired: false, uncertain: true };
  try {
    await bucket.resumeMultipartUpload(session.object_key, session.multipart_upload_id).abort();
    await archiveTerminalVideoIngest(DB, session, creatorId, "expired", "session_expired", actor);
    return { expired: true, uncertain: false };
  } catch {
    await DB.prepare("UPDATE asset_video_ingest_sessions SET failure_code='expiry_abort_uncertain',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete'")
      .bind(session.id, creatorId).run().catch(() => undefined);
    return { expired: false, uncertain: true };
  }
}

/** Used only after a multipart completion is conclusively absent. It has the
 * same abort-before-D1 invariant as expiry, but records a terminal failure
 * instead of presenting an expiry outcome to the owner. */
export async function failVideoIngestAfterAbort(
  DB: D1Database,
  bucket: R2Bucket,
  session: VideoIngestSession,
  creatorId: string,
  failureCode: string,
  actor: LifecycleActor,
) {
  if (!session.multipart_upload_id) return { failed: false, uncertain: true };
  try {
    await bucket.resumeMultipartUpload(session.object_key, session.multipart_upload_id).abort();
    await archiveTerminalVideoIngest(DB, session, creatorId, "failed", failureCode, actor);
    return { failed: true, uncertain: false };
  } catch {
    await DB.prepare("UPDATE asset_video_ingest_sessions SET failure_code='completion_abort_uncertain',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')")
      .bind(session.id, creatorId).run().catch(() => undefined);
    return { failed: false, uncertain: true };
  }
}
