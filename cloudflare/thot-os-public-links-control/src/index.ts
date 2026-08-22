import { WorkflowEntrypoint, type WorkflowStep } from "cloudflare:workers";
import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";

type PublishParams = { creatorId: string; profileId: string; versionId: string };
type WithdrawParams = PublishParams;
type AdultPublishParams = PublishParams;
type AdultWithdrawParams = AdultPublishParams;

type ProfileRow = {
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
};
type AdultMediaRow = { id: string; object_key: string; alt_text: string };
type ActiveAdultProfileRow = { profile_id: string; creator_id: string; slug: string; version_id: string; approved_by: string };

type PublicProfileSnapshot = {
  schemaVersion: 3;
  publishedVersionId: string;
  creator: { slug: string; displayName: string; headline: string; bio: string };
  links: Array<{ id: string; label: string; destinationUrl: string; destinationHost: string }>;
  // The only public interaction values are configured protected-service URLs.
  // Contact values and adult destinations never enter this snapshot.
  actions: Array<{ id: "book" | "more"; label: string; href: string }>;
  appearance: { themeKey: string; buttonStyle: string; backgroundMode: string; backgroundColor: string; primaryColor: string; textColor: string; cardColor: string; radiusScale: string };
};

type ContactProfileSnapshot = {
  schemaVersion: 1;
  creator: { slug: string; displayName: string };
  channels: Partial<Record<"sms" | "email", string>>;
};

type AdultProfileSnapshot = {
  schemaVersion: 2;
  publishedVersionId: string;
  creator: { slug: string; displayName: string; bio: string; safeProfileUrl: string };
  links: Array<{ id: string; label: string; destinationUrl: string; destinationHost: string }>;
  media: Array<{ id: string; objectKey: string; altText: string }>;
  appearance: { themeKey: string; buttonStyle: string; backgroundMode: string; backgroundColor: string; primaryColor: string; textColor: string; cardColor: string; radiusScale: string };
};

const CREATOR_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const RECORD_ID = /^[a-zA-Z0-9_-]{1,160}$/;

function publicSnapshotKey(slug: string) { return `public-profile:${slug}`; }
function contactSnapshotKey(slug: string) { return `public-contact:${slug}`; }
function adultSnapshotKey(slug: string) { return `adult-profile:${slug}`; }

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
  return { profile, links: links.results, contacts: contacts.results };
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

async function publicActions(env: Env, profile: ProfileRow, contacts: ContactRow[]): Promise<PublicProfileSnapshot["actions"]> {
  const actions: PublicProfileSnapshot["actions"] = [];
  const bookingHref = configuredActionHref(env.BOOKING_ACTION_BASE_URL, "book", profile.slug);
  // A contact action requires both a configured route and a protected KV projection.
  if (bookingHref && env.CONTACT_PROFILES && contacts.length > 0) actions.push({ id: "book", label: `Book ${profile.display_name}`, href: bookingHref });
  const adultHref = configuredActionHref(env.ADULT_GATEWAY_BASE_URL, "age", profile.slug);
  if (adultHref && await adultProjectionIsEligible(env, profile.creator_id)) actions.push({ id: "more", label: `More from ${profile.display_name}`, href: adultHref });
  return actions;
}

async function toPublicSnapshot(env: Env, profile: ProfileRow, links: LinkRow[], contacts: ContactRow[]): Promise<PublicProfileSnapshot> {
  return {
    schemaVersion: 3,
    publishedVersionId: profile.version_id,
    creator: { slug: profile.slug, displayName: profile.display_name, headline: profile.headline, bio: profile.bio },
    links: links.map((link) => ({ id: link.id, label: link.label, destinationUrl: link.destination_url, destinationHost: link.destination_host })),
    actions: await publicActions(env, profile, contacts),
    appearance: { themeKey: profile.theme_key, buttonStyle: profile.button_style, backgroundMode: profile.background_mode, backgroundColor: profile.background_color, primaryColor: profile.primary_color, textColor: profile.text_color, cardColor: profile.card_color, radiusScale: profile.radius_scale },
  };
}

