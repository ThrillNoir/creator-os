import Link from "next/link";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { localAdultPreviewAvailable } from "@/lib/local-adult-preview";
import { DEFAULT_PROFILE_APPEARANCE, appearanceCss, parseProfileAppearance, type ProfileAppearance, type ProfileButtonStyle } from "@/lib/profile-appearance-contract";

type Profile = { published_version_id: string | null };
type Version = { id: string; display_name: string; headline: string; bio: string; status: string };
type LinkItem = { id: string; label: string };
type AdultVersion = { id: string; status: string };
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
 * the public Worker. It has no contact, adult, media, or live outbound data.
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
    localAdultPreview
      ? DB.prepare("SELECT id,status FROM creator_adult_profile_versions WHERE creator_id=? AND status IN ('draft','approved') ORDER BY version_number DESC").bind(creatorId).all<AdultVersion>()
      : Promise.resolve({ results: [] as AdultVersion[] }),
    DB.prepare("SELECT id,image_role,public_profile_version_id AS profile_version_id FROM creator_profile_image_attachments WHERE creator_id=? AND surface='public_sfw' AND status='attached'").bind(creatorId).all<ImageAttachment>(),
    DB.prepare(`SELECT profile_version_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale
      FROM creator_public_profile_details WHERE creator_id=?`).bind(creatorId).all<AppearanceRow>(),
  ]);
  const draft = versions.results.find((version) => version.status === "draft") ?? null;
  const approved = versions.results.find((version) => version.status === "approved") ?? null;
  const published = profile?.published_version_id ? versions.results.find((version) => version.id === profile.published_version_id) ?? null : null;
  const version = draft ?? approved ?? published;
  const adultDraft = adultVersions.results.find((adult) => adult.status === "draft") ?? null;
  const adultApproved = adultVersions.results.find((adult) => adult.status === "approved") ?? null;
  const adultVersion = adultDraft ?? adultApproved;
  const links = version
    ? await DB.prepare("SELECT id,label FROM creator_public_links WHERE creator_id=? AND profile_version_id=? ORDER BY sort_order ASC")
      .bind(creatorId, version.id).all<LinkItem>()
    : { results: [] as LinkItem[] };
  const images = version ? imageAttachments.results.filter((image) => image.profile_version_id === version.id) : [];
  const avatar = images.find((image) => image.image_role === "avatar");
  const background = images.find((image) => image.image_role === "background");
  const appearance = appearanceFromRow(version ? appearances.results.find((item) => item.profile_version_id === version.id) : undefined);
  const previewCss = appearanceCss(appearance);
  const linkClass = previewButtonClass(appearance.buttonStyle);

  return <main className="public-preview-page">
    <div className="public-preview-toolbar"><Link href="/public-profile">← Back to profile editor</Link><span>PRIVATE LOCAL PREVIEW</span></div>
    <section className="public-preview-surface" style={{ ...previewCss, ...(background ? { backgroundImage: `linear-gradient(#0d0c10ba,#0d0c10ba),url(/api/profile-image/${background.id})` } : {}) } as React.CSSProperties}>
      {version ? <main>
        {avatar && <img className="public-preview-avatar" src={`/api/profile-image/${avatar.id}`} alt="" />}
        <h1>{version.display_name}</h1>
        {version.headline && <p>{version.headline}</p>}
        {version.bio && <p className="bio">{version.bio}</p>}
        {localAdultPreview && adultVersion && <nav className="public-preview-actions" aria-label="Creator actions"><a className="public-preview-action" href={`/public-profile/preview/age/${adultVersion.id}`}>More from {version.display_name}</a></nav>}
        {links.results.length > 0 && <nav className="public-preview-links" aria-label="Approved public links">{links.results.map((link) => <a className={linkClass} href={`/public-profile/preview/go/${version.id}/${link.id}`} key={link.id}>{link.label}<i aria-hidden="true">↗</i></a>)}</nav>}
      </main> : <main><h1>Nothing to preview yet</h1><p className="bio">Save a private draft before opening the public profile preview.</p></main>}
    </section>
  </main>;
}
