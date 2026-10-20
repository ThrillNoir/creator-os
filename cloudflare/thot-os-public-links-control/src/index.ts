import { WorkflowEntrypoint, type WorkflowStep } from "cloudflare:workers";
import { validateBookingConfig, type BookingConfig } from "../../shared/booking-contract.ts";
import { handleBooking, purgeBookingReceipts } from "./booking.ts";
import { isPublicCreatorSlug } from "../../shared/public-profile-slug.ts";
import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";
import { publicationIsAllowed, publicationPolicy } from "./publication-policy.ts";
import { markProjectionDeliveredFailClosed, writeProjectionFailClosed } from "./projection-delivery.ts";
import { PortfolioPublishWorkflow, PortfolioWithdrawWorkflow, beginPortfolioWithdrawal, reconcilePublishedPortfolios, type PortfolioParams } from "./portfolio-release.ts";
export { PortfolioPublishWorkflow, PortfolioWithdrawWorkflow };

type PublishParams = { creatorId: string; profileId: string; versionId: string };
type WithdrawParams = PublishParams;
type AdultPublishParams = PublishParams;
type AdultWithdrawParams = AdultPublishParams;

type ProfileRow = {
  booking?: BookingConfig;
  profile_id: string;
  creator_id: string;
  slug: string;
  profile_status: string;
  version_id: string;
  version_status: string;
  display_name: string;
  headline: string;
  bio: string;
  approved_by: string | null;
  approved_at: string | null;
  content_checksum: string;
  theme_key: string;
  button_style: string;
  background_mode: string;
  background_color: string;
  primary_color: string;
  text_color: string;
  card_color: string;
  radius_scale: string;
};
type LinkRow = { id: string; label: string; destination_url: string; destination_host: string };
type ContactRow = { channel: "sms" | "email"; contact_value: string };
type SfwMediaRow = { id: string; object_key: string; sha256: string; content_type: "image/webp"; image_role: "avatar" | "background" };
type ActiveProfileRow = { profile_id: string; creator_id: string; slug: string; version_id: string; approved_by: string };

type AdultProfileRow = {
  profile_id: string;
  creator_id: string;
  slug: string;
  profile_status: string;
  version_id: string;
  version_status: string;
  display_name: string;
  adult_bio: string;
  approved_by: string | null;
  approved_at: string | null;
  content_checksum: string;
  theme_key: string;
  button_style: string;
  background_mode: string;
  background_color: string;
  primary_color: string;
  text_color: string;
  card_color: string;
  radius_scale: string;
  inherit_sfw_theme: number;
  sfw_theme_key: string | null;
  sfw_button_style: string | null;
  sfw_background_mode: string | null;
  sfw_background_color: string | null;
  sfw_primary_color: string | null;
  sfw_text_color: string | null;
  sfw_card_color: string | null;
  sfw_radius_scale: string | null;
  safe_profile_slug: string | null;
};
type AdultMediaRow = { id: string; object_key: string; sha256: string; alt_text: string; content_type: "image/webp"; image_role: "avatar" | "background" };
type ActiveAdultProfileRow = { profile_id: string; creator_id: string; slug: string; version_id: string; approved_by: string };

type PublicProfileSnapshot = {
  schemaVersion: 3 | 4;
  publishedVersionId: string;
  creator: { slug: string; displayName: string; headline: string; bio: string };
  links: Array<{ id: string; label: string; destinationUrl: string; destinationHost: string }>;
  // The only public interaction values are configured protected-service URLs.
  // Contact values and adult destinations never enter this snapshot.
  actions: Array<{ id: "book" | "more"; label: string; href: string }>;
  appearance: { themeKey: string; buttonStyle: string; backgroundMode: string; backgroundColor: string; primaryColor: string; textColor: string; cardColor: string; radiusScale: string };
  media?: Array<{ id: string; href: string; altText: string; contentType: "image/webp"; imageRole: "avatar" | "background"; checksum: string }>;
};

type ContactProfileSnapshot = {
  schemaVersion: 2;
  versionId: string;
  config: BookingConfig;
  creator: { id: string; slug: string; displayName: string };
  channels: Partial<Record<"sms" | "email", string>>;
};

type AdultProfileSnapshot = {
  schemaVersion: 4;
  publishedVersionId: string;
  creator: { slug: string; displayName: string; bio: string; safeProfileUrl: string };
  links: Array<{ id: string; label: string; destinationUrl: string; destinationHost: string }>;
  // This projection contains only a key from the isolated ADULT_MEDIA bucket,
  // never an authoring-bucket key. The age gateway reads it only after a
  // creator/version-bound HttpOnly session has been verified.
  media: Array<{ id: string; mediaKey: string; checksum: string; altText: string; contentType: "image/webp"; imageRole: "avatar" | "background" }>;
  appearance: { themeKey: string; buttonStyle: string; backgroundMode: string; backgroundColor: string; primaryColor: string; textColor: string; cardColor: string; radiusScale: string };
};

const CREATOR_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const RECORD_ID = /^[a-zA-Z0-9_-]{1,160}$/;

function publicSnapshotKey(slug: string) { return `public-profile:${slug}`; }
function contactSnapshotKey(slug: string) { return `public-contact:${slug}`; }
function adultSnapshotKey(slug: string) { return `adult-profile:${slug}`; }

type ProjectionSurface = "public_sfw" | "adult_profile";

function publicationOperation(surface: ProjectionSurface, action: "publish" | "withdraw", versionId: string) {
  return `${surface}:${action}:${versionId}`;
}

function publicationDelivery(surface: ProjectionSurface, action: "publish" | "withdraw", profileId: string, versionId: string) {
  return `${surface}:${action}:${profileId}:${versionId}`;
}

async function recordProjectionFailure(env: Env, operationId: string, deliveryId: string, reason: "projection_write_failed" | "projection_receipt_failed") {
  await env.DB.batch([
    env.DB.prepare(`UPDATE operation_outbox
      SET status='pending',attempts=attempts+1,next_attempt_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(reason, operationId),
    env.DB.prepare(`UPDATE creator_profile_projection_deliveries
      SET status='failed',attempts=attempts+1,last_error_code=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(reason, deliveryId),
  ]);
}

function validHttpsDestination(value: string, expectedHost: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname) && url.hostname.toLowerCase() === expectedHost.toLowerCase();
  } catch {
    return false;
  }
}

/** A release URL is deliberately an HTTPS origin, not a creator-configurable path. */
function configuredOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredActionHref(baseUrl: string | undefined, route: "book" | "age", slug: string) {
  const origin = configuredOrigin(baseUrl);
  return origin ? `${origin}/${route}/${encodeURIComponent(slug)}` : null;
}

/** The safe Worker owns the friendly adult entrance and only redirects from it. */
function configuredFriendlyMoreHref(baseUrl: string | undefined, slug: string) {
  const origin = configuredOrigin(baseUrl);
  return origin ? `${origin}/${encodeURIComponent(slug)}/more` : null;
}

