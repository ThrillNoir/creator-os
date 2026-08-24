import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { isSameOriginRequest } from "@/lib/audit-identity";
import { CloudflareProfileImageProcessor, PROFILE_IMAGE_MAX_BYTES, type ProfileImageRole, type ProfileImageSurface } from "@/lib/profile-image-processing";

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

class UploadFailure extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

async function markRejected(DB: D1Database, uploadId: string, creatorId: string, code: string) {
  await DB.prepare("UPDATE creator_profile_image_uploads SET status='rejected',reason_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='processing'").bind(code, uploadId, creatorId).run();
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ ok: false, error: "same_origin_required" }, { status: 403, headers: { "cache-control": "no-store" } });
  const context = await requireCreatorContext("mutate");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const surface = field(form?.get("surface") ?? null) as ProfileImageSurface;
  const role = field(form?.get("role") ?? null) as ProfileImageRole;
  const versionId = field(form?.get("versionId") ?? null);
  if (!(file instanceof File) || !["public_sfw", "adult_profile"].includes(surface) || !["avatar", "background"].includes(role) || !VERSION_ID.test(versionId)) return Response.json({ ok: false, error: "invalid_upload_request" }, { status: 400 });
  if (file.size > PROFILE_IMAGE_MAX_BYTES) return Response.json({ ok: false, error: "file_too_large" }, { status: 400, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  const env = cloudflareEnv() as CloudflareEnv & { IMAGES?: ImagesBinding };
  const { DB, MEDIA, IMAGES } = env;
  if (!IMAGES) return Response.json({ ok: false, error: "profile_image_processing_unavailable" }, { status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  const creatorId = context.creator.creator_id;
  const version = surface === "public_sfw"
    ? await DB.prepare("SELECT id FROM creator_public_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first<{ id: string }>()
    : await DB.prepare("SELECT id FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first<{ id: string }>();
  if (!version) return Response.json({ ok: false, error: "draft_required" }, { status: 409 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploadId = crypto.randomUUID();
  const originalKey = `profile-private/${creatorId}/${surface}/${uploadId}/original`;
  const storedKeys: string[] = [];
  let persistedUpload = false;
  try {
    const processed = await new CloudflareProfileImageProcessor(IMAGES).process({ bytes, declaredContentType: file.type, role });
    try {
      await DB.prepare(`INSERT INTO creator_profile_image_uploads
        (id,creator_id,surface,image_role,original_object_key,declared_content_type,detected_content_type,byte_size,source_sha256,width,height,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'processing')`).bind(uploadId, creatorId, surface, role, originalKey, file.type, processed.detectedContentType, bytes.byteLength, processed.sourceSha256, processed.width, processed.height).run();
      persistedUpload = true;
    } catch {
      throw new UploadFailure("database_write_failed", 503);
    }
    const displayId = crypto.randomUUID();
    const previewId = crypto.randomUUID();
    const displayKey = `profile-private/${creatorId}/${surface}/${uploadId}/display.webp`;
    const previewKey = `profile-private/${creatorId}/${surface}/${uploadId}/preview.webp`;
    try {
      for (const [key, content, contentType] of [
        [originalKey, bytes, processed.detectedContentType],
        [displayKey, processed.display.bytes, "image/webp"],
        [previewKey, processed.preview.bytes, "image/webp"],
      ] as const) {
        // Register attempted keys before put so a response failure cannot
        // orphan a newly-written private object. All keys are server-derived.
        storedKeys.push(key);
        const object = await MEDIA.put(key, content, { httpMetadata: { contentType } });
        if (!object) throw new Error("r2_put_failed");
      }
    } catch {
      throw new UploadFailure("media_storage_failed", 503);
    }
    const attachmentId = crypto.randomUUID();
    try {
      await DB.batch([
        DB.prepare(`INSERT INTO creator_profile_image_derivatives
        (id,creator_id,upload_id,derivative_kind,object_key,content_type,byte_size,width,height,sha256)
        VALUES (?,?,?,'display',?,'image/webp',?,?,?,?)`).bind(displayId, creatorId, uploadId, displayKey, processed.display.bytes.byteLength, processed.display.width, processed.display.height, processed.display.sha256),
      DB.prepare(`INSERT INTO creator_profile_image_derivatives
        (id,creator_id,upload_id,derivative_kind,object_key,content_type,byte_size,width,height,sha256)
        VALUES (?,?,?,'preview',?,'image/webp',?,?,?,?)`).bind(previewId, creatorId, uploadId, previewKey, processed.preview.bytes.byteLength, processed.preview.width, processed.preview.height, processed.preview.sha256),
      // The attachment trigger permits only processed uploads. This is kept in
      // the same D1 batch so a later attachment failure rolls it back too.
      DB.prepare("UPDATE creator_profile_image_uploads SET status='processed',reason_code='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='processing'").bind(uploadId, creatorId),
      DB.prepare(`UPDATE creator_profile_image_attachments SET status='detached',detached_at=CURRENT_TIMESTAMP
        WHERE creator_id=? AND surface=? AND image_role=? AND status='attached' AND ${surface === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id"}=?`).bind(creatorId, surface, role, versionId),
      DB.prepare(`INSERT INTO creator_profile_image_attachments
        (id,creator_id,surface,image_role,${surface === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id"},derivative_id)
        VALUES (?,?,?,?,?,?)`).bind(attachmentId, creatorId, surface, role, versionId, displayId),
      ]);
    } catch {
      throw new UploadFailure("database_write_failed", 503);
    }
    return Response.json({ ok: true, attachment: { id: attachmentId, role, status: "ready", previewUrl: `/api/profile-image/${attachmentId}` } }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    const failure = error instanceof UploadFailure ? error : new UploadFailure(reasonCode(error), 400);
    if (storedKeys.length) await MEDIA.delete(storedKeys).catch(() => undefined);
    if (persistedUpload) await markRejected(DB, uploadId, creatorId, failure.code).catch(() => undefined);
    return Response.json({ ok: false, error: failure.code }, { status: failure.status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
}
