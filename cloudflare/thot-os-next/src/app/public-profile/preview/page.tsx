import Link from "next/link";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { localAdultPreviewAvailable } from "@/lib/local-adult-preview";
import { DEFAULT_PROFILE_APPEARANCE, appearanceCss, parseProfileAppearance, type ProfileAppearance, type ProfileButtonStyle } from "@/lib/profile-appearance-contract";
import { localPreviewAdultVersion, previewAdultVersion, profilePreviewActions } from "@/lib/public-profile-preview-actions";

type Profile = { published_version_id: string | null };
type Version = { id: string; display_name: string; headline: string; bio: string; status: string };
type LinkItem = { id: string; label: string };
type AdultVersion = { id: string; creator_id: string; status: string };
type BookingConfigRow = { config_json: string };
type ContactChannel = { channel: "sms" | "email" };
type ImageAttachment = { id: string; image_role: "avatar" | "background"; profile_version_id: string };
type AppearanceRow = { profile_version_id: string; theme_key: string; button_style: string; background_mode: string; background_color: string; primary_color: string; text_color: string; card_color: string; radius_scale: string };

function appearanceFromRow(row: AppearanceRow | undefined): ProfileAppearance {
  if (!row) return DEFAULT_PROFILE_APPEARANCE;
  try {
    return parseProfileAppearance({ themeKey: row.theme_key, buttonStyle: row.button_style, backgroundMode: row.background_mode, backgroundColor: row.background_color, primaryColor: row.primary_color, textColor: row.text_color, cardColor: row.card_color, radiusScale: row.radius_scale });
  } catch {
    return DEFAULT_PROFILE_APPEARANCE;
  }
}

function previewButtonClass(style: ProfileButtonStyle) {
  if (style === "full-pill") return "public-preview-link public-preview-pill";
  if (style === "minimal-outline") return "public-preview-link public-preview-outline";
  if (style === "soft-card-icon") return "public-preview-link public-preview-soft";
  if (style === "elevated-shadow-tile") return "public-preview-link public-preview-elevated";
  return "public-preview-link";
}

/**
 * An authenticated visual check of the same safe text/link fields rendered by
 * the public Worker. It uses creator-scoped preview data and no live outbound data.
 */