function publicMediaDeliveryConfigured(env: Env) {
  return env.PUBLIC_MEDIA_DELIVERY_ENABLED === "1" && Boolean(env.MEDIA && env.PUBLIC_MEDIA && configuredOrigin(env.PUBLIC_MEDIA_BASE_URL));
}

function adultMediaDeliveryConfigured(env: Env) {
  return env.ADULT_MEDIA_DELIVERY_ENABLED === "1" && Boolean(env.MEDIA && env.ADULT_MEDIA);
}

function publicMediaKey(profile: ProfileRow, media: SfwMediaRow) {
  return `public-media/${profile.slug}/${profile.version_id}/${media.id}.webp`;
}

function adultMediaKey(profile: Pick<AdultProfileRow, "slug" | "version_id">, media: Pick<AdultMediaRow, "id">) {
  return `adult-media/${profile.slug}/${profile.version_id}/${media.id}.webp`;
}

function publicMediaHref(env: Env, profile: ProfileRow, media: SfwMediaRow) {
  const origin = configuredOrigin(env.PUBLIC_MEDIA_BASE_URL);
  return origin ? `${origin}/media/${encodeURIComponent(profile.slug)}/${encodeURIComponent(profile.version_id)}/${encodeURIComponent(media.id)}` : null;
}

