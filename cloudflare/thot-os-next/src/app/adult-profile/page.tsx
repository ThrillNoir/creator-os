import { withdrawAdultProfileAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { type ProfileImageAttachment } from "@/components/profile-appearance-editor";
import { CopyProfileLink } from "@/components/copy-profile-link";
import { AdultProfileEditor } from "@/components/adult-profile-editor";
import { AdultWorkspaceTabs } from "@/components/adult-workspace-tabs";
import { DEFAULT_PROFILE_APPEARANCE, parseProfileAppearance, type ProfileAppearance } from "@/lib/profile-appearance-contract";
import { profileImageProcessorAvailable } from "@/lib/profile-image-processing";
import { adultAgeGateUrl } from "@/lib/profile-public-url";

type Version = { id: string; version_number: number; adult_bio: string; status: string; approved_by: string | null; approved_at: string | null; created_at: string };
type Link = { id: string; stable_link_id: string; profile_version_id: string; label: string; destination_url: string; sort_order: number };
type Profile = { id: string; status: string; published_version_id: string | null };
type Publication = { id: string; version_id: string; status: string; adult_snapshot_key: string; created_at: string };
type AppearanceRow = { profile_version_id: string; theme_key: string; button_style: string; background_mode: string; background_color: string; primary_color: string; text_color: string; card_color: string; radius_scale: string; inherit_sfw_theme?: number };
type SafeVersion = { id: string; status: string };
type ImageRow = { id: string; image_role: "avatar" | "background"; profile_version_id: string };
type Creator = { slug: string };

function appearanceFromRow(row: AppearanceRow | undefined): ProfileAppearance {
  if (!row) return DEFAULT_PROFILE_APPEARANCE;
  try {
    return parseProfileAppearance({ themeKey: row.theme_key, buttonStyle: row.button_style, backgroundMode: row.background_mode, backgroundColor: row.background_color, primaryColor: row.primary_color, textColor: row.text_color, cardColor: row.card_color, radiusScale: row.radius_scale, inheritSfwTheme: row.inherit_sfw_theme === 1 }, { adult: true });
  } catch {
    return DEFAULT_PROFILE_APPEARANCE;
  }
}

const notices: Record<string, string> = {
  draft_saved: "Saved. Your 18+ changes are private until you publish them.",
  version_approved: "Saved version is ready to publish.",
  publication_started: "Publishing started. Refresh shortly to see the live status.",
  withdrawal_started: "Unpublishing started. The protected page is being removed.",
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

function stateLabel(value: string) {
  return ({ draft: "Draft", approved: "Saved", published: "Published", paused: "Unpublished", revoked: "Unpublished", superseded: "Superseded", rolled_back: "Unpublished" } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

export default async function AdultProfilePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  const creatorId = context.creator.creator_id;
  const env = cloudflareEnv();
  const DB = env.DB;
  const [creator, profile, versions, links, publications, appearances, safeVersions, safeAppearances, images] = await Promise.all([
    DB.prepare("SELECT slug FROM creators WHERE id=?").bind(creatorId).first<Creator>(),
    DB.prepare("SELECT id,status,published_version_id FROM creator_adult_profiles WHERE creator_id=?").bind(creatorId).first<Profile>(),
    DB.prepare("SELECT id,version_number,adult_bio,status,approved_by,approved_at,created_at FROM creator_adult_profile_versions WHERE creator_id=? ORDER BY version_number DESC").bind(creatorId).all<Version>(),
    DB.prepare("SELECT id,link_id AS stable_link_id,profile_version_id,label,destination_url,sort_order FROM creator_adult_link_revisions WHERE creator_id=? AND enabled=1 ORDER BY profile_version_id,sort_order").bind(creatorId).all<Link>(),
    DB.prepare("SELECT id,version_id,status,adult_snapshot_key,created_at FROM creator_adult_profile_publications WHERE creator_id=? ORDER BY created_at DESC LIMIT 12").bind(creatorId).all<Publication>(),
    DB.prepare("SELECT profile_version_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale,inherit_sfw_theme FROM creator_adult_profile_appearances WHERE creator_id=?").bind(creatorId).all<AppearanceRow>(),
    DB.prepare("SELECT id,status FROM creator_public_profile_versions WHERE creator_id=? ORDER BY version_number DESC").bind(creatorId).all<SafeVersion>(),
    DB.prepare("SELECT profile_version_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale FROM creator_public_profile_details WHERE creator_id=?").bind(creatorId).all<AppearanceRow>(),
    DB.prepare("SELECT id,image_role,adult_profile_version_id AS profile_version_id FROM creator_profile_image_attachments WHERE creator_id=? AND surface='adult_profile' AND status='attached'").bind(creatorId).all<ImageRow>(),
  ]);
  const canEdit = roleCan(context.creator.role, "mutate");
  const canPublish = canEdit;
  const draft = versions.results.find((version) => version.status === "draft") ?? null;
  const approved = versions.results.find((version) => version.status === "approved") ?? null;
  const published = profile?.published_version_id ? versions.results.find((version) => version.id === profile.published_version_id) ?? null : null;
  const versionForPublish = draft ?? approved;
  const publishingConfigured = String(env.ADULT_PROFILE_PUBLISHING_ENABLED) === "1" && typeof env.INTERNAL_PUBLIC_LINKS_CONTROL_TOKEN === "string" && env.INTERNAL_PUBLIC_LINKS_CONTROL_TOKEN.length >= 40;
  const authoring = draft ?? approved ?? published;
  const authoringLinks = authoring ? links.results.filter((link) => link.profile_version_id === authoring.id) : [];
  const slots = Array.from({ length: Math.max(4, Math.min(12, authoringLinks.length + 1)) }, (_, index) => authoringLinks[index] ?? null);
  const notice = query.notice ? notices[query.notice] : null;
  const authoringAppearance = appearanceFromRow(authoring ? appearances.results.find((appearance) => appearance.profile_version_id === authoring.id) : undefined);
  const safeVersion = safeVersions.results.find((version) => version.status === "draft") ?? safeVersions.results.find((version) => version.status === "approved") ?? safeVersions.results.find((version) => version.status === "published") ?? null;
  const safeAppearance = safeVersion ? appearanceFromRow(safeAppearances.results.find((appearance) => appearance.profile_version_id === safeVersion.id)) : null;
  const authoringImages: ProfileImageAttachment[] = authoring ? images.results.filter((image) => image.profile_version_id === authoring.id).map((image) => ({ id: image.id, role: image.image_role, previewUrl: `/api/profile-image/${image.id}` })) : [];
  const ageGateUrl = published ? adultAgeGateUrl(env.ADULT_GATEWAY_BASE_URL, creator?.slug ?? "") : null;

  return <AppShell active="18+ profile"><PageHeader title="18+ profile" subtitle="Design, preview and publish this creator’s age-gated profile." eyebrow="ADULT-GATED CONTENT" />
    {String((env as { PORTFOLIO_AUTHORING_ENABLED?: string }).PORTFOLIO_AUTHORING_ENABLED) === "1" && <AdultWorkspaceTabs current="profile" />}
    {notice && <div className="success">{notice}</div>}
    <section className="panel connection-setup"><div className="section-heading"><div><span className="eyebrow">PROTECTED PROFILE</span><h2>18+ profile and links</h2><p>Content and destinations stay out of the safe public page. The live profile remains behind the separate age gate.</p></div><span>{published ? "Published" : draft ? `Draft v${draft.version_number}` : approved ? `Saved v${approved.version_number}` : profile?.status === "paused" ? "Unpublished" : "No profile"}</span></div>
      {ageGateUrl && <CopyProfileLink title="Your 18+ gate link" detail="Share this only where an age-gated creator link is appropriate." url={ageGateUrl} />}
      {canEdit ? <AdultProfileEditor bio={authoring?.adult_bio ?? ""} links={slots.map((link, index) => ({ id: link?.id ?? `new-${index}`, label: link?.label ?? "", destination: link?.destination_url ?? "", stableId: link?.stable_link_id ?? "" }))}
        appearance={authoringAppearance} inheritedAppearance={safeAppearance} displayName={context.creator.creator_name} images={authoringImages} draftVersionId={draft?.id} versionForPublishId={versionForPublish?.id} published={Boolean(published)} canPublish={canPublish} publishingConfigured={publishingConfigured} imageUploadsEnabled={profileImageProcessorAvailable(env)} />
        : <div className="empty"><b>Read-only adult-profile view</b><span>Your role can inspect this creator’s private version history but cannot change protected content or destinations.</span></div>}
      {published && canPublish && <div className="profile-action-bar wide"><form action={withdrawAdultProfileAction}><input type="hidden" name="adultVersionId" value={published.id} /><button className="profile-unpublish" type="submit">Unpublish</button></form></div>}
    </section>

    <details className="panel profile-history-panel"><summary>History ({versions.results.length} version{versions.results.length === 1 ? "" : "s"})</summary>
      {versions.results.length ? <div className="public-profile-history">{versions.results.map((version) => <article key={version.id}><span className="post-state">v{version.version_number}</span><div><strong>{stateLabel(version.status)}</strong><small>created {formatDate(version.created_at)}{version.approved_at ? ` · published by selection ${formatDate(version.approved_at)}` : ""}</small></div><span>{version.approved_by ?? "Saved privately"}</span></article>)}</div> : <div className="empty"><b>No adult-profile versions</b><span>Creating a private draft does not put anything on a public hostname.</span></div>}
      {publications.results.length ? <div className="public-profile-history public-publications">{publications.results.map((publication) => <article key={publication.id}><span className="post-state">{stateLabel(publication.status)}</span><div><strong>Protected release receipt</strong><small>{publication.adult_snapshot_key} · {formatDate(publication.created_at)}</small></div><span>{publication.version_id}</span></article>)}</div> : null}
    </details>
  </AppShell>;
}
