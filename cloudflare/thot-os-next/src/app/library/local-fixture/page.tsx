import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AttributeFields } from "@/components/attribute-fields";
import { PageHeader } from "@/components/app-shell";
import { PortfolioLibraryControl } from "@/components/portfolio-library-control";
import type { AssetRow } from "@/lib/library";
import { portfolioLibraryEligible } from "@/lib/portfolio-library-eligibility";

const assetId = "synthetic-preview-1";

function syntheticPoster() {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650"><rect width="1000" height="650" fill="#f5b2ce"/><rect x="175" y="105" width="650" height="440" fill="#271c30" stroke="#17121f" stroke-width="12"/><circle cx="500" cy="325" r="92" fill="#f5b2ce"/><path d="M477 269v112l89-56z" fill="#271c30"/><text x="500" y="598" text-anchor="middle" font-size="35" font-family="sans-serif" fill="#17121f">SYNTHETIC SHORT CLIP</text></svg>`)}`;
}

async function saveSyntheticClassification(form: FormData) {
  "use server";
  const safety = String(form.get("safety") ?? "");
  redirect(`/library/local-fixture${safety === "nsfw" || safety === "sfw" ? `?safety=${safety}` : ""}`);
}

async function toggleSyntheticPortfolio(form: FormData) {
  "use server";
  if (form.get("assetId") !== assetId) throw new Error("Unknown synthetic asset.");
  const intent = String(form.get("intent") ?? "");
  if (intent !== "add" && intent !== "remove") throw new Error("Choose a synthetic action.");
  redirect(`/library/local-fixture?safety=nsfw${intent === "add" ? "&added=1" : ""}`);
}

export default async function LibraryLocalFixture({ searchParams }: { searchParams: Promise<{ safety?: string; added?: string }> }) {
  const host = (await headers()).get("host") ?? "";
  if (process.env.NODE_ENV !== "development" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
    process.env.PORTFOLIO_SYNTHETIC_PREVIEW !== "1") notFound();
  const query = await searchParams;
  const safety = query.safety === "nsfw" || query.safety === "sfw" ? query.safety : null;
  const selected = safety === "nsfw" && query.added === "1";
  const asset: AssetRow = {
    id: assetId, creator_id: "synthetic-creator", basename: "Synthetic short clip.mp4", extension: "mp4", bytes: 8 * 1024 * 1024,
    modified_at: "2026-10-20", creator_notes: "", preview_r2_key: "synthetic-only", safety,
    is_teaser: 0, is_multi: 0, notes: "", destinations: "", media_origin: "r2_native", media_authority_state: "canonical_verified",
    media_state: "preview_ready", video_state: "canonical_verified", video_codec: "h264", playback_provider: "none", playback_failure_code: null,
  };
  return <div className="os-cloud-shell"><main className="workspace" style={{ marginLeft: 0, maxWidth: 1440 }}>
    <PageHeader title="Review & tag" eyebrow="LOCAL SYNTHETIC FIXTURE" subtitle={asset.basename} />
    <p className="portfolio-publish-attention">Local walkthrough using the real classification and Portfolio controls with invented data. Saving changes only the URL shown here; no Library, creator, media or public data is touched.</p>
    <Link className="secondary-action" href="/library/local-fixture">← Start synthetic asset again</Link>
    <div className="asset-detail"><section className="panel detail-preview" style={{ minHeight: 430 }}><img src={syntheticPoster()} alt="Synthetic poster for a sample short clip" style={{ maxHeight: 340 }} />
      <p>This still stands in for a private video. There is no real playback or thumbnail upload in this fixture.</p></section>
      <section className="panel classification-panel"><h2>Review &amp; tag this asset</h2><p>Choose NSFW if appropriate and save classification before adding this preview.</p>
        <form action={saveSyntheticClassification}><AttributeFields asset={asset} /><button className="primary wide" type="submit">Save classification</button></form>
      </section></div>
    <PortfolioLibraryControl assetId={asset.id} selected={selected} available={portfolioLibraryEligible(asset)} canEdit
      action={toggleSyntheticPortfolio} portfolioHref="/portfolio/local-fixture?from=library"
      blockedReason={safety !== "nsfw" ? "Only a correctly classified 18+ preview can be added. Save its classification first." : undefined} />
    {selected && <p className="success" role="status">Synthetic preview selected. Open Portfolio layout to set its category and optional private full-length link.</p>}
    <section className="panel history"><h2>Asset use &amp; change history</h2><div className="empty"><b>No activity in this synthetic fixture.</b><span>Real Library events remain private in THOT OS.</span></div></section>
  </main></div>;
}
