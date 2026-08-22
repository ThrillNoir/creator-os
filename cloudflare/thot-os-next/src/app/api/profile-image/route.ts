import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { isSameOriginRequest } from "@/lib/audit-identity";
import { localSharpProfileImageProcessor, profileImageProcessorAvailable, type ProfileImageRole, type ProfileImageSurface } from "@/lib/profile-image-processing";

export const runtime = "nodejs";

const VERSION_ID = /^[a-zA-Z0-9_-]{1,160}$/;

function field(value: FormDataEntryValue | null) { return typeof value === "string" ? value : ""; }
function reasonCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/12 MB/.test(message)) return "file_too_large";
  if (/dimensions/.test(message)) return "image_too_large";
  if (/Animated/.test(message)) return "animated_not_supported";
  if (/type/.test(message) || /JPEG/.test(message)) return "unsupported_image_type";
  return "image_processing_failed";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ ok: false, error: "same_origin_required" }, { status: 403, headers: { "cache-control": "no-store" } });
  const context = await requireCreatorContext("mutate");
  if (!profileImageProcessorAvailable()) return Response.json({ ok: false, error: "profile_image_processing_unavailable" }, { status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const surface = field(form?.get("surface") ?? null) as ProfileImageSurface;
  const role = field(form?.get("role") ?? null) as ProfileImageRole;
  const versionId = field(form?.get("versionId") ?? null);
  if (!(file instanceof File) || !["public_sfw", "adult_profile"].includes(surface) || !["avatar", "background"].includes(role) || !VERSION_ID.test(versionId)) return Response.json({ ok: false, error: "invalid_upload_request" }, { status: 400 });
  const { DB, MEDIA } = cloudflareEnv();
  const creatorId = context.creator.creator_id;
  const version = surface === "public_sfw"
    ? await DB.prepare("SELECT id FROM creator_public_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first<{ id: string }>()
    : await DB.prepare("SELECT id FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first<{ id: string }>();
  if (!version) return Response.json({ ok: false, error: "draft_required" }, { status: 409 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploadId = crypto.randomUUID();
  const originalKey = `profile-private/${creatorId}/${surface}/${uploadId}/original`;
  try {
    const processed = await localSharpProfileImageProcessor.process({ bytes, declaredContentType: file.type, role });
    await MEDIA.put(originalKey, bytes, { httpMetadata: { contentType: processed.detectedContentType } });
    const displayId = crypto.randomUUID();
    const previewId = crypto.randomUUID();
    const displayKey = `profile-private/${creatorId}/${surface}/${uploadId}/display.webp`;
    const previewKey = `profile-private/${creatorId}/${surface}/${uploadId}/preview.webp`;
    await Promise.all([
      MEDIA.put(displayKey, processed.display.bytes, { httpMetadata: { contentType: "image/webp" } }),
      MEDIA.put(previewKey, processed.preview.bytes, { httpMetadata: { contentType: "image/webp" } }),
    ]);
    const attachmentId = crypto.randomUUID();
    await DB.batch([
      DB.prepare(`INSERT INTO creator_profile_image_uploads
        (id,creator_id,surface,image_role,original_object_key,declared_content_type,detected_content_type,byte_size,source_sha256,width,height,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'processed')`).bind(uploadId, creatorId, surface, role, originalKey, file.type, processed.detectedContentType, bytes.byteLength, processed.sourceSha256, processed.width, processed.height),
      DB.prepare(`INSERT INTO creator_profile_image_derivatives
        (id,creator_id,upload_id,derivative_kind,object_key,content_type,byte_size,width,height,sha256)
        VALUES (?,?,?,'display',?,'image/webp',?,?,?,?)`).bind(displayId, creatorId, uploadId, displayKey, processed.display.bytes.byteLength, processed.display.width, processed.display.height, processed.display.sha256),
      DB.prepare(`INSERT INTO creator_profile_image_derivatives
        (id,creator_id,upload_id,derivative_kind,object_key,content_type,byte_size,width,height,sha256)
        VALUES (?,?,?,'preview',?,'image/webp',?,?,?,?)`).bind(previewId, creatorId, uploadId, previewKey, processed.preview.bytes.byteLength, processed.preview.width, processed.preview.height, processed.preview.sha256),
      DB.prepare(`UPDATE creator_profile_image_attachments SET status='detached',detached_at=CURRENT_TIMESTAMP
        WHERE creator_id=? AND surface=? AND image_role=? AND status='attached' AND ${surface === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id"}=?`).bind(creatorId, surface, role, versionId),
      DB.prepare(`INSERT INTO creator_profile_image_attachments
        (id,creator_id,surface,image_role,${surface === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id"},derivative_id)
        VALUES (?,?,?,?,?,?)`).bind(attachmentId, creatorId, surface, role, versionId, displayId),
    ]);
    return Response.json({ ok: true, attachment: { id: attachmentId, role, status: "ready", previewUrl: `/api/profile-image/${attachmentId}` } }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    const code = reasonCode(error);
    // No original object is written if validation/decoding fails before storage.
    return Response.json({ ok: false, error: code }, { status: 400, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
}
