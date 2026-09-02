export type NativeImageTerminalSession = { id: string; asset_id: string; storage_object_id: string | null };
export type NativeImageTerminalStatement = { sql: string; params: unknown[] };

/** Keep every image-ingest projection terminal together and make late failure
 * reports harmless once the canonical source has been verified. */
export function buildNativeImageTerminalStatements(
  session: NativeImageTerminalSession,
  creatorId: string,
  outcome: "quarantined" | "expired",
  failureCode: string,
): NativeImageTerminalStatement[] {
  const finalizationState = outcome;
  const status = outcome === "expired" ? "expired" : "failed";
  return [
    {
      sql: "UPDATE asset_ingest_sessions SET status=?,finalization_state=?,failure_code=?,multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state<>'verified'",
      params: [status, finalizationState, failureCode, session.id, creatorId],
    },
    {
      sql: "UPDATE asset_ingest_parts SET status='failed',failure_code=COALESCE(failure_code,?),updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND creator_id=? AND status<>'failed' AND EXISTS (SELECT 1 FROM asset_ingest_sessions s WHERE s.id=? AND s.creator_id=? AND s.finalization_state=?)",
      params: [failureCode, session.id, creatorId, session.id, creatorId, finalizationState],
    },
    {
      sql: "UPDATE asset_storage_objects SET ingest_status='failed',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND ingest_status<>'verified' AND EXISTS (SELECT 1 FROM asset_ingest_sessions s WHERE s.id=? AND s.creator_id=? AND s.finalization_state=?)",
      params: [failureCode, session.storage_object_id, creatorId, session.id, creatorId, finalizationState],
    },
    {
      sql: "UPDATE asset_media_authorities SET state='archived',preview_failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND authority_kind='r2_native' AND state='ingesting' AND EXISTS (SELECT 1 FROM asset_ingest_sessions s WHERE s.id=? AND s.creator_id=? AND s.finalization_state=?)",
      params: [failureCode, session.asset_id, creatorId, session.id, creatorId, finalizationState],
    },
    {
      sql: "UPDATE assets SET source_available=0,indexed_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND source_available<>0 AND EXISTS (SELECT 1 FROM asset_media_authorities WHERE asset_id=? AND creator_id=? AND authority_kind='r2_native' AND state='archived' AND preview_failure_code=?)",
      params: [session.asset_id, creatorId, session.asset_id, creatorId, failureCode],
    },
  ];
}
