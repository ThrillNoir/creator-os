import { resolveReplyAttachments } from "../../shared/booking-reply-attachments.ts";
import { bookingEmail, bookingLinks, validateBookingConfig, validateBookingEnquiry } from "../../shared/booking-contract.ts";
import { requireInternalServiceForCreator } from "../../shared/service-auth.ts";
import { parseProfileAppearance } from "../../thot-os-next/src/lib/profile-appearance-contract.ts";

type BookingEnv = { DB: D1Database; MEDIA?: R2Bucket; BOOKING_ENQUIRIES_ENABLED?: string; EMAIL?: { send(message: EmailMessageBuilder): Promise<unknown> } };
type PublishedBooking = { config_json: string; display_name: string; email: string; sms: string; theme_key: unknown; button_style: unknown; background_mode: unknown; background_color: unknown; primary_color: unknown; text_color: unknown; card_color: unknown; radius_scale: unknown };
const MAX_BODY = 32768;
const WINDOW = 30 * 60 * 1000;

function reply(status: number, value: Record<string, unknown> = {}) {
  return Response.json({ ok: status === 200, ...value }, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

async function readBody(request: Request) {
  if (!request.body || !request.headers.get("content-type")?.includes("application/json")) throw new Error("Invalid body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY) { await reader.cancel(); throw new Error("Body too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body.");
  return value as Record<string, unknown>;
}

/** Primary D1 state is authoritative even when a stale contact KV entry survives. */
const LIVE_BOOKING = `SELECT b.config_json,v.display_name,d.theme_key,d.button_style,d.background_mode,d.background_color,d.primary_color,d.text_color,d.card_color,d.radius_scale,
  (SELECT contact_value FROM creator_public_contact_methods WHERE creator_id=p.creator_id AND profile_version_id=v.id AND channel='email' AND enabled=1) AS email,
  (SELECT contact_value FROM creator_public_contact_methods WHERE creator_id=p.creator_id AND profile_version_id=v.id AND channel='sms' AND enabled=1) AS sms
  FROM creator_public_profiles p
  JOIN creators c ON c.id=p.creator_id AND c.status='active'
  JOIN creator_public_profile_versions v ON v.id=p.published_version_id AND v.creator_id=p.creator_id
  LEFT JOIN creator_public_profile_details d ON d.profile_version_id=v.id AND d.creator_id=p.creator_id
  JOIN creator_booking_configs b ON b.profile_version_id=v.id AND b.creator_id=p.creator_id
  WHERE p.creator_id=? AND p.slug=? AND v.id=? AND p.status='active' AND v.status='published'
    AND v.approved_by IS NOT NULL AND v.approved_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM creator_profile_projection_deliveries d
      WHERE d.creator_id=p.creator_id AND d.profile_id=p.id AND d.version_id=v.id AND d.surface='public_sfw' AND d.action='withdraw')`;

export async function purgeBookingReceipts(env: BookingEnv, now = Date.now()) {
  await env.DB.prepare("DELETE FROM creator_booking_receipts WHERE expires_at<=?").bind(now).run();
}

export async function handleBooking(request: Request, env: BookingEnv, now = Date.now()): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST" || (path !== "/booking/check" && path !== "/booking/submit")) return reply(404);
  if (env.BOOKING_ENQUIRIES_ENABLED !== "true" || !env.EMAIL) return reply(503);
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch { return reply(400); }
  const { creatorId, slug, versionId } = body;
  if (typeof creatorId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(creatorId) || typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || typeof versionId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(versionId)) return reply(400);
  try { await requireInternalServiceForCreator(request, env.DB, creatorId, "thot-os-public-contact", "booking.enquiry.submit"); } catch { return reply(401); }
  try {
    const current = await env.DB.prepare(LIVE_BOOKING).bind(creatorId, slug, versionId).first<PublishedBooking>();
    if (!current) return reply(404);
    const config = validateBookingConfig(JSON.parse(current.config_json));
    if (!config.enabled || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current.email ?? "") || !/^\+[1-9]\d{5,14}$/.test(current.sms ?? "")) return reply(404);
    if (path === "/booking/check") return reply(200, { appearance: parseProfileAppearance({ themeKey: current.theme_key, buttonStyle: current.button_style, backgroundMode: current.background_mode, backgroundColor: current.background_color, primaryColor: current.primary_color, textColor: current.text_color, cardColor: current.card_color, radiusScale: current.radius_scale }) });
    const { submissionId, issuedAt } = body;
    if (typeof submissionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId) || typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > WINDOW) return reply(400);
    let enquiry;
    try { enquiry = validateBookingEnquiry(body.enquiry, config, new Date(now)); } catch { return reply(400); }
    await purgeBookingReceipts(env, now);
    // Single SQL statement claims a nonce and enforces the creator-wide hourly cap.
    // Recheck live state in the claim so a queued withdrawal wins before a send begins.
    const claimed = await env.DB.prepare(`INSERT OR IGNORE INTO creator_booking_receipts
      (id,creator_id,profile_version_id,issued_at,acknowledged_at,expires_at,state)
      SELECT ?,?,?,?,?,?,'sending'
      WHERE (SELECT COUNT(*) FROM creator_booking_receipts WHERE creator_id=? AND acknowledged_at>?)<20
        AND EXISTS (${LIVE_BOOKING})`)
      .bind(submissionId, creatorId, versionId, issuedAt, now, now + 604800000, creatorId, now - 3600000, creatorId, slug, versionId).run();
    if (!claimed.meta.changes) {
      const duplicate = await env.DB.prepare("SELECT id FROM creator_booking_receipts WHERE id=? AND creator_id=?").bind(submissionId, creatorId).first();
      return reply(duplicate ? 409 : 429);
    }
    try {
      await env.EMAIL.send({
        from: "THOT OS <welcome@thathuboverthere.com>", to: current.email,
        subject: "New THOT OS booking enquiry",
        text: bookingEmail(current.display_name, config, enquiry, versionId, new Date(now).toISOString()),
      });
    } catch {
      await env.DB.prepare("UPDATE creator_booking_receipts SET state='uncertain' WHERE id=? AND creator_id=? AND state='sending'").bind(submissionId, creatorId).run();
      return reply(502);
    }
    if (config.reply?.enabled) {
      try {
        const attachments = await resolveReplyAttachments(env.MEDIA, creatorId, config.reply.attachments ?? []);
        const from = { email: "welcome@thathuboverthere.com", name: `${current.display_name} via THOT OS` };
        await env.EMAIL.send({ ...(attachments.length ? { attachments } : {}), from, to: enquiry.email, replyTo: current.email, subject: config.reply.subject.replaceAll("{first name}", () => enquiry.firstName), text: config.reply.body.replaceAll("{first name}", () => enquiry.firstName) });
      } catch {
        await env.DB.prepare("UPDATE creator_booking_receipts SET state='uncertain' WHERE id=? AND creator_id=? AND state='sending'").bind(submissionId, creatorId).run();
        return reply(200, { ...bookingLinks(current.sms, current.display_name, enquiry), replyStatus: "uncertain" });
      }
    }
    await env.DB.prepare("UPDATE creator_booking_receipts SET state='accepted' WHERE id=? AND creator_id=? AND state='sending'").bind(submissionId, creatorId).run();
    return reply(200, { ...bookingLinks(current.sms, current.display_name, enquiry), replyStatus: config.reply?.enabled ? "accepted" : "not_requested" });
  } catch {
    // Provider, D1 and parsing diagnostics can contain private request data.
    return reply(503);
  }
}
