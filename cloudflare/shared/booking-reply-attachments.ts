export const BOOKING_REPLY_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const BOOKING_REPLY_ATTACHMENT_MAX_COUNT = 3;

export type BookingReplyAttachment = {
  id: string;
  filename: string;
  contentType: "application/pdf" | "image/webp";
  byteSize: number;
  sha256: string;
};

type AttachmentBucket = Pick<R2Bucket, "get">;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const SAFE_FILENAME = /^(?![. ])[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,179}$/u;

function attachment(value: unknown): BookingReplyAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid booking reply attachment.");
  const item = value as Record<string, unknown>;
  if (!ID.test(String(item.id ?? ""))
    || typeof item.filename !== "string" || !SAFE_FILENAME.test(item.filename) || /[. ]$/.test(item.filename)
    || (item.contentType !== "application/pdf" && item.contentType !== "image/webp")
    || !Number.isSafeInteger(item.byteSize) || (item.byteSize as number) < 1 || (item.byteSize as number) > BOOKING_REPLY_ATTACHMENT_MAX_BYTES
    || typeof item.sha256 !== "string" || !HASH.test(item.sha256)) throw new Error("Invalid booking reply attachment.");
  return { id: item.id as string, filename: item.filename, contentType: item.contentType, byteSize: item.byteSize as number, sha256: item.sha256 };
}

export function validateReplyAttachments(value: unknown): BookingReplyAttachment[] {
  if (!Array.isArray(value) || value.length > BOOKING_REPLY_ATTACHMENT_MAX_COUNT) throw new Error("Use at most three booking reply attachments.");
  const result = value.map(attachment);
  if (new Set(result.map(({ id }) => id)).size !== result.length) throw new Error("Booking reply attachments must be unique.");
  if (result.reduce((total, item) => total + item.byteSize, 0) > BOOKING_REPLY_ATTACHMENT_MAX_BYTES) throw new Error("Booking reply attachments must total 2 MB or less.");
  return result;
}

export function bookingReplyAttachmentKey(creatorId: string, item: Pick<BookingReplyAttachment, "id" | "contentType">) {
  if (!creatorId || !ID.test(item.id)) throw new Error("Invalid booking reply attachment key.");
  return `booking-reply/${creatorId}/${item.id}/${item.contentType === "image/webp" ? "display.webp" : "attachment.pdf"}`;
}

export function isValidBookingReplyPdf(bytes: Uint8Array) {
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return false;
  return /%%EOF\s*$/.test(new TextDecoder().decode(bytes.slice(Math.max(0, bytes.byteLength - 1024))));
}

async function digest(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveReplyAttachments(bucket: AttachmentBucket | undefined, creatorId: string, attachments: unknown): Promise<Array<{ disposition: "attachment"; filename: string; type: string; content: ArrayBuffer }>> {
  const manifests = validateReplyAttachments(attachments);
  if (!manifests.length) return [];
  if (!bucket) throw new Error("Booking reply attachment storage is unavailable.");
  return Promise.all(manifests.map(async (item) => {
    const object = await bucket.get(bookingReplyAttachmentKey(creatorId, item));
    if (!object || object.size !== item.byteSize
      || object.httpMetadata?.contentType !== item.contentType
      || object.customMetadata?.creator_id !== creatorId
      || object.customMetadata?.attachment_id !== item.id
      || object.customMetadata?.filename !== item.filename
      || object.customMetadata?.content_type !== item.contentType
      || object.customMetadata?.byte_size !== String(item.byteSize)
      || object.customMetadata?.sha256 !== item.sha256) throw new Error("Booking reply attachment is unavailable.");
    const content = await object.arrayBuffer();
    if (content.byteLength !== item.byteSize || await digest(content) !== item.sha256) throw new Error("Booking reply attachment is unavailable.");
    return { disposition: "attachment" as const, filename: item.filename, type: item.contentType, content };
  }));
}