async function writeContactProjection(env: Env, profile: ProfileRow, contacts: ContactRow[]) {
  if (!env.CONTACT_PROFILES) return { configured: false };
  const key = contactSnapshotKey(profile.slug);
  const bookingHref = configuredActionHref(env.BOOKING_ACTION_BASE_URL, "book", profile.slug);
  if (!bookingHref || !contacts.length) {
    await env.CONTACT_PROFILES.delete(key);
    return { configured: false, key };
  }
  const channels: ContactProfileSnapshot["channels"] = {};
  for (const contact of contacts) channels[contact.channel] = contact.contact_value;
  await env.CONTACT_PROFILES.put(key, JSON.stringify({ schemaVersion: 1, creator: { slug: profile.slug, displayName: profile.display_name }, channels } satisfies ContactProfileSnapshot));
  return { configured: true, key };
}

async function refreshCurrentPublicSnapshot(env: Env, creatorId: string) {
  const current = await loadCurrentPublicProfile(env, creatorId);
  if (!current) return { refreshed: false };
  const snapshot = await toPublicSnapshot(env, current.profile, current.links, current.contacts);
  const key = publicSnapshotKey(snapshot.creator.slug);
  await env.PUBLIC_LINKS.put(key, JSON.stringify(snapshot), { metadata: { creatorId, versionId: snapshot.publishedVersionId, contentChecksum: current.profile.content_checksum } });
  return { refreshed: true, key };
}