async function sha256Hex(bytes: Uint8Array) {
  // A copied view avoids the SharedArrayBuffer-compatible typed-array
  // widening in recent Workers types while hashing the exact object bytes.
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function copyDisplayDerivative(source: R2Bucket, destination: R2Bucket, sourceKey: string, destinationKey: string, expected: { creatorId: string; creatorSlug: string; versionId: string; attachmentId: string; checksum: string; imageRole: "avatar" | "background"; surface: "public_sfw" | "adult_profile" }) {
  const object = await source.get(sourceKey);
  if (!object || object.httpMetadata?.contentType !== "image/webp") throw new Error("The approved image display derivative is unavailable.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const checksum = await sha256Hex(bytes);
  if (checksum !== expected.checksum.toLowerCase()) throw new Error("The approved image display derivative checksum does not match.");
  const customMetadata = {
    creatorId: expected.creatorId,
    creatorSlug: expected.creatorSlug,
    versionId: expected.versionId,
    attachmentId: expected.attachmentId,
    checksum,
    surface: expected.surface,
    imageRole: expected.imageRole,
  };
  const stored = await destination.put(destinationKey, bytes, {
    httpMetadata: { contentType: "image/webp" },
    customMetadata,
    sha256: checksum,
  });
  if (!stored) throw new Error("The approved image display derivative could not be copied.");
  return { checksum, destinationKey };
}

async function attachedMediaIds(env: Env, surface: "public_sfw" | "adult_profile", creatorId: string, versionId: string) {
  const column = surface === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id";
  const rows = await env.DB.prepare(`SELECT a.id FROM creator_profile_image_attachments a
    JOIN creator_profile_image_derivatives d ON d.id=a.derivative_id AND d.creator_id=a.creator_id
    JOIN creator_profile_image_uploads u ON u.id=d.upload_id AND u.creator_id=d.creator_id
    WHERE a.creator_id=? AND a.${column}=? AND a.surface=? AND a.status='attached'
      AND d.derivative_kind='display' AND d.content_type='image/webp'
      AND u.surface=? AND u.status='processed'`).bind(creatorId, versionId, surface, surface).all<{ id: string }>();
  return rows.results;
}

/** Revocation is driven only by deterministic published keys, never source keys. */
async function deleteProjectedMedia(env: Env, surface: "public_sfw" | "adult_profile", profile: { creator_id: string; slug: string; version_id: string }) {
  const attachmentIds = await attachedMediaIds(env, surface, profile.creator_id, profile.version_id);
  if (!attachmentIds.length) return;
  const destination = surface === "public_sfw" ? env.PUBLIC_MEDIA : env.ADULT_MEDIA;
  if (!destination) throw new Error("projected_media_storage_not_configured");
  const keys = attachmentIds.map(({ id }) => surface === "public_sfw"
    ? `public-media/${profile.slug}/${profile.version_id}/${id}.webp`
    : `adult-media/${profile.slug}/${profile.version_id}/${id}.webp`);
  await destination.delete(keys);
}

async function loadApprovedProfile(env: Env, params: PublishParams) {
  const profile = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,p.slug,p.status AS profile_status,
      v.id AS version_id,v.status AS version_status,v.display_name,v.headline,v.bio,v.approved_by,v.approved_at,v.content_checksum,
      d.theme_key,d.button_style,d.background_mode,d.background_color,d.primary_color,d.text_color,d.card_color,d.radius_scale
    FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=? AND v.profile_id=p.id AND v.creator_id=p.creator_id
    JOIN creator_public_profile_details d ON d.profile_version_id=v.id AND d.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=?`).bind(params.versionId, params.profileId, params.creatorId).first<ProfileRow>();
  if (!profile || !["draft", "active", "paused"].includes(profile.profile_status) || !["approved", "published", "superseded"].includes(profile.version_status) || !profile.approved_by || !profile.approved_at) {
    throw new Error("The requested public profile version is not explicitly approved for publication.");
  }
  if (!isPublicCreatorSlug(profile.slug)) throw new Error("Choose a non-reserved public URL before publishing this profile.");
  const revisedLinks = await env.DB.prepare(`SELECT link_id AS id,label,destination_url,destination_host
    FROM creator_public_link_revisions
    WHERE profile_version_id=? AND creator_id=? AND enabled=1
    ORDER BY sort_order ASC`).bind(profile.version_id, profile.creator_id).all<LinkRow>();
  const links = revisedLinks.results.length ? revisedLinks : await env.DB.prepare(`SELECT id,label,destination_url,destination_host
    FROM creator_public_links
    WHERE profile_version_id=? AND creator_id=?
    ORDER BY sort_order ASC`).bind(profile.version_id, profile.creator_id).all<LinkRow>();
  if (links.results.some((link) => !validHttpsDestination(link.destination_url, link.destination_host))) {
    throw new Error("The approved profile contains an invalid credential-free HTTPS destination link.");
  }
  const contacts = await env.DB.prepare(`SELECT channel,contact_value FROM creator_public_contact_methods
    WHERE creator_id=? AND profile_version_id=? AND enabled=1 AND channel IN ('sms','email')`).bind(profile.creator_id, profile.version_id).all<ContactRow>();
  const media = await env.DB.prepare(`SELECT a.id,d.object_key,d.sha256,d.content_type,a.image_role
    FROM creator_profile_image_attachments a
    JOIN creator_profile_image_derivatives d ON d.id=a.derivative_id AND d.creator_id=a.creator_id
    JOIN creator_profile_image_uploads u ON u.id=d.upload_id AND u.creator_id=d.creator_id
    WHERE a.creator_id=? AND a.public_profile_version_id=? AND a.surface='public_sfw' AND a.status='attached'
      AND a.image_role IN ('avatar','background')
      AND d.derivative_kind='display' AND d.content_type='image/webp'
      AND u.surface='public_sfw' AND u.image_role=a.image_role AND u.status='processed'
    ORDER BY CASE a.image_role WHEN 'background' THEN 0 ELSE 1 END`).bind(profile.creator_id, profile.version_id).all<SfwMediaRow>();
  const booking = await env.DB.prepare("SELECT config_json FROM creator_booking_configs WHERE creator_id=? AND profile_version_id=?").bind(profile.creator_id, profile.version_id).first<{ config_json: string }>();
  if (booking) profile.booking = validateBookingConfig(JSON.parse(booking.config_json));
  return { profile, links: links.results, contacts: contacts.results, media: media.results };
}

async function loadCurrentPublicProfile(env: Env, creatorId: string) {
  const current = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,p.slug,p.status AS profile_status,
      v.id AS version_id,v.status AS version_status,v.display_name,v.headline,v.bio,v.approved_by,v.approved_at,v.content_checksum,
      d.theme_key,d.button_style,d.background_mode,d.background_color,d.primary_color,d.text_color,d.card_color,d.radius_scale
    FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    JOIN creator_public_profile_details d ON d.profile_version_id=v.id AND d.creator_id=p.creator_id
    WHERE p.creator_id=? AND p.status='active' AND v.status='published'`).bind(creatorId).first<ProfileRow>();
  if (!current) return null;
  return loadApprovedProfile(env, { creatorId, profileId: current.profile_id, versionId: current.version_id });
}

async function adultProjectionIsEligible(env: Env, creatorId: string) {
  if (!env.ADULT_PROFILES || !configuredOrigin(env.ADULT_GATEWAY_BASE_URL)) return false;
  const row = await env.DB.prepare(`SELECT 1
    FROM creator_adult_profiles p
    JOIN creator_adult_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    JOIN creator_adult_profile_publications r ON r.profile_id=p.id AND r.version_id=v.id AND r.creator_id=p.creator_id AND r.status='published'
    WHERE p.creator_id=? AND p.status='active' AND v.status='published'
    LIMIT 1`).bind(creatorId).first<{ value: number }>();
  return Boolean(row);
}

async function publicActions(env: Env, profile: ProfileRow, contacts: ContactRow[], includeAdultAction = true): Promise<PublicProfileSnapshot["actions"]> {
  const actions: PublicProfileSnapshot["actions"] = [];
  const bookingHref = configuredActionHref(env.BOOKING_ACTION_BASE_URL, "book", profile.slug);
  // A contact action requires both a configured route and a protected KV projection.
  if (env.BOOKING_ENQUIRIES_ENABLED === "true" && bookingHref && env.CONTACT_PROFILES && profile.booking?.enabled && contacts.some((item) => item.channel === "sms") && contacts.some((item) => item.channel === "email")) actions.push({ id: "book", label: profile.booking.label, href: bookingHref });
  const adultHref = configuredFriendlyMoreHref(env.SAFE_PUBLIC_PROFILE_BASE_URL, profile.slug);
  if (includeAdultAction && adultHref && await adultProjectionIsEligible(env, profile.creator_id)) actions.push({ id: "more", label: `More from ${profile.display_name}`, href: adultHref });
  return actions;
}

async function copyPublicDisplayMedia(env: Env, profile: ProfileRow, media: SfwMediaRow[]) {
  if (!media.length) return [];
  if (!publicMediaDeliveryConfigured(env)) throw new Error("Public image delivery is not configured for this environment.");
  const created: string[] = [];
  try {
    const hrefs = [];
    for (const item of media) {
      const destinationKey = publicMediaKey(profile, item);
      const existed = await env.PUBLIC_MEDIA!.head(destinationKey);
      const result = await copyDisplayDerivative(env.MEDIA!, env.PUBLIC_MEDIA!, item.object_key, destinationKey, {
        creatorId: profile.creator_id, creatorSlug: profile.slug, versionId: profile.version_id, attachmentId: item.id,
        checksum: item.sha256, imageRole: item.image_role, surface: "public_sfw",
      });
      if (!existed) created.push(destinationKey);
      const href = publicMediaHref(env, profile, item);
      if (!href) throw new Error("Public image delivery origin is not configured.");
      hrefs.push({ id: item.id, href, altText: "", contentType: item.content_type, imageRole: item.image_role, checksum: result.checksum } as const);
    }
    return hrefs;
  } catch (error) {
    if (created.length) await env.PUBLIC_MEDIA!.delete(created).catch(() => undefined);
    throw error;
  }
}

function publicDisplayMediaProjection(env: Env, profile: ProfileRow, media: SfwMediaRow[]) {
  if (!media.length) return [];
  if (!publicMediaDeliveryConfigured(env)) throw new Error("Public image delivery is not configured for this environment.");
  return media.map((item) => {
    const href = publicMediaHref(env, profile, item);
    if (!href) throw new Error("Public image delivery origin is not configured.");
    return { id: item.id, href, altText: "", contentType: item.content_type, imageRole: item.image_role, checksum: item.sha256.toLowerCase() } as const;
  });
}

async function toPublicSnapshot(env: Env, profile: ProfileRow, links: LinkRow[], contacts: ContactRow[], media: SfwMediaRow[], includeAdultAction = true): Promise<PublicProfileSnapshot> {
  // Text/link-only remains the default. Images are projected only after a
  // private display derivative has been copied to an explicit public-media
  // boundary. The snapshot contains its controlled route, never an R2 key.
  const publicMedia = publicDisplayMediaProjection(env, profile, media);
  return {
    schemaVersion: publicMedia.length ? 4 : 3,
    publishedVersionId: profile.version_id,
    creator: { slug: profile.slug, displayName: profile.display_name, headline: profile.headline, bio: profile.bio },
    links: links.map((link) => ({ id: link.id, label: link.label, destinationUrl: link.destination_url, destinationHost: link.destination_host })),
    actions: await publicActions(env, profile, contacts, includeAdultAction),
    appearance: { themeKey: profile.theme_key, buttonStyle: profile.button_style, backgroundMode: profile.background_mode, backgroundColor: profile.background_color, primaryColor: profile.primary_color, textColor: profile.text_color, cardColor: profile.card_color, radiusScale: profile.radius_scale },
    ...(publicMedia.length ? { media: publicMedia } : {}),
  };
}

async function writeContactProjection(env: Env, profile: ProfileRow, contacts: ContactRow[]) {
  if (!env.CONTACT_PROFILES) return { configured: false };
  const key = contactSnapshotKey(profile.slug);
  const bookingHref = configuredActionHref(env.BOOKING_ACTION_BASE_URL, "book", profile.slug);
  if (env.BOOKING_ENQUIRIES_ENABLED !== "true" || !bookingHref || !profile.booking?.enabled || !contacts.some((item) => item.channel === "sms") || !contacts.some((item) => item.channel === "email")) {
    await env.CONTACT_PROFILES.delete(key);
    return { configured: false, key };
  }
  const channels: ContactProfileSnapshot["channels"] = {};
  for (const contact of contacts) channels[contact.channel] = contact.contact_value;
  await env.CONTACT_PROFILES.put(key, JSON.stringify({ schemaVersion: 2, versionId: profile.version_id, config: profile.booking, creator: { id: profile.creator_id, slug: profile.slug, displayName: profile.display_name }, channels } satisfies ContactProfileSnapshot));
  return { configured: true, key };
}

async function refreshCurrentPublicSnapshot(env: Env, creatorId: string, includeAdultAction = true) {
  const current = await loadCurrentPublicProfile(env, creatorId);
  if (!current) return { refreshed: false };
  const snapshot = await toPublicSnapshot(env, current.profile, current.links, current.contacts, current.media, includeAdultAction);
  const key = publicSnapshotKey(snapshot.creator.slug);
  await env.PUBLIC_LINKS.put(key, JSON.stringify(snapshot), { metadata: { creatorId, versionId: snapshot.publishedVersionId, contentChecksum: current.profile.content_checksum } });
  return { refreshed: true, key };
}

async function recordPublicPublicationIntent(env: Env, loaded: Awaited<ReturnType<typeof loadApprovedProfile>>, key: string) {
  const operationId = publicationOperation("public_sfw", "publish", loaded.profile.version_id);
  const deliveryId = publicationDelivery("public_sfw", "publish", loaded.profile.profile_id, loaded.profile.version_id);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO operation_outbox
      (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(idempotency_key) DO UPDATE SET payload=excluded.payload,status='pending',attempts=operation_outbox.attempts+1,next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(operationId, loaded.profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ surface: "public_sfw", action: "publish", profileId: loaded.profile.profile_id, versionId: loaded.profile.version_id, key })),
    env.DB.prepare("UPDATE creator_public_profile_versions SET status='superseded' WHERE profile_id=? AND creator_id=? AND status='published' AND id<>?")
      .bind(loaded.profile.profile_id, loaded.profile.creator_id, loaded.profile.version_id),
    env.DB.prepare("UPDATE creator_public_profile_versions SET status='published' WHERE id=? AND profile_id=? AND creator_id=? AND status IN ('approved','published','superseded')")
      .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
    env.DB.prepare("UPDATE creator_public_profiles SET published_version_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
      .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
    env.DB.prepare(`INSERT INTO creator_profile_projection_deliveries
      (id,operation_id,creator_id,surface,action,profile_id,version_id,snapshot_key,status,attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(surface,action,profile_id,version_id) DO UPDATE SET operation_id=excluded.operation_id,snapshot_key=excluded.snapshot_key,status='pending',attempts=creator_profile_projection_deliveries.attempts+1,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(deliveryId, operationId, loaded.profile.creator_id, "public_sfw", "publish", loaded.profile.profile_id, loaded.profile.version_id, key),
  ]);
  return { operationId, deliveryId };
}

async function recordPublicPublicationDelivered(env: Env, loaded: Awaited<ReturnType<typeof loadApprovedProfile>>, key: string) {
  const operationId = publicationOperation("public_sfw", "publish", loaded.profile.version_id);
  const deliveryId = publicationDelivery("public_sfw", "publish", loaded.profile.profile_id, loaded.profile.version_id);
  await env.DB.batch([
    env.DB.prepare("UPDATE operation_outbox SET status='delivered',attempts=attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(operationId),
    env.DB.prepare("UPDATE creator_profile_projection_deliveries SET status='delivered',attempts=attempts+1,projected_at=CURRENT_TIMESTAMP,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(deliveryId),
    env.DB.prepare(`INSERT INTO creator_public_profile_publications
      (id,creator_id,profile_id,version_id,status,published_by,public_snapshot_key,created_at)
      VALUES (?,?,?,?,'published',?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id,version_id,status) DO UPDATE SET public_snapshot_key=excluded.public_snapshot_key,error=NULL`)
      .bind(`public-profile-publication:${loaded.profile.version_id}`, loaded.profile.creator_id, loaded.profile.profile_id, loaded.profile.version_id, loaded.profile.approved_by, key),
  ]);
}

export class PublicProfilePublishWorkflow extends WorkflowEntrypoint<Env, PublishParams> {
  async run(event: { payload: PublishParams }, step: WorkflowStep) {
    const loaded = await step.do("load approved profile", () => loadApprovedProfile(this.env, event.payload));
    const snapshot = await toPublicSnapshot(this.env, loaded.profile, loaded.links, loaded.contacts, loaded.media);
    const key = publicSnapshotKey(snapshot.creator.slug);
    const operation = await step.do("record authoritative public publication intent", () => recordPublicPublicationIntent(this.env, loaded, key));
    await step.do("copy approved public display derivatives", () => writeProjectionFailClosed({
      write: async () => { await copyPublicDisplayMedia(this.env, loaded.profile, loaded.media); },
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    // The sensitive booking projection is created before its safe-page action can appear.
    await step.do("write protected booking contact snapshot", () => writeContactProjection(this.env, loaded.profile, loaded.contacts));
    await step.do("write approved public snapshot", () => writeProjectionFailClosed({
      write: () => this.env.PUBLIC_LINKS.put(key, JSON.stringify(snapshot), { metadata: { creatorId: loaded.profile.creator_id, versionId: loaded.profile.version_id, contentChecksum: loaded.profile.content_checksum } }),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("record public projection delivery", () => markProjectionDeliveredFailClosed({
      markDelivered: () => recordPublicPublicationDelivered(this.env, loaded, key),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    return { published: true, creatorSlug: snapshot.creator.slug, versionId: snapshot.publishedVersionId };
  }
}

async function loadActiveProfileForWithdrawal(env: Env, params: WithdrawParams) {
  const profile = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,p.slug,p.published_version_id AS version_id,v.approved_by
    FROM creator_public_profiles p
    JOIN creator_public_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.status='active' AND p.published_version_id=? AND v.status='published'`)
    .bind(params.profileId, params.creatorId, params.versionId).first<ActiveProfileRow>();
  if (!profile || !profile.approved_by) throw new Error("The requested public profile is not currently published.");
  return profile;
}

async function recordPublicWithdrawalIntent(env: Env, profile: ActiveProfileRow, key: string) {
  const operationId = publicationOperation("public_sfw", "withdraw", profile.version_id);
  const deliveryId = publicationDelivery("public_sfw", "withdraw", profile.profile_id, profile.version_id);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO operation_outbox
      (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(idempotency_key) DO UPDATE SET payload=excluded.payload,status='pending',attempts=operation_outbox.attempts+1,next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(operationId, profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ surface: "public_sfw", action: "withdraw", profileId: profile.profile_id, versionId: profile.version_id, key })),
    env.DB.prepare(`INSERT INTO creator_profile_projection_deliveries
      (id,operation_id,creator_id,surface,action,profile_id,version_id,snapshot_key,status,attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(surface,action,profile_id,version_id) DO UPDATE SET operation_id=excluded.operation_id,snapshot_key=excluded.snapshot_key,status='pending',attempts=creator_profile_projection_deliveries.attempts+1,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(deliveryId, operationId, profile.creator_id, "public_sfw", "withdraw", profile.profile_id, profile.version_id, key),
  ]);
  return { operationId, deliveryId };
}

async function recordPublicWithdrawalDelivered(env: Env, profile: ActiveProfileRow, key: string) {
  const operationId = publicationOperation("public_sfw", "withdraw", profile.version_id);
  const deliveryId = publicationDelivery("public_sfw", "withdraw", profile.profile_id, profile.version_id);
  await env.DB.batch([
    env.DB.prepare("UPDATE operation_outbox SET status='delivered',attempts=attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(operationId),
    env.DB.prepare("UPDATE creator_profile_projection_deliveries SET status='delivered',attempts=attempts+1,projected_at=CURRENT_TIMESTAMP,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(deliveryId),
    env.DB.prepare("UPDATE creator_public_profile_versions SET status='superseded' WHERE id=? AND profile_id=? AND creator_id=? AND status='published'")
      .bind(profile.version_id, profile.profile_id, profile.creator_id),
    env.DB.prepare("UPDATE creator_public_profiles SET published_version_id=NULL,status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND published_version_id=?")
      .bind(profile.profile_id, profile.creator_id, profile.version_id),
    env.DB.prepare(`INSERT INTO creator_public_profile_publications
      (id,creator_id,profile_id,version_id,status,published_by,public_snapshot_key,created_at)
      VALUES (?,?,?,?,'rolled_back',?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id,version_id,status) DO UPDATE SET error=NULL`)
      .bind(`public-profile-withdrawal:${profile.version_id}`, profile.creator_id, profile.profile_id, profile.version_id, profile.approved_by, key),
  ]);
}

/** D1 records a retryable withdrawal intent before protected/public projections are removed. */
export class PublicProfileWithdrawWorkflow extends WorkflowEntrypoint<Env, WithdrawParams> {
  async run(event: { payload: WithdrawParams }, step: WorkflowStep) {
    const profile = await step.do("load active public profile", () => loadActiveProfileForWithdrawal(this.env, event.payload));
    const key = publicSnapshotKey(profile.slug);
    const operation = await step.do("record authoritative public withdrawal intent", () => recordPublicWithdrawalIntent(this.env, profile, key));
    await step.do("remove protected booking contact snapshot", () => writeProjectionFailClosed({
      write: async () => { if (this.env.CONTACT_PROFILES) await this.env.CONTACT_PROFILES.delete(contactSnapshotKey(profile.slug)); },
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("remove public snapshot", () => writeProjectionFailClosed({
      write: () => this.env.PUBLIC_LINKS.delete(key),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("remove public media copies", () => writeProjectionFailClosed({
      write: () => deleteProjectedMedia(this.env, "public_sfw", profile),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("record public withdrawal delivery", () => markProjectionDeliveredFailClosed({
      markDelivered: () => recordPublicWithdrawalDelivered(this.env, profile, key),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    return { withdrawn: true, creatorSlug: profile.slug, versionId: profile.version_id };
  }
}

async function loadApprovedAdultProfile(env: Env, params: AdultPublishParams) {
  if (!env.ADULT_PROFILES) throw new Error("The isolated adult gateway projection is not configured.");
  if (!adultMediaDeliveryConfigured(env)) throw new Error("Protected adult-media delivery is not configured for this environment.");
  const safeOrigin = configuredOrigin(env.SAFE_PUBLIC_PROFILE_BASE_URL);
  if (!safeOrigin) throw new Error("The safe public-profile origin is not configured for the adult gateway release.");
  const profile = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,c.slug,c.name AS display_name,sp.slug AS safe_profile_slug,p.status AS profile_status,
      v.id AS version_id,v.status AS version_status,v.adult_bio,v.approved_by,v.approved_at,v.content_checksum,
      a.theme_key,a.button_style,a.background_mode,a.background_color,a.primary_color,a.text_color,a.card_color,a.radius_scale,a.inherit_sfw_theme,
      d.theme_key AS sfw_theme_key,d.button_style AS sfw_button_style,d.background_mode AS sfw_background_mode,d.background_color AS sfw_background_color,d.primary_color AS sfw_primary_color,d.text_color AS sfw_text_color,d.card_color AS sfw_card_color,d.radius_scale AS sfw_radius_scale
    FROM creator_adult_profiles p
    JOIN creators c ON c.id=p.creator_id
    JOIN creator_adult_profile_versions v ON v.id=? AND v.profile_id=p.id AND v.creator_id=p.creator_id
    JOIN creator_adult_profile_appearances a ON a.profile_version_id=v.id AND a.creator_id=p.creator_id
    LEFT JOIN creator_public_profiles sp ON sp.creator_id=p.creator_id AND sp.status='active'
    LEFT JOIN creator_public_profile_details d ON d.profile_version_id=sp.published_version_id AND d.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=?`).bind(params.versionId, params.profileId, params.creatorId).first<AdultProfileRow>();
  if (!profile || !["draft", "active", "paused"].includes(profile.profile_status) || !["approved", "published", "superseded"].includes(profile.version_status) || !profile.approved_by || !profile.approved_at) {
    throw new Error("The requested adult profile version is not explicitly approved for publication.");
  }
  if (!profile.safe_profile_slug || !isPublicCreatorSlug(profile.safe_profile_slug)) {
    throw new Error("An active safe public profile with a valid public URL is required before publishing this profile.");
  }
  const links = await env.DB.prepare(`SELECT link_id AS id,label,destination_url,destination_host
    FROM creator_adult_link_revisions WHERE creator_id=? AND profile_version_id=? AND enabled=1 ORDER BY sort_order ASC`)
    .bind(profile.creator_id, profile.version_id).all<LinkRow>();
  if (links.results.some((link) => !validHttpsDestination(link.destination_url, link.destination_host))) throw new Error("The approved adult profile contains an invalid credential-free HTTPS destination link.");
  const media = await env.DB.prepare(`SELECT a.id,d.object_key,d.sha256,'' AS alt_text,d.content_type,a.image_role
    FROM creator_profile_image_attachments a
    JOIN creator_profile_image_derivatives d ON d.id=a.derivative_id AND d.creator_id=a.creator_id
    JOIN creator_profile_image_uploads u ON u.id=d.upload_id AND u.creator_id=d.creator_id
    JOIN creator_adult_profile_versions av ON av.id=a.adult_profile_version_id AND av.creator_id=a.creator_id AND av.profile_id=?
    WHERE a.creator_id=? AND a.adult_profile_version_id=? AND a.surface='adult_profile' AND a.status='attached'
      AND a.image_role IN ('avatar','background')
      AND d.derivative_kind='display' AND d.content_type='image/webp'
      AND u.surface='adult_profile' AND u.image_role=a.image_role AND u.status='processed'
    ORDER BY CASE a.image_role WHEN 'background' THEN 0 ELSE 1 END`).bind(profile.profile_id, profile.creator_id, profile.version_id).all<AdultMediaRow>();
  return { profile, links: links.results, media: media.results, safeProfileUrl: `${safeOrigin}/${encodeURIComponent(profile.safe_profile_slug)}` };
}