export default async function PublicProfilePreviewPage() {
  const context = await requireCreatorContext();
  const creatorId = context.creator.creator_id;
  const DB = cloudflareEnv().DB;
  const localAdultPreview = localAdultPreviewAvailable();
  const [profile, versions, adultVersions, imageAttachments, appearances] = await Promise.all([
    DB.prepare("SELECT published_version_id FROM creator_public_profiles WHERE creator_id=?").bind(creatorId).first<Profile>(),
    DB.prepare(`SELECT id,display_name,headline,bio,status
      FROM creator_public_profile_versions WHERE creator_id=? ORDER BY version_number DESC`).bind(creatorId).all<Version>(),
    DB.prepare(`SELECT v.id,v.creator_id,v.status FROM creator_adult_profiles p
      JOIN creator_adult_profile_versions v ON v.profile_id=p.id AND v.creator_id=p.creator_id
      WHERE p.creator_id=? AND v.status IN ('draft','approved','published')
      ORDER BY v.version_number DESC`).bind(creatorId).all<AdultVersion>(),
    DB.prepare("SELECT id,image_role,public_profile_version_id AS profile_version_id FROM creator_profile_image_attachments WHERE creator_id=? AND surface='public_sfw' AND status='attached'").bind(creatorId).all<ImageAttachment>(),
    DB.prepare(`SELECT profile_version_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale
      FROM creator_public_profile_details WHERE creator_id=?`).bind(creatorId).all<AppearanceRow>(),
  ]);
  const draft = versions.results.find((version) => version.status === "draft") ?? null;
  const approved = versions.results.find((version) => version.status === "approved") ?? null;
  const published = profile?.published_version_id ? versions.results.find((version) => version.id === profile.published_version_id) ?? null : null;
  const version = draft ?? approved ?? published;
  const adultVersion = previewAdultVersion(adultVersions.results.map((adult) => ({ id: adult.id, creatorId: adult.creator_id, status: adult.status })), creatorId);
  const localAdultVersion = localPreviewAdultVersion(adultVersions.results.map((adult) => ({ id: adult.id, creatorId: adult.creator_id, status: adult.status })), creatorId);
  const [links, bookingConfig, bookingContacts] = version
    ? await Promise.all([
      DB.prepare("SELECT id,label FROM creator_public_links WHERE creator_id=? AND profile_version_id=? ORDER BY sort_order ASC").bind(creatorId, version.id).all<LinkItem>(),
      DB.prepare("SELECT config_json FROM creator_booking_configs WHERE creator_id=? AND profile_version_id=?").bind(creatorId, version.id).first<BookingConfigRow>(),
      DB.prepare("SELECT channel FROM creator_public_contact_methods WHERE creator_id=? AND profile_version_id=? AND enabled=1").bind(creatorId, version.id).all<ContactChannel>(),
    ])
    : [{ results: [] as LinkItem[] }, null, { results: [] as ContactChannel[] }] as const;
  const images = version ? imageAttachments.results.filter((image) => image.profile_version_id === version.id) : [];
  const avatar = images.find((image) => image.image_role === "avatar");
  const background = images.find((image) => image.image_role === "background");
  const appearance = appearanceFromRow(version ? appearances.results.find((item) => item.profile_version_id === version.id) : undefined);
  const previewCss = appearanceCss(appearance);
  const linkClass = previewButtonClass(appearance.buttonStyle);
  const previewActions = profilePreviewActions({ bookingConfig: bookingConfig?.config_json, hasBookingPhone: bookingContacts.results.some((contact) => contact.channel === "sms"), hasBookingEmail: bookingContacts.results.some((contact) => contact.channel === "email"), hasAdultProfile: Boolean(adultVersion), displayName: version?.display_name ?? "" });

  return <main className="public-preview-page">
    <div className="public-preview-toolbar"><Link href="/public-profile">← Back to profile editor</Link><span>PRIVATE LOCAL PREVIEW</span></div>
    <section className="public-preview-surface" style={{ ...previewCss, ...(background ? { backgroundImage: `linear-gradient(#0d0c10ba,#0d0c10ba),url(/api/profile-image/${background.id})` } : {}) } as React.CSSProperties}>
      {version ? <main>
        {avatar && <img className="public-preview-avatar" src={`/api/profile-image/${avatar.id}`} alt="" />}
        <h1>{version.display_name}</h1>
        {version.headline && <p>{version.headline}</p>}
        {version.bio && <p className="bio">{version.bio}</p>}
        <p className="public-preview-note">Saved drafts stay private. Only a published version can appear on the public page.</p>
        {previewActions.length > 0 && <nav className="public-preview-actions" aria-label="Preview-only creator actions">{previewActions.map((action) => action.kind === "more" && localAdultPreview && localAdultVersion
          ? <a className="public-preview-action" href={`/public-profile/preview/age/${localAdultVersion.id}`} key={action.kind}>{action.label}</a>
          : <span className="public-preview-action public-preview-action-disabled" aria-disabled="true" key={action.kind}>{action.label}</span>)}</nav>}
        {links.results.length > 0 && <nav className="public-preview-links" aria-label="Approved public links">{links.results.map((link) => <a className={linkClass} href={`/public-profile/preview/go/${version.id}/${link.id}`} key={link.id}>{link.label}<i aria-hidden="true">↗</i></a>)}</nav>}
      </main> : <main><h1>Nothing to preview yet</h1><p className="bio">Save a private draft before opening the public profile preview.</p></main>}
    </section>
  </main>;
}