export class PublicProfilePublishWorkflow extends WorkflowEntrypoint<Env, PublishParams> {
  async run(event: { payload: PublishParams }, step: WorkflowStep) {
    const loaded = await step.do("load approved profile", () => loadApprovedProfile(this.env, event.payload));
    // The sensitive booking projection is created before its safe-page action can appear.
    await step.do("write protected booking contact snapshot", () => writeContactProjection(this.env, loaded.profile, loaded.contacts));
    const snapshot = await toPublicSnapshot(this.env, loaded.profile, loaded.links, loaded.contacts);
    const key = publicSnapshotKey(snapshot.creator.slug);
    await step.do("write approved public snapshot", async () => {
      await this.env.PUBLIC_LINKS.put(key, JSON.stringify(snapshot), { metadata: { creatorId: loaded.profile.creator_id, versionId: loaded.profile.version_id, contentChecksum: loaded.profile.content_checksum } });
      return { key };
    });
    await step.do("record publication", async () => {
      const publicationId = `public-profile-publication:${loaded.profile.version_id}`;
      const operationId = `public-profile-publish:${loaded.profile.version_id}`;
      await this.env.DB.batch([
        this.env.DB.prepare(`INSERT INTO operation_outbox
          (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,delivered_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'delivered',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(idempotency_key) DO UPDATE SET status='delivered',attempts=operation_outbox.attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(operationId, loaded.profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ profileId: loaded.profile.profile_id, versionId: loaded.profile.version_id, key })),
        this.env.DB.prepare("UPDATE creator_public_profile_versions SET status='superseded' WHERE profile_id=? AND creator_id=? AND status='published' AND id<>?")
          .bind(loaded.profile.profile_id, loaded.profile.creator_id, loaded.profile.version_id),
        this.env.DB.prepare("UPDATE creator_public_profile_versions SET status='published' WHERE id=? AND profile_id=? AND creator_id=? AND status IN ('approved','published','superseded')")
          .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
        this.env.DB.prepare("UPDATE creator_public_profiles SET published_version_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
          .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
        this.env.DB.prepare(`INSERT INTO creator_public_profile_publications
          (id,creator_id,profile_id,version_id,status,published_by,public_snapshot_key,created_at)
          VALUES (?,?,?,?,'published',?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(profile_id,version_id,status) DO UPDATE SET public_snapshot_key=excluded.public_snapshot_key,error=NULL`)
          .bind(publicationId, loaded.profile.creator_id, loaded.profile.profile_id, loaded.profile.version_id, loaded.profile.approved_by, key),
      ]);
      return { publicationId };
    });
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

/** Removes protected booking data before removing the safe public snapshot. */
export class PublicProfileWithdrawWorkflow extends WorkflowEntrypoint<Env, WithdrawParams> {
  async run(event: { payload: WithdrawParams }, step: WorkflowStep) {
    const profile = await step.do("load active public profile", () => loadActiveProfileForWithdrawal(this.env, event.payload));
    const key = publicSnapshotKey(profile.slug);
    await step.do("remove protected booking contact snapshot", async () => {
      if (this.env.CONTACT_PROFILES) await this.env.CONTACT_PROFILES.delete(contactSnapshotKey(profile.slug));
      return { key: contactSnapshotKey(profile.slug) };
    });
    await step.do("remove public snapshot", async () => {
      await this.env.PUBLIC_LINKS.delete(key);
      return { key };
    });
    await step.do("record withdrawal", async () => {
      const operationId = `public-profile-withdraw:${profile.profile_id}:${profile.version_id}`;
      await this.env.DB.batch([
        this.env.DB.prepare(`INSERT INTO operation_outbox
          (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,delivered_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'delivered',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(idempotency_key) DO UPDATE SET status='delivered',attempts=operation_outbox.attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(operationId, profile.creator_id, "public_profile_publish", operationId, JSON.stringify({ profileId: profile.profile_id, versionId: profile.version_id, key, action: "withdraw" })),
        this.env.DB.prepare("UPDATE creator_public_profile_versions SET status='superseded' WHERE id=? AND profile_id=? AND creator_id=? AND status='published'")
          .bind(profile.version_id, profile.profile_id, profile.creator_id),
        this.env.DB.prepare("UPDATE creator_public_profiles SET published_version_id=NULL,status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND published_version_id=?")
          .bind(profile.profile_id, profile.creator_id, profile.version_id),
        this.env.DB.prepare(`INSERT INTO creator_public_profile_publications
          (id,creator_id,profile_id,version_id,status,published_by,public_snapshot_key,created_at)
          VALUES (?,?,?,?,'rolled_back',?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(profile_id,version_id,status) DO UPDATE SET error=NULL`)
          .bind(`public-profile-withdrawal:${profile.version_id}`, profile.creator_id, profile.profile_id, profile.version_id, profile.approved_by, key),
      ]);
      return { operationId };
    });
    return { withdrawn: true, creatorSlug: profile.slug, versionId: profile.version_id };
  }
}

async function loadApprovedAdultProfile(env: Env, params: AdultPublishParams) {
  if (!env.ADULT_PROFILES) throw new Error("The isolated adult gateway projection is not configured.");
  const safeOrigin = configuredOrigin(env.SAFE_PUBLIC_PROFILE_BASE_URL);
  if (!safeOrigin) throw new Error("The safe public-profile origin is not configured for the adult gateway release.");
  const profile = await env.DB.prepare(`SELECT p.id AS profile_id,p.creator_id,c.slug,c.name AS display_name,p.status AS profile_status,
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
  const links = await env.DB.prepare(`SELECT link_id AS id,label,destination_url,destination_host
    FROM creator_adult_link_revisions WHERE creator_id=? AND profile_version_id=? AND enabled=1 ORDER BY sort_order ASC`)
    .bind(profile.creator_id, profile.version_id).all<LinkRow>();
  if (links.results.some((link) => !validHttpsDestination(link.destination_url, link.destination_host))) throw new Error("The approved adult profile contains an invalid credential-free HTTPS destination link.");
  const media = await env.DB.prepare(`SELECT m.id,m.derivative_object_key AS object_key,m.alt_text
    FROM creator_adult_profile_media m
    JOIN creator_media_release_attestations r ON r.creator_id=m.creator_id AND r.asset_id=m.asset_id AND r.surface='adult_profile' AND r.status='approved'
    WHERE m.creator_id=? AND m.profile_version_id=? AND m.enabled=1 ORDER BY m.sort_order ASC`).bind(profile.creator_id, profile.version_id).all<AdultMediaRow>();
  return { profile, links: links.results, media: media.results, safeProfileUrl: `${safeOrigin}/${encodeURIComponent(profile.slug)}` };
}

function toAdultSnapshot(loaded: Awaited<ReturnType<typeof loadApprovedAdultProfile>>): AdultProfileSnapshot {
  const useSafeAppearance = loaded.profile.inherit_sfw_theme === 1 && loaded.profile.sfw_theme_key && loaded.profile.sfw_button_style && loaded.profile.sfw_background_mode && loaded.profile.sfw_background_color && loaded.profile.sfw_primary_color && loaded.profile.sfw_text_color && loaded.profile.sfw_card_color && loaded.profile.sfw_radius_scale;
  const appearance = useSafeAppearance ? { themeKey: loaded.profile.sfw_theme_key!, buttonStyle: loaded.profile.sfw_button_style!, backgroundMode: loaded.profile.sfw_background_mode!, backgroundColor: loaded.profile.sfw_background_color!, primaryColor: loaded.profile.sfw_primary_color!, textColor: loaded.profile.sfw_text_color!, cardColor: loaded.profile.sfw_card_color!, radiusScale: loaded.profile.sfw_radius_scale! } : { themeKey: loaded.profile.theme_key, buttonStyle: loaded.profile.button_style, backgroundMode: loaded.profile.background_mode, backgroundColor: loaded.profile.background_color, primaryColor: loaded.profile.primary_color, textColor: loaded.profile.text_color, cardColor: loaded.profile.card_color, radiusScale: loaded.profile.radius_scale };
  return {
    schemaVersion: 2,
    publishedVersionId: loaded.profile.version_id,
    creator: { slug: loaded.profile.slug, displayName: loaded.profile.display_name, bio: loaded.profile.adult_bio, safeProfileUrl: loaded.safeProfileUrl },
    links: loaded.links.map((link) => ({ id: link.id, label: link.label, destinationUrl: link.destination_url, destinationHost: link.destination_host })),
    media: loaded.media.map((media) => ({ id: media.id, objectKey: media.object_key, altText: media.alt_text })),
    appearance,
  };
}

export class AdultProfilePublishWorkflow extends WorkflowEntrypoint<Env, AdultPublishParams> {
  async run(event: { payload: AdultPublishParams }, step: WorkflowStep) {
    const loaded = await step.do("load approved adult profile", () => loadApprovedAdultProfile(this.env, event.payload));
    const snapshot = toAdultSnapshot(loaded);
    const key = adultSnapshotKey(snapshot.creator.slug);
    await step.do("write isolated adult gateway snapshot", async () => {
      if (!this.env.ADULT_PROFILES) throw new Error("The isolated adult gateway projection is not configured.");
      await this.env.ADULT_PROFILES.put(key, JSON.stringify(snapshot), { metadata: { creatorId: loaded.profile.creator_id, versionId: loaded.profile.version_id, contentChecksum: loaded.profile.content_checksum } });
      return { key };
    });
    await step.do("record adult publication", async () => {
      const publicationId = `adult-profile-publication:${loaded.profile.version_id}`;
      const operationId = `adult-profile-publish:${loaded.profile.version_id}`;
      await this.env.DB.batch([
        this.env.DB.prepare(`INSERT INTO operation_outbox
          (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,delivered_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'delivered',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(idempotency_key) DO UPDATE SET status='delivered',attempts=operation_outbox.attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(operationId, loaded.profile.creator_id, "adult_profile_publish", operationId, JSON.stringify({ profileId: loaded.profile.profile_id, versionId: loaded.profile.version_id, key })),
        this.env.DB.prepare("UPDATE creator_adult_profile_versions SET status='superseded' WHERE profile_id=? AND creator_id=? AND status='published' AND id<>?")
          .bind(loaded.profile.profile_id, loaded.profile.creator_id, loaded.profile.version_id),
        this.env.DB.prepare("UPDATE creator_adult_profile_versions SET status='published' WHERE id=? AND profile_id=? AND creator_id=? AND status IN ('approved','published','superseded')")
          .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
        this.env.DB.prepare("UPDATE creator_adult_profiles SET published_version_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
          .bind(loaded.profile.version_id, loaded.profile.profile_id, loaded.profile.creator_id),
        this.env.DB.prepare(`INSERT INTO creator_adult_profile_publications
          (id,creator_id,profile_id,version_id,status,published_by,adult_snapshot_key,created_at)
          VALUES (?,?,?,?,'published',?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(profile_id,version_id,status) DO UPDATE SET adult_snapshot_key=excluded.adult_snapshot_key,error=NULL`)
          .bind(publicationId, loaded.profile.creator_id, loaded.profile.profile_id, loaded.profile.version_id, loaded.profile.approved_by, key),
      ]);
      return { publicationId };
    });
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

/** The isolated gateway KV entry is deleted before D1 makes the version unavailable. */
export class AdultProfileWithdrawWorkflow extends WorkflowEntrypoint<Env, AdultWithdrawParams> {
  async run(event: { payload: AdultWithdrawParams }, step: WorkflowStep) {
    const profile = await step.do("load active adult profile", () => loadActiveAdultProfileForWithdrawal(this.env, event.payload));
    const key = adultSnapshotKey(profile.slug);
    await step.do("remove isolated adult gateway snapshot", async () => {
      if (!this.env.ADULT_PROFILES) throw new Error("The isolated adult gateway projection is not configured.");
      await this.env.ADULT_PROFILES.delete(key);
      return { key };
    });
    await step.do("record adult withdrawal", async () => {
      const operationId = `adult-profile-withdraw:${profile.profile_id}:${profile.version_id}`;
      await this.env.DB.batch([
        this.env.DB.prepare(`INSERT INTO operation_outbox
          (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,delivered_at,created_at,updated_at)
          VALUES (?,?,?,?,?,'delivered',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(idempotency_key) DO UPDATE SET status='delivered',attempts=operation_outbox.attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(operationId, profile.creator_id, "adult_profile_publish", operationId, JSON.stringify({ profileId: profile.profile_id, versionId: profile.version_id, key, action: "withdraw" })),
        this.env.DB.prepare("UPDATE creator_adult_profile_versions SET status='superseded' WHERE id=? AND profile_id=? AND creator_id=? AND status='published'")
          .bind(profile.version_id, profile.profile_id, profile.creator_id),
        this.env.DB.prepare("UPDATE creator_adult_profiles SET published_version_id=NULL,status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND published_version_id=?")
          .bind(profile.profile_id, profile.creator_id, profile.version_id),
        this.env.DB.prepare(`INSERT INTO creator_adult_profile_publications
          (id,creator_id,profile_id,version_id,status,published_by,adult_snapshot_key,created_at)
          VALUES (?,?,?,?,'rolled_back',?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(profile_id,version_id,status) DO UPDATE SET error=NULL`)
          .bind(`adult-profile-withdrawal:${profile.version_id}`, profile.creator_id, profile.profile_id, profile.version_id, profile.approved_by, key),
      ]);
      return { operationId };
    });
    await step.do("remove safe profile adult action", () => refreshCurrentPublicSnapshot(this.env, profile.creator_id));
    return { withdrawn: true, creatorSlug: profile.slug, versionId: profile.version_id };
  }
}

function parsePublishParams(value: unknown): PublishParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<PublishParams>;
  if (typeof input.creatorId !== "string" || !CREATOR_ID.test(input.creatorId) || typeof input.profileId !== "string" || !RECORD_ID.test(input.profileId) || typeof input.versionId !== "string" || !RECORD_ID.test(input.versionId)) return null;
  return { creatorId: input.creatorId, profileId: input.profileId, versionId: input.versionId };
}

const routes = {
  "/publish": { capability: "public.profile.publish", workflow: "PUBLIC_PROFILE_PUBLISH", prefix: "public-profile" },
  "/withdraw": { capability: "public.profile.withdraw", workflow: "PUBLIC_PROFILE_WITHDRAW", prefix: "public-profile-withdraw" },
  "/adult/publish": { capability: "adult.profile.publish", workflow: "ADULT_PROFILE_PUBLISH", prefix: "adult-profile" },
  "/adult/withdraw": { capability: "adult.profile.withdraw", workflow: "ADULT_PROFILE_WITHDRAW", prefix: "adult-profile-withdraw" },
} as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
    const instanceId = `${route.prefix}-${params.versionId}`;
    try {
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
