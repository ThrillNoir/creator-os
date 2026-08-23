import { publishPublicProfileAction, savePublicProfileDraftAction, withdrawPublicProfileAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { ProfileAppearanceEditor, type ProfileImageAttachment } from "@/components/profile-appearance-editor";
import Link from "next/link";
import { DEFAULT_PROFILE_APPEARANCE, parseProfileAppearance, type ProfileAppearance } from "@/lib/profile-appearance-contract";
import { profileImageProcessorAvailable } from "@/lib/profile-image-processing";

type Profile = { id: string; slug: string; status: string; published_version_id: string | null };
type Version = { id: string; version_number: number; display_name: string; headline: string; bio: string; status: string; approved_by: string | null; approved_at: string | null; created_at: string };
type Link = { id: string; profile_version_id: string; label: string; destination_url: string; sort_order: number; stable_link_id: string | null };
type Contact = { profile_version_id: string; channel: "sms" | "email"; contact_value: string };
type Publication = { id: string; version_id: string; status: string; public_snapshot_key: string; created_at: string };
type AppearanceRow = { profile_version_id: string; theme_key: string; button_style: string; background_mode: string; background_color: string; primary_color: string; text_color: string; card_color: string; radius_scale: string };
type ImageRow = { id: string; image_role: "avatar" | "background"; profile_version_id: string };

function appearanceFromRow(row: AppearanceRow | undefined): ProfileAppearance {
  if (!row) return DEFAULT_PROFILE_APPEARANCE;
  try {
    return parseProfileAppearance({ themeKey: row.theme_key, buttonStyle: row.button_style, backgroundMode: row.background_mode, backgroundColor: row.background_color, primaryColor: row.primary_color, textColor: row.text_color, cardColor: row.card_color, radiusScale: row.radius_scale });
  } catch {
    return DEFAULT_PROFILE_APPEARANCE;
  }
}

const notices: Record<string, string> = {
  draft_saved: "Saved. Your changes are private until you publish them.",
  version_approved: "Saved version is ready to publish.",
  publication_started: "Publishing started. Refresh shortly to see the live status.",
  withdrawal_started: "Unpublishing started. The public page is being removed.",
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

function stateLabel(value: string) {
  return ({ draft: "Draft", approved: "Saved", published: "Published", paused: "Unpublished", revoked: "Unpublished", superseded: "Superseded" } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

export default async function PublicProfilePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  const creatorId = context.creator.creator_id;
  const env = cloudflareEnv();
  const DB = env.DB;
  const publishingConfigured = typeof env.INTERNAL_PUBLIC_LINKS_CONTROL_TOKEN === "string" && env.INTERNAL_PUBLIC_LINKS_CONTROL_TOKEN.length >= 40;
  const [creator, profile, versions, links, contacts, publications, appearances, images] = await Promise.all([
    DB.prepare("SELECT slug FROM creators WHERE id=?").bind(creatorId).first<{ slug: string }>(),
    DB.prepare("SELECT id,slug,status,published_version_id FROM creator_public_profiles WHERE creator_id=?").bind(creatorId).first<Profile>(),
    DB.prepare(`SELECT id,version_number,display_name,headline,bio,status,approved_by,approved_at,created_at
      FROM creator_public_profile_versions WHERE creator_id=? ORDER BY version_number DESC`).bind(creatorId).all<Version>(),
    DB.prepare(`SELECT l.id,l.profile_version_id,l.label,l.destination_url,l.sort_order,r.link_id AS stable_link_id
      FROM creator_public_links l
      LEFT JOIN creator_public_link_revisions r ON r.creator_id=l.creator_id AND r.profile_version_id=l.profile_version_id AND r.sort_order=l.sort_order
      WHERE l.creator_id=? ORDER BY l.profile_version_id,l.sort_order`).bind(creatorId).all<Link>(),
    DB.prepare("SELECT profile_version_id,channel,contact_value FROM creator_public_contact_methods WHERE creator_id=? AND enabled=1").bind(creatorId).all<Contact>(),
    DB.prepare(`SELECT id,version_id,status,public_snapshot_key,created_at
      FROM creator_public_profile_publications WHERE creator_id=? ORDER BY created_at DESC LIMIT 12`).bind(creatorId).all<Publication>(),
    DB.prepare(`SELECT profile_version_id,theme_key,button_style,background_mode,background_color,primary_color,text_color,card_color,radius_scale
      FROM creator_public_profile_details WHERE creator_id=?`).bind(creatorId).all<AppearanceRow>(),
    DB.prepare(`SELECT id,image_role,public_profile_version_id AS profile_version_id FROM creator_profile_image_attachments
      WHERE creator_id=? AND surface='public_sfw' AND status='attached'`).bind(creatorId).all<ImageRow>(),
  ]);
  const canEdit = roleCan(context.creator.role, "mutate");
  const canApprove = roleCan(context.creator.role, "approve") && context.creator.role !== "creator";
  const draft = versions.results.find((version) => version.status === "draft") ?? null;
  const published = profile?.published_version_id ? versions.results.find((version) => version.id === profile.published_version_id) ?? null : null;
  const approved = versions.results.find((version) => version.status === "approved") ?? null;
  const versionForPublish = draft ?? approved;
  // An approved version remains the editing baseline until it is published or replaced by a draft.
  // Without this, an approval that has not yet been published appears blank and its links can be lost.
  const authoring = draft ?? approved ?? published;
  const authoringLinks = authoring ? links.results.filter((link) => link.profile_version_id === authoring.id) : [];
  const authoringContacts = authoring ? contacts.results.filter((contact) => contact.profile_version_id === authoring.id) : [];
  const phone = authoringContacts.find((contact) => contact.channel === "sms")?.contact_value ?? "";
  const email = authoringContacts.find((contact) => contact.channel === "email")?.contact_value ?? "";
  const slots = Array.from({ length: Math.max(4, Math.min(8, authoringLinks.length + 1)) }, (_, index) => authoringLinks[index] ?? null);
  const notice = query.notice ? notices[query.notice] : null;
  const defaultSlug = profile?.slug ?? creator?.slug ?? "creator";
  const authoringAppearance = appearanceFromRow(authoring ? appearances.results.find((appearance) => appearance.profile_version_id === authoring.id) : undefined);
  const authoringImages: ProfileImageAttachment[] = authoring ? images.results.filter((image) => image.profile_version_id === authoring.id).map((image) => ({ id: image.id, role: image.image_role, previewUrl: `/api/profile-image/${image.id}` })) : [];

  return <AppShell active="Public profile"><PageHeader title="Public profile" subtitle="Build, preview and publish this creator’s public link page." eyebrow="PUBLIC LINKS" />
    {notice && <div className="success">{notice}</div>}
    {authoring && <Link className="preview-link" href="/public-profile/preview">Open private local preview</Link>}
    <section className="panel connection-setup"><div className="section-heading"><div><span className="eyebrow">ISOLATED PUBLIC SURFACE</span><h2>Creator link page</h2><p>Save changes privately, preview the page, then publish when it is ready.</p></div><span>{profile?.published_version_id ? "Published" : draft ? "Draft" : approved ? "Saved" : profile?.status === "paused" ? "Unpublished" : "No profile"}</span></div>
      {canEdit ? <form action={savePublicProfileDraftAction} className="inline-form public-profile-form" id="public-profile-editor">
        <label>Public URL slug<input name="slug" required maxLength={80} defaultValue={defaultSlug} disabled={Boolean(profile?.published_version_id)} autoComplete="off" /><small>{profile?.published_version_id ? "Published public URL slugs are stable. Withdraw the current profile before changing its URL." : "Lowercase letters, numbers and single hyphens only."}</small></label>
        <label>Display name <small>(optional)</small><input name="displayName" maxLength={120} defaultValue={authoring?.display_name ?? context.creator.creator_name} /></label>
        <label className="wide">Headline<input name="headline" maxLength={280} defaultValue={authoring?.headline ?? ""} /></label>
        <label className="wide">Bio<textarea name="bio" maxLength={2000} defaultValue={authoring?.bio ?? ""} /></label>
        <div className="section-divider wide"><b>Booking contact</b><span>These values are stored only for the isolated booking flow. They are never included in the safe public-profile page or its public snapshot.</span></div>
        <label>Phone <small>(optional)</small><input name="bookingPhone" type="tel" inputMode="tel" maxLength={20} defaultValue={phone} placeholder="+61400000000" autoComplete="tel" /></label>
        <label>Email <small>(optional)</small><input name="bookingEmail" type="email" maxLength={254} defaultValue={email} placeholder="bookings@example.com" autoComplete="email" /></label>
        <div className="section-divider wide"><b>Links</b><span>Add social or other public destinations. Blank rows are not shown, and only approved HTTPS links can be published.</span></div>
        {slots.map((link, index) => <div className="public-link-fields" key={link?.id ?? `new-${index}`}><input type="hidden" name="linkStableId" value={link?.stable_link_id ?? ""} /><label>Label<input name="linkLabel" maxLength={80} defaultValue={link?.label ?? ""} placeholder="Official site" /></label><label>HTTPS destination<input name="linkDestination" type="url" defaultValue={link?.destination_url ?? ""} placeholder="https://example.com" /></label></div>)}
        <ProfileAppearanceEditor surface="sfw" initialAppearance={authoringAppearance} displayName={authoring?.display_name ?? context.creator.creator_name} sampleLinks={authoringLinks.map((link) => link.label)} versionId={draft?.id} initialImages={authoringImages} imageUploadsEnabled={profileImageProcessorAvailable(env)} />
      </form> : <div className="empty"><b>Read-only public profile view</b><span>Your role can inspect profile history but cannot alter text, destinations, approvals, or publication.</span></div>}
      {canEdit && <div className="profile-action-bar wide" aria-label="Profile actions">
        <div><b>{published ? draft ? "Unpublished changes" : "Live" : versionForPublish ? "Saved privately" : "Not saved yet"}</b><span>{published && !draft ? "Your public profile is live." : "Save your changes, then publish when ready."}</span></div>
        <div className="profile-action-buttons">
          <button className="secondary-action" type="submit" form="public-profile-editor">Save</button>
          {canApprove && versionForPublish && <form action={publishPublicProfileAction}><input type="hidden" name="versionId" value={versionForPublish.id} /><button className="primary" type="submit" disabled={!publishingConfigured}>Publish</button></form>}
          {published && canApprove && <form action={withdrawPublicProfileAction}><input type="hidden" name="versionId" value={published.id} /><button className="profile-unpublish" type="submit">Unpublish</button></form>}
        </div>
        {!publishingConfigured && canApprove && <small>Publishing will become available when the staging release service is configured.</small>}
        {!canApprove && <small>Save changes here. An agency administrator can publish them.</small>}
      </div>}
    </section>

    <details className="panel profile-history-panel"><summary>History ({versions.results.length} version{versions.results.length === 1 ? "" : "s"})</summary>
      {versions.results.length ? <div className="public-profile-history">{versions.results.map((version) => <article key={version.id}><span className="post-state">v{version.version_number}</span><div><strong>{version.display_name}</strong><small>{stateLabel(version.status)} · created {formatDate(version.created_at)}{version.approved_at ? ` · approved ${formatDate(version.approved_at)}` : ""}</small></div><span>{version.approved_by ?? "Awaiting explicit approval"}</span></article>)}</div> : <div className="empty"><b>No public-profile versions</b><span>Creating a draft does not publish anything.</span></div>}
      {publications.results.length ? <div className="public-profile-history public-publications">{publications.results.map((publication) => <article key={publication.id}><span className="post-state">{stateLabel(publication.status)}</span><div><strong>Version receipt</strong><small>{publication.public_snapshot_key} · {formatDate(publication.created_at)}</small></div><span>{publication.version_id}</span></article>)}</div> : null}
    </details>
  </AppShell>;
}