async function copyAdultDisplayMedia(env: Env, profile: AdultProfileRow, media: AdultMediaRow[]) {
  if (!media.length) return [];
  if (!adultMediaDeliveryConfigured(env)) throw new Error("Protected adult-media delivery is not configured for this environment.");
  const created: string[] = [];
  try {
    const copied = [];
    for (const item of media) {
      const destinationKey = adultMediaKey(profile, item);
      const existed = await env.ADULT_MEDIA!.head(destinationKey);
      const result = await copyDisplayDerivative(env.MEDIA!, env.ADULT_MEDIA!, item.object_key, destinationKey, {
        creatorId: profile.creator_id, creatorSlug: profile.slug, versionId: profile.version_id, attachmentId: item.id,
        checksum: item.sha256, imageRole: item.image_role, surface: "adult_profile",
      });
      if (!existed) created.push(destinationKey);
      copied.push({ id: item.id, mediaKey: result.destinationKey, checksum: result.checksum, altText: item.alt_text, contentType: item.content_type, imageRole: item.image_role } as const);
    }
    return copied;
  } catch (error) {
    if (created.length) await env.ADULT_MEDIA!.delete(created).catch(() => undefined);
    throw error;
  }
}

function adultDisplayMediaProjection(env: Env, profile: AdultProfileRow, media: AdultMediaRow[]) {
  if (!media.length) return [];
  if (!adultMediaDeliveryConfigured(env)) throw new Error("Protected adult-media delivery is not configured for this environment.");
  return media.map((item) => ({
    id: item.id,
    mediaKey: adultMediaKey(profile, item),
    checksum: item.sha256.toLowerCase(),
    altText: item.alt_text,
    contentType: item.content_type,
    imageRole: item.image_role,
  } as const));
}

