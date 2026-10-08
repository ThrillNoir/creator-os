import { validateReplyAttachments, type BookingReplyAttachment } from "./booking-reply-attachments.ts";
/** Shared bounds for the non-sexual event enquiry editor and delivery boundary. */
export type BookingOption = { id: string; label: string; description: string };
export const bookingFieldNames = ["phone", "date", "time", "endTime", "timezone", "address", "suburb", "guests", "occasion", "wear", "extras", "specialRequests"] as const;
export type BookingField = typeof bookingFieldNames[number];
export type BookingFieldSettings = { visible: boolean; required: boolean };
export type BookingConfig = { enabled: boolean; label: string; rules: string; wear: BookingOption[]; extras: BookingOption[]; fields?: Record<BookingField, BookingFieldSettings>; reply?: { enabled: boolean; subject: string; body: string; attachments?: BookingReplyAttachment[] } };
export type BookingEnquiry = {
  firstName: string; lastName: string; email: string; phone?: string;
  date?: string; time?: string; endTime?: string; timezone?: string; address?: string; suburb?: string;
  guests?: number; occasion?: string; wear?: string[]; extras?: string[]; specialRequests?: string; instagram?: string;
  consent: boolean; acknowledged: boolean;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid booking details.");
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, required = true, multiline = false) {
  if (typeof value !== "string") throw new Error("Invalid booking text.");
  const result = value.trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result) || (!multiline && /[\r\n]/.test(result))) throw new Error("Invalid booking text.");
  return result;
}

function options(value: unknown): BookingOption[] {
  if (!Array.isArray(value) || value.length > 12) throw new Error("Use at most twelve options per section.");
  const result = value.map((item) => {
    const option = object(item);
    const id = text(option.id, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid option identifier.");
    return { id, label: text(option.label, 80), description: text(option.description, 1000, false, true) };
  });
  if (new Set(result.map((item) => item.id)).size !== result.length) throw new Error("Option identifiers must be unique.");
  return result;
}

export function disabledBookingConfig(): BookingConfig {
  return { enabled: false, label: "Booking enquiry", rules: "", wear: [], extras: [], fields: Object.fromEntries(bookingFieldNames.map((name) => [name, { visible: true, required: name !== "wear" && name !== "extras" && name !== "endTime" }])) as Record<BookingField, BookingFieldSettings> };
}

export function effectiveBookingFields(config: BookingConfig): Record<BookingField, BookingFieldSettings> {
  if (config.fields) return config.fields;
  return Object.fromEntries(bookingFieldNames.map((name) => [name, { visible: true, required: name === "extras" || name === "specialRequests" || name === "endTime" ? false : name !== "wear" || config.wear.length > 0 }])) as Record<BookingField, BookingFieldSettings>;
}

function fields(value: unknown): Record<BookingField, BookingFieldSettings> {
  const input = object(value), result = {} as Record<BookingField, BookingFieldSettings>;
  for (const name of bookingFieldNames) {
    if (name === "endTime" && input[name] === undefined) {
      result[name] = { visible: true, required: false };
      continue;
    }
    const setting = object(input[name]);
    if (typeof setting.visible !== "boolean" || typeof setting.required !== "boolean") throw new Error("Invalid booking field setting.");
    result[name] = { visible: name === "specialRequests" ? true : setting.visible, required: name === "specialRequests" ? true : setting.required };
  }
  return result;
}

export function validateBookingConfig(value: unknown): BookingConfig {
  const input = object(value);
  if (typeof input.enabled !== "boolean") throw new Error("Invalid booking setting.");
  const result: BookingConfig = {
    enabled: input.enabled, label: text(input.label, 80), rules: text(input.rules, 6000, input.enabled, true),
    wear: options(input.wear), extras: options(input.extras),
  };
  if (input.fields !== undefined) result.fields = fields(input.fields);
  if (input.reply !== undefined) {
    const reply = object(input.reply);
    if (typeof reply.enabled !== "boolean") throw new Error("Invalid booking reply setting.");
    const subject = text(reply.subject, 200, reply.enabled), body = text(reply.body, 12000, reply.enabled, true);
    if ([subject, body].some((value) => /[{}]/.test(value.replaceAll("{first name}", "")))) throw new Error("Invalid booking reply placeholder.");
    result.reply = { enabled: reply.enabled, subject, body };
    if (reply.attachments !== undefined) result.reply.attachments = validateReplyAttachments(reply.attachments);
  }
  if (result.enabled && result.fields && ((result.fields.wear.visible && result.fields.wear.required && !result.wear.length) || (result.fields.extras.visible && result.fields.extras.required && !result.extras.length))) throw new Error("Required booking choices need at least one option.");
  return result;
}

export function validateBookingEnquiry(value: unknown, config: BookingConfig, now = new Date()): BookingEnquiry {
  if (!config.enabled) throw new Error("Booking enquiries are unavailable.");
  const input = object(value);
  if (input.consent !== true || input.acknowledged !== true) throw new Error("Consent and rules acknowledgement are required.");
  const enabled = effectiveBookingFields(config), present = (name: BookingField, maximum: number, multiline = false) => {
    if (!enabled[name].visible) return undefined;
    const result = input[name] === undefined && !enabled[name].required ? "" : text(input[name], maximum, enabled[name].required, multiline);
    return result || undefined;
  };
  const date = present("date", 10), time = present("time", 5), endTime = present("endTime", 5), timezone = present("timezone", 80);
  let parsedDate: Date | undefined;
  if (date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date."); parsedDate = new Date(`${date}T00:00:00Z`); if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error("Invalid date."); }
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid time.");
  if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error("Invalid end time.");
  if (timezone) { try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); } catch { throw new Error("Invalid timezone."); } }
  if (date && parsedDate) {
    const dateParts = timezone ? Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value])) : { year: String(now.getUTCFullYear()), month: String(now.getUTCMonth() + 1).padStart(2, "0"), day: String(now.getUTCDate()).padStart(2, "0") };
    const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    if (date < today || parsedDate.getTime() > now.getTime() + 366 * 86400000 || (time && timezone && `${date}T${time}` < `${today}T${dateParts.hour}:${dateParts.minute}`)) throw new Error("Choose a future date within one year.");
  }
  const phone = present("phone", 32);
  const email = text(input.email, 254);
  if ((phone && !/^\+?[0-9 ()-]{6,32}$/.test(phone)) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid contact details.");
  let guests: number | undefined;
  if (enabled.guests.visible) { const raw = input.guests; if (raw !== undefined && raw !== "") { if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 1000) throw new Error("Enter a guest count from 1 to 1000."); guests = raw; } else if (enabled.guests.required) throw new Error("Enter a guest count from 1 to 1000."); }
  let wear: string[] | undefined;
  if (enabled.wear.visible) {
    const raw = input.wear;
    const selected = raw === undefined || raw === "" ? [] : typeof raw === "string" ? [raw] : raw;
    if (!Array.isArray(selected) || selected.length > config.wear.length || new Set(selected).size !== selected.length || selected.some((id) => typeof id !== "string" || !config.wear.some((option) => option.id === id)) || (enabled.wear.required && !selected.length)) throw new Error("Choose offered Uniform options only.");
    wear = selected as string[];
  }
  let extras: string[] | undefined;
  if (enabled.extras.visible) { if (!Array.isArray(input.extras) || input.extras.length > config.extras.length || new Set(input.extras).size !== input.extras.length || input.extras.some((id) => typeof id !== "string" || !config.extras.some((option) => option.id === id)) || (enabled.extras.required && !input.extras.length)) throw new Error("Choose offered extras only."); extras = input.extras as string[]; }
  return {
    firstName: text(input.firstName, 80), lastName: text(input.lastName, 80), email, phone, date, time, endTime, timezone,
    address: present("address", 300), suburb: present("suburb", 100), guests, occasion: present("occasion", 160), wear, extras,
    specialRequests: present("specialRequests", 2000, true), instagram: (() => { const handle = input.instagram === undefined || input.instagram === "" ? undefined : text(input.instagram, 31); if (handle && !/^@?[A-Za-z0-9._]{1,30}$/.test(handle)) throw new Error("Invalid Instagram handle."); return handle; })(), consent: true, acknowledged: true,
  };
}

