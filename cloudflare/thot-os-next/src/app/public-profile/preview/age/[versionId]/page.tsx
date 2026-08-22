import Link from "next/link";
import { notFound } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { createLocalAdultGateToken, requireLocalAdultPreview } from "@/lib/local-adult-preview";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function LocalAdultAgeGate({ params }: { params: Promise<{ versionId: string }> }) {
  requireLocalAdultPreview();
  const { versionId } = await params;
  if (!uuid.test(versionId)) notFound();
  const identity = await requireCreatorContext();
  const version = await cloudflareEnv().DB.prepare("SELECT id FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status IN ('draft','approved')")
    .bind(versionId, identity.creator.creator_id).first<{ id: string }>();
  if (!version) notFound();
  const csrf = await createLocalAdultGateToken(identity.creator.creator_id, version.id);

  return <main className="public-preview-page">
    <div className="public-preview-toolbar"><Link href="/public-profile/preview">← Back to safe profile</Link><span>LOCAL 18+ FLOW</span></div>
    <section className="public-preview-surface"><main className="adult-preview-gate">
      <p className="age-preview-label">LOCAL PREVIEW ONLY</p>
      <h1>Are you 18 or older?</h1>
      <p className="bio">This area may contain adult-oriented creator links and images.</p>
      <form method="post" action={`/public-profile/preview/age/${version.id}/confirm`}><input type="hidden" name="ageConfirmed" value="yes" /><input type="hidden" name="csrf" value={csrf} /><button className="public-preview-action" type="submit">Yes, continue</button></form>
      <Link className="adult-preview-back" href="/public-profile/preview">No, go back</Link>
      <p className="adult-preview-note">This localhost preview tests the server-side boundary. The separately deployed gateway will also require Turnstile.</p>
    </main></section>
  </main>;
}