function toAdultSnapshot(env: Env, loaded: Awaited<ReturnType<typeof loadApprovedAdultProfile>>): AdultProfileSnapshot {
  const useSafeAppearance = loaded.profile.inherit_sfw_theme === 1 && loaded.profile.sfw_theme_key && loaded.profile.sfw_button_style && loaded.profile.sfw_background_mode && loaded.profile.sfw_background_color && loaded.profile.sfw_primary_color && loaded.profile.sfw_text_color && loaded.profile.sfw_card_color && loaded.profile.sfw_radius_scale;
  const appearance = useSafeAppearance ? { themeKey: loaded.profile.sfw_theme_key!, buttonStyle: loaded.profile.sfw_button_style!, backgroundMode: loaded.profile.sfw_background_mode!, backgroundColor: loaded.profile.sfw_background_color!, primaryColor: loaded.profile.sfw_primary_color!, textColor: loaded.profile.sfw_text_color!, cardColor: loaded.profile.sfw_card_color!, radiusScale: loaded.profile.sfw_radius_scale! } : { themeKey: loaded.profile.theme_key, buttonStyle: loaded.profile.button_style, backgroundMode: loaded.profile.background_mode, backgroundColor: loaded.profile.background_color, primaryColor: loaded.profile.primary_color, textColor: loaded.profile.text_color, cardColor: loaded.profile.card_color, radiusScale: loaded.profile.radius_scale };
  return {
    schemaVersion: 4,
    publishedVersionId: loaded.profile.version_id,
    creator: { slug: loaded.profile.slug, displayName: loaded.profile.display_name, bio: loaded.profile.adult_bio, safeProfileUrl: loaded.safeProfileUrl },
    links: loaded.links.map((link) => ({ id: link.id, label: link.label, destinationUrl: link.destination_url, destinationHost: link.destination_host })),
    media: adultDisplayMediaProjection(env, loaded.profile, loaded.media),
    appearance,
  };
}

