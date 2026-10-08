import { isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { CloudflareProfileImageProcessor, detectImageType } from "@/lib/profile-image-processing";
import { BOOKING_REPLY_ATTACHMENT_MAX_BYTES, bookingReplyAttachmentKey, isValidBookingReplyPdf, type BookingReplyAttachment } from "../../../../../shared/booking-reply-attachments";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = BOOKING_REPLY_ATTACHMENT_MAX_BYTES + 128 * 1024;

function json(error: string, status: number) {
  return Response.json({ ok: false, error }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

async function boundedFormData(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error("request_too_large");
  if (!request.body) throw new Error("invalid_upload_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new Error("request_too_large"); }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}

function canonicalReplyAttachmentFilename(filename: string, contentType: BookingReplyAttachment["contentType"]) {
  const base = filename.normalize("NFC").split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 170) || "attachment";
  const candidate = base.replace(/\.(?:pdf|jpe?g|png|webp)$/i, "").replace(/[. ]+$/g, "");
  const withoutExtension = /^[\p{L}\p{N}]/u.test(candidate) ? candidate : `attachment-${candidate}`;
  return `${withoutExtension}.${contentType === "application/pdf" ? "pdf" : "webp"}`;
}

async function sha256(bytes: Uint8Array) {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json("same_origin_required", 403);
  const context = await requireCreatorContext("mutate");
  let form: FormData;
  try { form = await boundedFormData(request); } catch (error) { return json(error instanceof Error && error.message === "request_too_large" ? "file_too_large" : "invalid_upload_request", 400); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > BOOKING_REPLY_ATTACHMENT_MAX_BYTES) return json(file instanceof File && file.size > BOOKING_REPLY_ATTACHMENT_MAX_BYTES ? "file_too_large" : "invalid_upload_request", 400);
  const source = new Uint8Array(await file.arrayBuffer());
  const env = cloudflareEnv() as CloudflareEnv & { IMAGES?: ImagesBinding };
  let bytes: Uint8Array, contentType: BookingReplyAttachment["contentType"];
  try {
    if (file.type === "application/pdf") {
      if (!isValidBookingReplyPdf(source)) return json("unsupported_file_type", 400);
      bytes = source; contentType = "application/pdf";
    } else {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || detectImageType(source) !== file.type) return json("unsupported_file_type", 400);
      if (!env.IMAGES) return json("image_processing_unavailable", 503);
      const processed = await new CloudflareProfileImageProcessor(env.IMAGES).process({ bytes: source, declaredContentType: file.type, role: "background" });
      bytes = processed.display.bytes; contentType = "image/webp";
    }
  } catch { return json("unsupported_file_type", 400); }
  if (bytes.byteLength > BOOKING_REPLY_ATTACHMENT_MAX_BYTES) return json("file_too_large", 400);
  const attachment: BookingReplyAttachment = { id: crypto.randomUUID(), filename: canonicalReplyAttachmentFilename(file.name, contentType), contentType, byteSize: bytes.byteLength, sha256: await sha256(bytes) };
  const key = bookingReplyAttachmentKey(context.creator.creator_id, attachment);
  try {
    const object = await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType, contentDisposition: "attachment", cacheControl: "private, no-store" },
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { creator_id: context.creator.creator_id, attachment_id: attachment.id, filename: attachment.filename, content_type: contentType, byte_size: String(bytes.byteLength), sha256: attachment.sha256 },
    });
    if (!object) throw new Error("r2_put_failed");
  } catch { return json("media_storage_failed", 503); }
  return Response.json({ ok: true, attachment }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
