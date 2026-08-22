import { approveAdultProfileVersionAction, publishAdultProfileAction, saveAdultProfileDraftAction, withdrawAdultProfileAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { ProfileAppearanceEditor, type ProfileImageAttachment } from "@/components/profile-appearance-editor";
import { DEFAULT_PROFILE_APPEARANCE, parseProfileAppearance, type ProfileAppearance } from "@/lib/profile-appearance-contract";
import { profileImageProcessorAvailable } from "@/lib/profile-image-processing";

type Version = { id: string; version_number: number; adult_bio: string; status: string; approved_by: string | null; approved_at: string | null; created_at: string };
type Link = { id: string; stable_link_id: string; profile_version_id: string; label: string; destination_url: string; sort_order: number };
type Media = { id: string; profile_version_id: string; asset_id: string; alt_text: string; sort_order: number; status: string };
type Profile = { id: string; status: string; published_version_id: string | null };
type Publication = { id: string; version_id: string; status: string; adult_snapshot_key: string; created_at: string };
type AppearanceRow = { profile_version_id: string; theme_key: string; button_style: string; background_mode: string; background_color: string; primary_color: string; text_color: string; card_color: string; radius_scale: string; inherit_sfw_theme?: number };
type SafeVersion = { id: string; status: string };
type ImageRow = { id: string; image_role: "avatar" | "background"; profile_version_id: string };

function appearanceFromRow(row: AppearanceRow | undefined): ProfileAppearance {
  if (!row) return DEFAULT_PROFILE_APPEARANCE;
  try {
    return parseProfileAppearance({ themeKey: row.theme_key, buttonStyle: row.button_style, backgroundMode: row.background_mode, backgroundColor: row.background_color, primaryColor: row.primary_color, textColor: row.text_color, cardColor: row.card_color, radiusScale: row.radius_scale, inheritSfwTheme: row.inherit_sfw_theme === 1 }, { adult: true });
  } catch {
    return DEFAULT_PROFILE_APPEARANCE;
  }
}

const notices: Record<string, string> = {
  draft_saved: "Adult-profile draft saved privately. It is not available on any public hostname.",
  version_approved: "Adult-profile version approved. It remains private until its separate gateway projection is configured and published.",
  publication_started: "Adult release was accepted for durable processing. The protected gateway projection is written before the private record is marked published.",
  withdrawal_started: "Adult withdrawal was accepted for durable processing. The protected gateway projection is removed before the private record is marked paused.",
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

function stateLabel(value: string) {
  return ({ draft: "Draft", approved: "Approved, private", published: "Published", paused: "Withdrawn/paused", revoked: "Withdrawn", superseded: "Superseded", rolled_back: "Withdrawn" } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

export default async function AdultProfilePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  const creatorId = context.creator.creator_id;
  const env = cloudflareEnv();
  const DB = env.DB;
  const [profile, versions, links, media, publications, appearances, safeVersions, safeAppearances, images] = await Promise.all([
    DB.prepare("SELECT id,status,published_version_id FROM creator_adult_profiles WHERE creator_id=?").bind(creatorId).first<Profile>(),
    DB.prepare("SELECT id,version_number,adult_bio,status,approved_by,approved_at,created_at FROM creator_adult_profile_versions WHERE creator_id=? ORDER BY version_number DESC").bind(creatorId).all<Version>(),
    DB.prepare("SELECT id,link_id AS stable_link_id,profile_version_id,label,destination_url,sort_order FROM creator_adult_link_revisions WHERE creator_id=? AND enabled=1 ORDER BY profile_version_id,sort_order").bind(creatorId).all<Link>(),
    DB.prepare(`SELECT m.id,m.profile_version_id,m.asset_id,m.alt_text,m.sort_order,r.status
      FROM creator_adult_profile_media m
      JOIN creator_media_release_attestations r ON r.creator_id=m.creator_id AND r.asset_id=m.asset_id AND r.surface='adult_profile'
      WHERE m.creator_id=? AND m.enabled=1 ORDER BY m.profile_version_id,m.sort_order`).bind(creatorId).all<Media>(),
    DB.prepare("SELECT id,version_id,status,adult_snapshot_key,created_at FROM creator_adult_profile_publications WHERE creator_id=? ORDER BY created_at DESC LIMIT 12").bind(creatorId).all<Publication>(),
    DB.prepare("SELECT profile_version_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale,inherit_sfw_theme FROM creator_adult_profile_appearances WHERE creator_id=?").bind(creatorId).all<AppearanceRow>(),
    DB.prepare("SELECT id,status FROM creator_public_profile_versions WHERE creator_id=? ORDER BY version_number DESC").bind(creatorId).all<SafeVersion>(),
    DB.prepare("SELECT profile_version_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale FROM creator_public_profile_details WHERE creator_id=?").bind(creatorId).all<AppearanceRow>(),
    DB.prepare("SELECT id,image_role,adult_profile_version_id AS profile_version_id FROM creator_profile_image_attachments WHERE creator_id=? AND surface='adult_profile' AND status='attached'").bind(creatorId).all<ImageRow>(),
  ]);
  const canEdit = roleCan(context.creator.role, "mutate");
  const canApprove = roleCan(context.creator.role, "approve") && context.creator.role !== "creator";
  const draft = versions.results.find((version) => version.status === "draft") ?? null;
  const approved = versions.results.find((version) => version.status === "approved") ?? null;
  const published = profile?.published_version_id ? versions.results.find((version) => version.id === profile.published_version_id) ?? null : null;
  const publishingConfigured = typeof env.INTERNAL_PUBLIC_LINKS_CONTROL_TOKEN === "string" && env.INTERNAL_PUBLIC_LINKS_CONTROL_TOKEN.length >= 40;
  const authoring = draft ?? approved;
  const authoringLinks = authoring ? links.results.filter((link) => link.profile_version_id === authoring.id) : [];
  const authoringMedia = authoring ? media.results.filter((item) => item.profile_version_id === authoring.id) : [];
  const slots = Array.from({ length: Math.max(4, Math.min(12, authoringLinks.length + 1)) }, (_, index) => authoringLinks[index] ?? null);
  const notice = query.notice ? notices[query.notice] : null;
  const authoringAppearance = appearanceFromRow(authoring ? appearances.results.find((appearance) => appearance.profile_version_id === authoring.id) : undefined);
  const safeVersion = safeVersions.results.find((version) => version.status === "draft") ?? safeVersions.results.find((version) => version.status === "approved") ?? null;
  const safeAppearance = safeVersion ? appearanceFromRow(safeAppearances.results.find((appearance) => appearance.profile_version_id === safeVersion.id)) : null;
  const authoringImages: ProfileImageAttachment[] = authoring ? images.results.filter((image) => image.profile_version_id === authoring.id).map((image) => ({ id: image.id, role: image.image_role, previewUrl: `/api/profile-image/${image.id}` })) : [];

  return <AppShell active="18+ profile"><PageHeader title="18+ profile" subtitle="Private authoring for a separately age-gated surface. Nothing here is included in the safe public profile, its markup, redirects, metadata, or public KV projection." eyebrow="ADULT-GATED CONTENT" />
    {notice && <div className="success">{notice}</div>}
    <section className="panel connection-setup"><div className="section-heading"><div><span className="eyebrow">PRIVATE DRAFT</span><h2>Adult profile and links</h2><p>These destinations use stable link identities and are validated as credential-free HTTPS URLs. A draft cannot become public without separate approval and a deliberately configured age-gated publication flow.</p></div><span>{published ? "Published" : draft ? `Draft v${draft.version_number}` : approved ? `Approved, private v${approved.version_number}` : profile?.status === "paused" ? "Withdrawn/paused" : "No draft"}</span></div>
      {canEdit ? <form action={saveAdultProfileDraftAction} className="inline-form public-profile-form">
        <label className="wide">Adult bio <small>(optional)</small><textarea name="adultBio" maxLength={2000} defaultValue={authoring?.adult_bio ?? ""} /></label>
        <div className="section-divider wide"><b>Creator links</b><span>Use generic labels and final HTTPS destinations. Fansly, OnlyFans, and future platforms are values, not schema fields.</span></div>
        {slots.map((link, index) => <div className="public-link-fields" key={link?.id ?? `new-${index}`}><input type="hidden" name="adultLinkStableId" value={link?.stable_link_id ?? ""} /><label>Label<input name="adultLinkLabel" maxLength={80} defaultValue={link?.label ?? ""} placeholder="Creator page" /></label><label>HTTPS destination<input name="adultLinkDestination" type="url" defaultValue={link?.destination_url ?? ""} placeholder="https://example.com" /></label></div>)}
        <ProfileAppearanceEditor surface="adult" initialAppearance={authoringAppearance} inheritedAppearance={safeAppearance} displayName="Creator" sampleLinks={authoringLinks.map((link) => link.label)} versionId={draft?.id} initialImages={authoringImages} imageUploadsEnabled={profileImageProcessorAvailable()} />
        <button className="primary" type="submit">Save private adult draft</button>
      </form> : <div className="empty"><b>Read-only adult-profile view</b><span>Your role can inspect this creator’s private version history but cannot change protected content or destinations.</span></div>}
    </section>

    <div className="two-column public-profile-actions"><section className="panel"><div className="section-heading"><div><span className="eyebrow">MEDIA RELEASES</span><h2>Approved carousel media</h2><p>Only an explicit approved release may be attached to this version. Source Dropbox media and ordinary private previews are not eligible for public delivery.</p></div><span>{authoringMedia.length} attached</span></div>
      {authoringMedia.length ? <div className="public-profile-history">{authoringMedia.map((item) => <article key={item.id}><span className="post-state">{item.status}</span><div><strong>Approved derivative</strong><small>Asset {item.asset_id} · position {item.sort_order + 1}{item.alt_text ? ` · ${item.alt_text}` : ""}</small></div></article>)}</div> : <div className="empty"><b>No carousel media attached</b><span>Derivative creation and release approval are intentionally separate from source-media selection. An unreleased asset cannot be attached here.</span></div>}
    </section><section className="panel"><div className="section-heading"><div><span className="eyebrow">SEPARATE APPROVAL</span><h2>Approve protected draft</h2><p>A creator may author a draft, but a separate operator or agency administrator must approve it.</p></div><span>{draft ? `Version ${draft.version_number}` : "No draft"}</span></div>
      {draft && canApprove ? <form action={approveAdultProfileVersionAction} className="confirmed-action"><input type="hidden" name="adultVersionId" value={draft.id} /><label>Approval note <small>(optional)</small><input name="approvalNote" maxLength={500} placeholder="Recorded with this immutable approval" /></label><button className="secondary-action" type="submit">Approve version {draft.version_number}</button></form> : <div className="empty"><b>{draft ? "Separate approval required" : "No draft awaiting approval"}</b><span>{draft ? "A separate operator or agency administrator must make this explicit decision." : "Save a private draft before approval can be recorded."}</span></div>}
    </section></div>

    <section className="panel"><div className="section-heading"><div><span className="eyebrow">PUBLICATION GATE</span><h2>Gateway release</h2><p>The durable release workflow writes the isolated adult gateway projection before marking a version published, and deletes that projection before recording withdrawal. This local environment intentionally has no gateway or contact service configuration.</p></div><span>{published ? `Live version ${published.version_number}` : approved ? `Ready version ${approved.version_number}` : "Private"}</span></div>
      {approved && canApprove && (publishingConfigured ? <form action={publishAdultProfileAction} className="confirmed-action"><input type="hidden" name="adultVersionId" value={approved.id} /><label><input type="checkbox" name="publishConfirmed" value="yes" required /> I approve projecting this exact approved version to the separately configured age-gated gateway.</label><button className="primary" type="submit">Publish protected version {approved.version_number}</button></form> : <div className="empty"><b>Protected gateway publishing isn&apos;t configured here</b><span>You can save and approve adult drafts locally. Hostnames, KV/R2 bindings, Turnstile, service grants, and legal/policy approval are required before a remote release can be activated.</span></div>)}
      {published && canApprove && <form action={withdrawAdultProfileAction} className="confirmed-action public-withdraw"><input type="hidden" name="adultVersionId" value={published.id} /><label><input type="checkbox" name="withdrawConfirmed" value="yes" required /> I approve withdrawing this protected profile now.</label><button className="secondary-action" type="submit">Withdraw protected profile</button></form>}
      {!approved && !published && <div className="empty"><b>Release is unavailable</b><span>Approve a private draft before the protected projection workflow can receive it.</span></div>}
    </section>

    <section className="panel"><div className="section-heading"><div><span className="eyebrow">IMMUTABLE HISTORY</span><h2>Adult-profile versions</h2></div><span>{versions.results.length} version{versions.results.length === 1 ? "" : "s"}</span></div>
      {versions.results.length ? <div className="public-profile-history">{versions.results.map((version) => <article key={version.id}><span className="post-state">v{version.version_number}</span><div><strong>{stateLabel(version.status)}</strong><small>created {formatDate(version.created_at)}{version.approved_at ? ` · approved ${formatDate(version.approved_at)}` : ""}</small></div><span>{version.approved_by ?? "Awaiting separate approval"}</span></article>)}</div> : <div className="empty"><b>No adult-profile versions</b><span>Creating a private draft does not put anything on a public hostname.</span></div>}
      {publications.results.length ? <div className="public-profile-history public-publications">{publications.results.map((publication) => <article key={publication.id}><span className="post-state">{stateLabel(publication.status)}</span><div><strong>Protected release receipt</strong><small>{publication.adult_snapshot_key} · {formatDate(publication.created_at)}</small></div><span>{publication.version_id}</span></article>)}</div> : null}
    </section>
  </AppShell>;
}