export function bookingDraft(displayName: string, enquiry: BookingEnquiry) {
  const event = enquiry.date && enquiry.time && enquiry.timezone ? `\n\nBooking enquiry: ${enquiry.date} at ${enquiry.time} (${enquiry.timezone})` : "";
  const location = enquiry.address && enquiry.suburb ? `\nSuburb: ${enquiry.suburb}\nOpen address in Maps: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${enquiry.address}, ${enquiry.suburb}`)}` : "";
  return `Hi ${displayName}, this is ${enquiry.firstName} ${enquiry.lastName}.${event}${location}\n\nPlease check your email for the full booking details.`;
}

export function bookingLinks(phone: string, displayName: string, enquiry: BookingEnquiry) {
  if (!/^\+[1-9]\d{5,14}$/.test(phone)) throw new Error("Invalid booking destination.");
  const body = encodeURIComponent(bookingDraft(displayName, enquiry));
  return { sms: `sms:${phone}?body=${body}`, whatsapp: `https://wa.me/${phone.slice(1)}?text=${body}` };
}

export function bookingEmail(displayName: string, config: BookingConfig, enquiry: BookingEnquiry, versionId: string, acknowledgedAt: string) {
  return [
    `Booking enquiry for ${displayName} — not a confirmed booking.`,
    `Name: ${enquiry.firstName} ${enquiry.lastName}`, ...(enquiry.phone ? [`Phone: ${enquiry.phone}`] : []), `Email: ${enquiry.email}`,
    ...(enquiry.date ? [`Date: ${enquiry.date}`] : []), ...(enquiry.time ? [`Start time: ${enquiry.time}`] : []), ...(enquiry.endTime ? [`End time: ${enquiry.endTime}`] : []), ...(enquiry.timezone ? [`Timezone: ${enquiry.timezone}`] : []), ...(enquiry.address ? [`Address: ${enquiry.address}`] : []), ...(enquiry.suburb ? [`Suburb: ${enquiry.suburb}`] : []),
    ...(enquiry.guests ? [`Guests: ${enquiry.guests}`] : []), ...(enquiry.occasion ? [`Occasion: ${enquiry.occasion}`] : []),
    ...(enquiry.wear ? [`Uniform: ${config.wear.filter((option) => enquiry.wear!.includes(option.id)).map((option) => option.label).join(", ") || "None"}`] : []),
    ...(enquiry.extras ? [`Extra spice: ${config.extras.filter((option) => enquiry.extras!.includes(option.id)).map((option) => option.label).join(", ") || "None"}`] : []),
    ...(enquiry.specialRequests ? [`Special requests: ${enquiry.specialRequests}`] : []), ...(enquiry.instagram ? [`Instagram: ${enquiry.instagram}`] : []),
    `Rules version: ${versionId}`, `Rules and sharing acknowledged at: ${acknowledgedAt}`,
    "Rules acknowledged:", config.rules,
  ].join("\n\n");
}
