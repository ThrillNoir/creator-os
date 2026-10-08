import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as attachmentContract from "../../shared/booking-reply-attachments.ts";
const { BOOKING_REPLY_ATTACHMENT_MAX_BYTES, bookingReplyAttachmentKey, isValidBookingReplyPdf, resolveReplyAttachments, validateReplyAttachments } = attachmentContract;

const id = "123e4567-e89b-42d3-a456-426614174000";

async function digest(bytes) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

test("reply attachment manifests enforce count, type, unique ids, and the shared byte budget", () => {
  const item = { id, filename: "details.pdf", contentType: "application/pdf", byteSize: 10, sha256: "a".repeat(64) };
  assert.deepEqual(validateReplyAttachments([item]), [item]);
  assert.throws(() => validateReplyAttachments([{ ...item, contentType: "text/html" }]), /Invalid/);
  assert.throws(() => validateReplyAttachments([item, item]), /unique/);
  assert.throws(() => validateReplyAttachments([{ ...item, byteSize: BOOKING_REPLY_ATTACHMENT_MAX_BYTES }, { ...item, id: "223e4567-e89b-42d3-a456-426614174000", byteSize: 1 }]), /total 2 MB/);
  assert.throws(() => validateReplyAttachments([{ ...item, filename: "../unsafe.pdf" }]), /Invalid/);
});

test("resolution derives a creator-scoped key and verifies metadata and content", async () => {
  const content = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
  const manifest = { id, filename: "booking details.pdf", contentType: "application/pdf", byteSize: content.byteLength, sha256: await digest(content) };
  const key = bookingReplyAttachmentKey("creator-a", manifest);
  const object = {
    size: content.byteLength,
    httpMetadata: { contentType: manifest.contentType },
    customMetadata: { creator_id: "creator-a", attachment_id: id, filename: manifest.filename, content_type: manifest.contentType, byte_size: String(manifest.byteSize), sha256: manifest.sha256 },
    arrayBuffer: async () => content.buffer,
  };
  const requested = [];
  const bucket = { async get(value) { requested.push(value); return value === key ? object : null; } };
  assert.deepEqual(await resolveReplyAttachments(bucket, "creator-a", [manifest]), [{ disposition: "attachment", filename: manifest.filename, type: manifest.contentType, content: content.buffer }]);
  assert.deepEqual(requested, [key]);
  await assert.rejects(resolveReplyAttachments(bucket, "creator-b", [manifest]), /unavailable/);
  await assert.rejects(resolveReplyAttachments({ get: async () => ({ ...object, customMetadata: { ...object.customMetadata, filename: "changed.pdf" } }) }, "creator-a", [manifest]), /unavailable/);
  await assert.rejects(resolveReplyAttachments({ get: async () => ({ ...object, arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7\nchanged\n%%EOF").buffer }) }, "creator-a", [manifest]), /unavailable/);
  assert.deepEqual(await resolveReplyAttachments(undefined, "creator-a", []), []);
  await assert.rejects(resolveReplyAttachments(undefined, "creator-a", [manifest]), /storage is unavailable/);
});

const routeSource = await readFile(new URL("../src/app/api/booking-reply-attachment/route.ts", import.meta.url), "utf8");

function loadRoute({ sameOrigin = true, authorize = async () => ({ creator: { creator_id: "creator-a" } }), env = {}, processor } = {}) {
  const exports = {};
  class ImageProcessor {
    constructor(images) { this.images = images; }
    process(input) { return processor(input, this.images); }
  }
  const compiled = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", compiled)((name) => ({
    "@/lib/audit-identity": { isSameOriginRequest: () => sameOrigin },
    "@/lib/cloudflare": { cloudflareEnv: () => env },
    "@/lib/identity": { requireCreatorContext: authorize },
    "@/lib/profile-image-processing": { CloudflareProfileImageProcessor: ImageProcessor, detectImageType: (bytes) => bytes[0] === 0xff ? "image/jpeg" : null },
    "../../../../../shared/booking-reply-attachments": attachmentContract,
  })[name] ?? (() => { throw new Error(`Unexpected dependency: ${name}`); })(), exports);
  return exports.POST;
}

function uploadRequest(file, headers = {}) {
  const form = new FormData(); form.set("file", file);
  return new Request("https://app.example.test/api/booking-reply-attachment", { method: "POST", headers: { origin: "https://app.example.test", ...headers }, body: form });
}

test("upload rejects same-origin and authorization failures before storage", async () => {
  let authorized = 0, writes = 0;
  const deniedOrigin = loadRoute({ sameOrigin: false, authorize: async () => { authorized++; }, env: { MEDIA: { put: async () => { writes++; } } } });
  assert.equal((await deniedOrigin(uploadRequest(new File(["%PDF-1.7\n%%EOF"], "ok.pdf", { type: "application/pdf" })))).status, 403);
  assert.equal(authorized, 0); assert.equal(writes, 0);
  const deniedAuth = loadRoute({ authorize: async (permission) => { assert.equal(permission, "mutate"); throw new Error("not found"); }, env: { MEDIA: { put: async () => { writes++; } } } });
  await assert.rejects(deniedAuth(uploadRequest(new File(["%PDF-1.7\n%%EOF"], "ok.pdf", { type: "application/pdf" }))), /not found/);
  assert.equal(writes, 0);
});

test("upload bounds chunked bodies and rejects spoofed PDFs without writing R2", async () => {
  let writes = 0;
  const POST = loadRoute({ env: { MEDIA: { put: async () => { writes++; } } } });
  const oversized = new Request("https://app.example.test/api/booking-reply-attachment", { method: "POST", headers: { origin: "https://app.example.test", "content-type": "multipart/form-data; boundary=x" }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(BOOKING_REPLY_ATTACHMENT_MAX_BYTES + 128 * 1024 + 1)); controller.close(); } }), duplex: "half" });
  assert.equal((await POST(oversized)).status, 400);
  const spoof = await POST(uploadRequest(new File(["<html>not pdf</html>%%EOF"], "spoof.pdf", { type: "application/pdf" })));
  assert.equal(spoof.status, 400); assert.equal(writes, 0);
});

