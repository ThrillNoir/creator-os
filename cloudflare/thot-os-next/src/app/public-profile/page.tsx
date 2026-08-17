import { approvePublicProfileVersionAction, publishPublicProfileAction, savePublicProfileDraftAction, withdrawPublicProfileAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

type Profile = { id: string; slug: string; status: string; published_version_id: string | null };
type Version = { id: string; version_number: number; display_name: string; headline: string; bio: string; status: string; approved_by: string | null; approved_at: string | null; created_at: string };
type Link = { id: string; profile_version_id: string; label: string; destination_url: string; sort_order: number };
type Publication = { id: string; version_id: string; status: string; public_snapshot_key: string; created_at: string };

const notices: Record<string, string> = {
  draft_saved: "Draft saved. It is private until a separate human approval and publish action complete.",
  version_approved: "Profile version explicitly approved. It is still private until publishing is requested.",
  publication_started: "Publication was accepted for durable processing. Refresh this page to see its recorded result.",
  withdrawal_started: "Withdrawal was accepted for durable processing. The public KV projection will be removed before the private record is marked paused.",
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

function stateLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default async function PublicProfilePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  const creatorId = context.creator.creator_id;
  const DB = cloudflareEnv().DB;
  const [creator, profile, versions, links, publications] = await Promise.all([
    DB.prepare("SELECT slug FROM creators WHERE id=?").bind(creatorId).first<{ slug: string }>(),
    DB.prepare("SELECT id,slug,status,published_version_id FROM creator_public_profiles WHERE creator_id=?").bind(creatorId).first<Profile>(),
    DB.prepare(`SELECT id,version_number,display_name,headline,bio,status,approved_by,approved_at,created_at
      FROM creator_public_profile_versions WHERE creator_id=? ORDER BY version_number DESC`).bind(creatorId).all<Version>(),
    DB.prepare(`SELECT id,profile_version_id,label,destination_url,sort_order
      FROM creator_public_links WHERE creator_id=? ORDER BY profile_version_id,sort_order`).bind(creatorId).all<Link>(),
    DB.prepare(`SELECT id,version_id,status,public_snapshot_key,created_at
      FROM creator_public_profile_publications WHERE creator_id=? ORDER BY created_at DESC LIMIT 12`).bind(creatorId).all<Publication>(),
  ]);
  const canEdit = roleCan(context.creator.role, "mutate");
  const canApprove = roleCan(context.creator.role, "approve");
  const draft = versions.results.find((version) => version.status === "draft") ?? null;
  const published = profile?.published_version_id ? versions.results.find((version) => version.id === profile.published_version_id) ?? null : null;
  const approved = versions.results.find((version) => version.status === "approved") ?? null;
  const authoring = draft ?? published;
  const authoringLinks = authoring ? links.results.filter((link) => link.profile_version_id === authoring.id) : [];
  const slots = Array.from({ length: Math.max(4, Math.min(8, authoringLinks.length + 1)) }, (_, index) => authoringLinks[index] ?? null);
  const notice = query.notice ? notices[query.notice] : null;
  const defaultSlug = profile?.slug ?? creator?.slug ?? "creator";

  return <AppShell active="Public profile"><PageHeader title="Public profile" subtitle="Author, explicitly approve, and publish this creator’s public link page without exposing private media, notes, Dropbox sources, or platform credentials." eyebrow="PUBLIC LINKS" />
    {notice && <div className="success">{notice}</div>}
    <section className="panel connection-setup"><div className="section-heading"><div><span className="eyebrow">ISOLATED PUBLIC SURFACE</span><h2>Creator link page</h2><p>Only an approved text-and-link snapshot is copied to the public Worker. A social handle is never treated as consent, and no private preview or source media can be selected here.</p></div><span>{profile?.published_version_id ? "Published" : draft ? "Draft" : "Not published"}</span></div>
      {canEdit ? <form action={savePublicProfileDraftAction} className="inline-form public-profile-form">
        <label>Public URL slug<input name="slug" required maxLength={80} defaultValue={defaultSlug} disabled={Boolean(profile?.published_version_id)} autoComplete="off" /><small>{profile?.published_version_id ? "Published public URL slugs are stable. Withdraw the current profile before changing its URL." : "Lowercase letters, numbers and single hyphens only."}</small></label>
        <label>Display name<input name="displayName" required maxLength={120} defaultValue={authoring?.display_name ?? context.creator.creator_name} /></label>
        <label className="wide">Headline<input name="headline" maxLength={280} defaultValue={authoring?.headline ?? ""} /></label>
        <label className="wide">Bio<textarea name="bio" maxLength={2000} defaultValue={authoring?.bio ?? ""} /></label>
        <div className="section-divider wide"><b>Explicit destination links</b><span>Use final HTTPS destinations. The public page shows transparent /go/ redirects only to these approved links; no parameters can change the destination.</span></div>
        {slots.map((link, index) => <div className="public-link-fields" key={link?.id ?? `new-${index}`}><label>Label<input name="linkLabel" maxLength={80} defaultValue={link?.label ?? ""} placeholder="Official site" /></label><label>HTTPS destination<input name="linkDestination" type="url" defaultValue={link?.destination_url ?? ""} placeholder="https://example.com" /></label></div>)}
        <div className="section-divider wide"><span>Saving changes only a private draft. It creates a new version after a prior version has been approved or published.</span></div>
        <button className="primary" type="submit">Save private draft</button>
      </form> : <div className="empty"><b>Read-only public profile view</b><span>Your role can inspect profile history but cannot alter text, destinations, approvals, or publication.</span></div>}
    </section>

    <div className="two-column public-profile-actions">
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">HUMAN APPROVAL</span><h2>Approve draft</h2><p>Approval freezes the displayed text and destination list. Editing after this point requires a fresh draft version.</p></div><span>{draft ? `Version ${draft.version_number}` : "No draft"}</span></div>
        {draft && canApprove ? <form action={approvePublicProfileVersionAction} className="confirmed-action"><input type="hidden" name="versionId" value={draft.id} /><label>Approval note <small>(optional)</small><input name="approvalNote" maxLength={500} placeholder="Recorded with this immutable approval" /></label><label><input type="checkbox" name="approvalConfirmed" value="yes" required /> I checked the public text and every final destination for this creator.</label><button className="secondary-action" type="submit">Approve version {draft.version_number}</button></form> : <div className="empty"><b>{draft ? "Approval permission required" : "No draft awaiting approval"}</b><span>{draft ? "A creator, operator, or agency administrator with approval permission must make this explicit decision." : "Save a private draft before approval can be recorded."}</span></div>}
      </section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">DURABLE RELEASE</span><h2>Publish or withdraw</h2><p>Publishing uses a private service binding and Workflow. Withdrawal removes the public KV snapshot before the private profile record is paused.</p></div><span>{published ? `Live version ${published.version_number}` : approved ? `Ready version ${approved.version_number}` : "No approved version"}</span></div>
        {approved && canApprove && <form action={publishPublicProfileAction} className="confirmed-action"><input type="hidden" name="versionId" value={approved.id} /><label><input type="checkbox" name="publishConfirmed" value="yes" required /> I approve making this exact version publicly accessible on the configured public domain.</label><button className="primary" type="submit">Publish version {approved.version_number}</button></form>}
        {published && canApprove && <form action={withdrawPublicProfileAction} className="confirmed-action public-withdraw"><input type="hidden" name="versionId" value={published.id} /><label><input type="checkbox" name="withdrawConfirmed" value="yes" required /> I approve withdrawing this public page now.</label><button className="secondary-action" type="submit">Withdraw public profile</button></form>}
        {!approved && !published && <div className="empty"><b>Release is unavailable</b><span>Approve a draft before the publication Workflow can receive it. Public media remains unavailable until its separate SFW derivative pipeline is released.</span></div>}
      </section>
    </div>

    <section className="panel"><div className="section-heading"><div><span className="eyebrow">IMMUTABLE HISTORY</span><h2>Profile versions and public receipts</h2><p>Publication records are separate from authoring records, so a requested publish or withdrawal is never mistaken for a completed public change.</p></div><span>{versions.results.length} version{versions.results.length === 1 ? "" : "s"}</span></div>
      {versions.results.length ? <div className="public-profile-history">{versions.results.map((version) => <article key={version.id}><span className="post-state">v{version.version_number}</span><div><strong>{version.display_name}</strong><small>{stateLabel(version.status)} · created {formatDate(version.created_at)}{version.approved_at ? ` · approved ${formatDate(version.approved_at)}` : ""}</small></div><span>{version.approved_by ?? "Awaiting explicit approval"}</span></article>)}</div> : <div className="empty"><b>No public-profile versions</b><span>Creating a draft does not publish anything.</span></div>}
      {publications.results.length ? <div className="public-profile-history public-publications">{publications.results.map((publication) => <article key={publication.id}><span className="post-state">{stateLabel(publication.status)}</span><div><strong>Version receipt</strong><small>{publication.public_snapshot_key} · {formatDate(publication.created_at)}</small></div><span>{publication.version_id}</span></article>)}</div> : null}
    </section>
  </AppShell>;
}
