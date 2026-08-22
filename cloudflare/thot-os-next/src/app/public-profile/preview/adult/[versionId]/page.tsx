import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { localAdultPreviewCookieName, readLocalAdultPreviewSession, requireLocalAdultPreview } from "@/lib/local-adult-preview";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AdultVersion = { id: string; adult_bio: string };
type AdultLink = { id: string; label: string };
type ImageAttachment = { id: string; image_role: "avatar" | "background" };

export default async function LocalAdultPreview({ params }: { params: Promise<{ versionId: string }> }) {
  requireLocalAdultPreview();
  const { versionId } = await params;
  if (!uuid.test(versionId)) notFound();
  const identity = await requireCreatorContext();
  const session = await readLocalAdultPreviewSession((await cookies()).get(localAdultPreviewCookieName)?.value);
  if (!session || session.creatorId !== identity.creator.creator_id || session.versionId !== versionId) redirect(`/public-profile/preview/age/${versionId}`);
  const DB = cloudflareEnv().DB;
  const [version, links, imageAttachments] = await Promise.all([
    DB.prepare("SELECT id,adult_bio FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status IN ('draft','approved')").bind(versionId, identity.creator.creator_id).first<AdultVersion>(),
    DB.prepare("SELECT id,label FROM creator_adult_link_revisions WHERE creator_id=? AND profile_version_id=? AND enabled=1 ORDER BY sort_order ASC").bind(identity.creator.creator_id, versionId).all<AdultLink>(),
    DB.prepare("SELECT id,image_role FROM creator_profile_image_attachments WHERE creator_id=? AND surface='adult_profile' AND adult_profile_version_id=? AND status='attached'").bind(identity.creator.creator_id, versionId).all<ImageAttachment>(),
  ]);
  if (!version) notFound();
  const avatar = imageAttachments.results.find((image) => image.image_role === "avatar");
  const background = imageAttachments.results.find((image) => image.image_role === "background");

  return <main className="public-preview-page adult-preview-page">
    <div className="public-preview-toolbar"><Link href="/public-profile/preview">← Back to safe profile</Link><span>LOCAL 18+ PREVIEW</span></div>
    <section className="public-preview-surface" style={background ? { backgroundImage: `linear-gradient(#0d0c10ba,#0d0c10ba),url(/api/profile-image/${background.id})` } : undefined}><main>
      <p className="age-preview-label">18+ LOCAL PREVIEW</p>
      {avatar && <img className="public-preview-avatar" src={`/api/profile-image/${avatar.id}`} alt="" />}
      <h1>{identity.creator.creator_name}</h1>
      {version.adult_bio && <p className="bio">{version.adult_bio}</p>}
      {links.results.length > 0 && <nav className="public-preview-links" aria-label="Adult creator links">{links.results.map((link) => <a className="public-preview-link" href={`/public-profile/preview/adult/${version.id}/go/${link.id}`} key={link.id}>{link.label}<i aria-hidden="true">↗</i></a>)}</nav>}
      {!version.adult_bio && !links.results.length && <p className="bio">No adult bio or enabled links are in this private version yet.</p>}
    </main></section>
  </main>;
}