test("PDF upload stores one immutable canonical object and returns no key", async () => {
  const writes = [];
  const POST = loadRoute({ env: { MEDIA: { put: async (...args) => { writes.push(args); return {}; } } } });
  const response = await POST(uploadRequest(new File(["%PDF-1.7\nbody\n%%EOF\n"], "../Booking\r\nDetails.pdf", { type: "application/pdf" })));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.attachment.filename, "BookingDetails.pdf"); assert.equal(result.attachment.contentType, "application/pdf"); assert.equal("key" in result.attachment, false);
  assert.equal(writes.length, 1); assert.match(writes[0][0], /^booking-reply\/creator-a\/[0-9a-f-]+\/attachment\.pdf$/);
  assert.deepEqual(writes[0][2].onlyIf, { etagDoesNotMatch: "*" });
  assert.equal(writes[0][2].customMetadata.filename, "BookingDetails.pdf"); assert.equal(writes[0][2].customMetadata.sha256, result.attachment.sha256);
});

test("image upload requires processing and stores only the re-encoded display bytes", async () => {
  const display = new Uint8Array([82, 73, 70, 70, 1, 2, 3]); let processed = 0, stored;
  const POST = loadRoute({ env: { IMAGES: {}, MEDIA: { put: async (_key, bytes, options) => { stored = { bytes, options }; return {}; } } }, processor: async (input) => { processed++; assert.equal(input.declaredContentType, "image/jpeg"); assert.equal(input.role, "background"); return { display: { bytes: display } }; } });
  const response = await POST(uploadRequest(new File([new Uint8Array([0xff, 0xd8, 0xff, 4])], "photo.jpg", { type: "image/jpeg" })));
  assert.equal(response.status, 200); assert.equal(processed, 1); assert.deepEqual(stored.bytes, display);
  assert.equal(stored.options.httpMetadata.contentType, "image/webp"); assert.equal(stored.options.customMetadata.filename, "photo.webp");
});

test("PDF signature and EOF checks reject file spoofing", () => {
  assert.equal(isValidBookingReplyPdf(new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF\n")), true);
  assert.equal(isValidBookingReplyPdf(new TextEncoder().encode("<html>spoofed</html>\n%%EOF")), false);
  assert.equal(isValidBookingReplyPdf(new TextEncoder().encode("%PDF-1.7\nmissing eof")), false);
});