async function recordAdultPublicationIntent(env: Env, loaded: Awaited<ReturnType<typeof loadApprovedAdultProfile>>, key: string) {
  const operationId = publicationOperation("adult_profile", "publish", loaded.profile.version_id);
  const deliveryId = publicationDelivery("adult_profile", "publish", loaded.profile.profile_id, loaded.profile.version_id);
  await env.DB.batch([
    // operation_type remains the existing generic profile projection category;
    // the payload and delivery row carry the authoritative surface distinction.
    env.DB.prepare(`INSERT INTO operation_outbox
      (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(idempotency_key) DO UPDATE SET payload=excluded.payload,status='pending',attempts=operation_outbox.attempts+1,next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(operationId, loaded.profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ surface: "adult_profile", action: "publish", profileId: loaded.profile.profile_id, versionId: loaded.profile.version_id, key })),
    env.DB.prepare("UPDATE creator_adult_profile_versions SET status='superseded' WHERE profile_id=? AND creator_id=? AND status='published' AND id<>?")
      .bind(loaded.profile.profile_id, loaded.profile.creator_id, loaded.profile.version_id),
    env.DB.prepare("UPDATE creator_adult_profile_versions SET status='published' WHERE id=? AND profile_id=? AND creator_id=? AND status IN ('approved','published','superseded')")
      .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
    env.DB.prepare("UPDATE creator_adult_profiles SET published_version_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
      .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
    env.DB.prepare(`INSERT INTO creator_profile_projection_deliveries
      (id,operation_id,creator_id,surface,action,profile_id,version_id,snapshot_key,status,attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(surface,action,profile_id,version_id) DO UPDATE SET operation_id=excluded.operation_id,snapshot_key=excluded.snapshot_key,status='pending',attempts=creator_profile_projection_deliveries.attempts+1,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(deliveryId, operationId, loaded.profile.creator_id, "adult_profile", "publish", loaded.profile.profile_id, loaded.profile.version_id, key),
  ]);
  return { operationId, deliveryId };
}

async function recordAdultPublicationDelivered(env: Env, loaded: Awaited<ReturnType<typeof loadApprovedAdultProfile>>, key: string) {
  const operationId = publicationOperation("adult_profile", "publish", loaded.profile.version_id);
  const deliveryId = publicationDelivery("adult_profile", "publish", loaded.profile.profile_id, loaded.profile.version_id);
  await env.DB.batch([
    env.DB.prepare("UPDATE operation_outbox SET status='delivered',attempts=attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(operationId),
    env.DB.prepare("UPDATE creator_profile_projection_deliveries SET status='delivered',attempts=attempts+1,projected_at=CURRENT_TIMESTAMP,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(deliveryId),
    env.DB.prepare(`INSERT INTO creator_adult_profile_publications
      (id,creator_id,profile_id,version_id,status,published_by,adult_snapshot_key,created_at)
      VALUES (?,?,?,?,'published',?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id,version_id,status) DO UPDATE SET adult_snapshot_key=excluded.adult_snapshot_key,error=NULL`)
      .bind(`adult-profile-publication:${loaded.profile.version_id}`, loaded.profile.creator_id, loaded.profile.profile_id, loaded.profile.version_id, loaded.profile.approved_by, key),
  ]);
}

export class AdultProfilePublishWorkflow extends WorkflowEntrypoint<Env, AdultPublishParams> {
  async run(event: { payload: AdultPublishParams }, step: WorkflowStep) {
    const loaded = await step.do("load approved adult profile", () => loadApprovedAdultProfile(this.env, event.payload));
    const snapshot = toAdultSnapshot(this.env, loaded);
    const key = adultSnapshotKey(snapshot.creator.slug);
    const operation = await step.do("record authoritative adult publication intent", () => recordAdultPublicationIntent(this.env, loaded, key));
    await step.do("copy protected adult display derivatives", () => writeProjectionFailClosed({
      write: async () => { await copyAdultDisplayMedia(this.env, loaded.profile, loaded.media); },
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("write isolated adult gateway snapshot", () => writeProjectionFailClosed({
      write: async () => {
        if (!this.env.ADULT_PROFILES) throw new Error("adult_projection_not_configured");
        await this.env.ADULT_PROFILES.put(key, JSON.stringify(snapshot), { metadata: { creatorId: loaded.profile.creator_id, versionId: loaded.profile.version_id, contentChecksum: loaded.profile.content_checksum } });
      },
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("record adult projection delivery", () => markProjectionDeliveredFailClosed({
      markDelivered: () => recordAdultPublicationDelivered(this.env, loaded, key),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("refresh safe profile actions", () => refreshCurrentPublicSnapshot(this.env, loaded.profile.creator_id));
    return { published: true, creatorSlug: snapshot.creator.slug, versionId: snapshot.publishedVersionId };
  }
}

async function loadActiveAdultProfileForWithdrawal(env: Env, params: AdultWithdrawParams) {
  const profile = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,c.slug,p.published_version_id AS version_id,v.approved_by
    FROM creator_adult_profiles p
    JOIN creators c ON c.id=p.creator_id
    JOIN creator_adult_profile_versions v ON v.id=p.published_version_id AND v.profile_id=p.id AND v.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.status='active' AND p.published_version_id=? AND v.status='published'`)
    .bind(params.profileId, params.creatorId, params.versionId).first<ActiveAdultProfileRow>();
  if (!profile || !profile.approved_by) throw new Error("The requested adult profile is not currently published.");
  return profile;
}

async function recordAdultWithdrawalIntent(env: Env, profile: ActiveAdultProfileRow, key: string) {
  const operationId = publicationOperation("adult_profile", "withdraw", profile.version_id);
  const deliveryId = publicationDelivery("adult_profile", "withdraw", profile.profile_id, profile.version_id);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO operation_outbox
      (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(idempotency_key) DO UPDATE SET payload=excluded.payload,status='pending',attempts=operation_outbox.attempts+1,next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(operationId, profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ surface: "adult_profile", action: "withdraw", profileId: profile.profile_id, versionId: profile.version_id, key })),
    env.DB.prepare(`INSERT INTO creator_profile_projection_deliveries
      (id,operation_id,creator_id,surface,action,profile_id,version_id,snapshot_key,status,attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(surface,action,profile_id,version_id) DO UPDATE SET operation_id=excluded.operation_id,snapshot_key=excluded.snapshot_key,status='pending',attempts=creator_profile_projection_deliveries.attempts+1,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(deliveryId, operationId, profile.creator_id, "adult_profile", "withdraw", profile.profile_id, profile.version_id, key),
  ]);
  return { operationId, deliveryId };
}

async function recordAdultWithdrawalDelivered(env: Env, profile: ActiveAdultProfileRow, key: string) {
  const operationId = publicationOperation("adult_profile", "withdraw", profile.version_id);
  const deliveryId = publicationDelivery("adult_profile", "withdraw", profile.profile_id, profile.version_id);
  await env.DB.batch([
    env.DB.prepare("UPDATE operation_outbox SET status='delivered',attempts=attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(operationId),
    env.DB.prepare("UPDATE creator_profile_projection_deliveries SET status='delivered',attempts=attempts+1,projected_at=CURRENT_TIMESTAMP,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(deliveryId),
    env.DB.prepare("UPDATE creator_adult_profile_versions SET status='superseded' WHERE id=? AND profile_id=? AND creator_id=? AND status='published'")
      .bind(profile.version_id, profile.profile_id, profile.creator_id),
    env.DB.prepare("UPDATE creator_adult_profiles SET published_version_id=NULL,status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND published_version_id=?")
      .bind(profile.profile_id, profile.creator_id, profile.version_id),
    env.DB.prepare(`INSERT INTO creator_adult_profile_publications
      (id,creator_id,profile_id,version_id,status,published_by,adult_snapshot_key,created_at)
      VALUES (?,?,?,?,'rolled_back',?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id,version_id,status) DO UPDATE SET error=NULL`)
      .bind(`adult-profile-withdrawal:${profile.version_id}`, profile.creator_id, profile.profile_id, profile.version_id, profile.approved_by, key),
  ]);
}

/** D1 records a retryable withdrawal intent before the protected gateway is revoked. */
export class AdultProfileWithdrawWorkflow extends WorkflowEntrypoint<Env, AdultWithdrawParams> {
  async run(event: { payload: AdultWithdrawParams }, step: WorkflowStep) {
    const profile = await step.do("load active adult profile", () => loadActiveAdultProfileForWithdrawal(this.env, event.payload));
    const key = adultSnapshotKey(profile.slug);
    const operation = await step.do("record authoritative adult withdrawal intent", () => recordAdultWithdrawalIntent(this.env, profile, key));
    await step.do("remove isolated adult gateway snapshot", () => writeProjectionFailClosed({
      write: async () => {
        if (!this.env.ADULT_PROFILES) throw new Error("adult_projection_not_configured");
        await this.env.ADULT_PROFILES.delete(key);
      },
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("remove protected adult media copies", () => writeProjectionFailClosed({
      write: () => deleteProjectedMedia(this.env, "adult_profile", profile),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("remove safe profile adult action", () => writeProjectionFailClosed({
      write: () => refreshCurrentPublicSnapshot(this.env, profile.creator_id, false).then(() => undefined),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    await step.do("record adult withdrawal delivery", () => markProjectionDeliveredFailClosed({
      markDelivered: () => recordAdultWithdrawalDelivered(this.env, profile, key),
      recordFailure: (reason) => recordProjectionFailure(this.env, operation.operationId, operation.deliveryId, reason),
    }));
    return { withdrawn: true, creatorSlug: profile.slug, versionId: profile.version_id };
  }
}

function parsePublishParams(value: unknown): PublishParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<PublishParams>;
  if (typeof input.creatorId !== "string" || !CREATOR_ID.test(input.creatorId) || typeof input.profileId !== "string" || !RECORD_ID.test(input.profileId) || typeof input.versionId !== "string" || !RECORD_ID.test(input.versionId)) return null;
  return { creatorId: input.creatorId, profileId: input.profileId, versionId: input.versionId };
}

function parsePortfolioParams(value: unknown): PortfolioParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<PortfolioParams>;
  if (typeof input.creatorId !== "string" || !CREATOR_ID.test(input.creatorId) || typeof input.versionId !== "string" || !RECORD_ID.test(input.versionId)) return null;
  return { creatorId: input.creatorId, versionId: input.versionId };
}

const routes = {
  "/publish": { capability: "public.profile.publish", workflow: "PUBLIC_PROFILE_PUBLISH", prefix: "public-profile", surface: "public" },
  "/withdraw": { capability: "public.profile.withdraw", workflow: "PUBLIC_PROFILE_WITHDRAW", prefix: "public-profile-withdraw", surface: "public" },
  "/adult/publish": { capability: "adult.profile.publish", workflow: "ADULT_PROFILE_PUBLISH", prefix: "adult-profile", surface: "adult" },
  "/adult/withdraw": { capability: "adult.profile.withdraw", workflow: "ADULT_PROFILE_WITHDRAW", prefix: "adult-profile-withdraw", surface: "adult" },
} as const;

function routePublicationPolicy(env: Env, surface: "public" | "adult") {
  return surface === "adult"
    ? publicationPolicy(env.ADULT_PROFILE_PUBLICATION_MODE, env.ADULT_PROFILE_SYNTHETIC_CREATOR_IDS)
    : publicationPolicy(env.PUBLIC_PROFILE_PUBLICATION_MODE, env.PUBLIC_PROFILE_SYNTHETIC_CREATOR_IDS);
}

export default {
  async scheduled(_event: ScheduledController, env: Env) {
    await purgeBookingReceipts(env);
    await reconcilePublishedPortfolios(env);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/booking/")) return handleBooking(request, env);
    if (request.method === "POST" && (url.pathname === "/adult/portfolio/publish" || url.pathname === "/adult/portfolio/withdraw")) {
      const params = parsePortfolioParams(await request.clone().json().catch(() => null));
      if (!params) return Response.json({ ok: false, error: "invalid_publication_request" }, { status: 400 });
      const action = url.pathname.endsWith("/withdraw") ? "withdraw" : "publish";
      try {
        const service = await requireInternalServiceForCreator(request, env.DB, params.creatorId, "thot-os-web-public-links", `adult.portfolio.${action}`);
        await internalServiceAuditStatement(env.DB, service, url.pathname).run();
      } catch { return Response.json({ ok: false, error: "unauthorized" }, { status: 401 }); }
      if (!publicationIsAllowed(routePublicationPolicy(env, "adult"), params.creatorId)) return Response.json({ ok: false, error: "publication_unavailable" }, { status: 503 });
      try {
        const workflow = action === "publish" ? env.PORTFOLIO_PUBLISH : env.PORTFOLIO_WITHDRAW;
        if (!workflow || !env.PREVIEWS || !env.LIBRARY_MEDIA || !env.ADULT_MEDIA || !env.ADULT_PROFILES) throw new Error("portfolio_release_bindings_unavailable");
        if (action === "withdraw") await beginPortfolioWithdrawal(env, params);
        const instance = await workflow.create({ id: action === "withdraw" ? `adult-portfolio-withdraw-${params.versionId}-${crypto.randomUUID()}` : `adult-portfolio-publish-${params.versionId}`, params });
        return Response.json({ ok: true, instanceId: instance.id }, { status: 202 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        if (/already exists|already.*instance/i.test(message)) return Response.json({ ok: true, duplicate: true }, { status: 202 });
        return Response.json({ ok: false, error: "publication_unavailable" }, { status: 503 });
      }
    }
    const route = routes[url.pathname as keyof typeof routes];
    if (request.method !== "POST" || !route) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    const params = parsePublishParams(await request.clone().json().catch(() => null));
    if (!params) return Response.json({ ok: false, error: "invalid_publication_request" }, { status: 400 });
    try {
      const service = await requireInternalServiceForCreator(request, env.DB, params.creatorId, "thot-os-web-public-links", route.capability);
      await internalServiceAuditStatement(env.DB, service, url.pathname).run();
    } catch {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    // This policy is intentionally evaluated at the control boundary after
    // authenticated identity verification.  Browser/request payloads cannot
    // select a mode or a synthetic allowlist entry.
    if (!publicationIsAllowed(routePublicationPolicy(env, route.surface), params.creatorId)) {
      console.info(JSON.stringify({ event: "protected_profile_release_denied", route: url.pathname, creatorId: params.creatorId, profileId: params.profileId, versionId: params.versionId, reason: "publication_policy_denied" }));
      return Response.json({ ok: false, error: "publication_unavailable" }, { status: 503 });
    }
    const instanceId = `${route.prefix}-${params.versionId}`;
    try {
      if (url.pathname === "/withdraw" && env.BOOKING_ENQUIRIES_ENABLED === "true") {
        const current = await loadActiveProfileForWithdrawal(env, params);
        await recordPublicWithdrawalIntent(env, current, publicSnapshotKey(current.slug));
      }
      const workflow = env[route.workflow];
      if (!workflow) throw new Error("The requested release workflow is not configured.");
      const instance = await workflow.create({ id: instanceId, params });
      return Response.json({ ok: true, instanceId: instance.id }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow could not be created.";
      if (/already exists|already.*instance/i.test(message)) return Response.json({ ok: true, instanceId, duplicate: true }, { status: 202 });
      console.error(JSON.stringify({ event: "protected_profile_release_start_failed", route: url.pathname, creatorId: params.creatorId, profileId: params.profileId, versionId: params.versionId, message }));
      return Response.json({ ok: false, error: "publication_unavailable" }, { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
