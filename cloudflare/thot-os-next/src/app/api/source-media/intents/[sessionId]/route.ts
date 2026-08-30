import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { noStoreJson } from "@/lib/source-media";

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!validUuid(sessionId)) return noStoreJson({ ok: false, error: "invalid_session" }, 400);
  const context = await requireCreatorContext("view");
  const session = await cloudflareEnv().DB.prepare(`SELECT id,asset_id,status,expected_bytes,expected_mime_type,uploaded_bytes,expires_at,failure_code
    FROM asset_ingest_sessions WHERE id=? AND creator_id=?`).bind(sessionId, context.creator.creator_id)
    .first<{ id: string; asset_id: string; status: string; expected_bytes: number; expected_mime_type: string; uploaded_bytes: number; expires_at: string; failure_code: string | null }>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  return noStoreJson({ ok: true, session: { id: session.id, assetId: session.asset_id, status: session.status, expectedBytes: session.expected_bytes, expectedMimeType: session.expected_mime_type, uploadedBytes: session.uploaded_bytes, expiresAt: session.expires_at, failure: session.failure_code } });
}
