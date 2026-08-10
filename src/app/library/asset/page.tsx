import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AssetClassificationForm } from "@/components/asset-classification-form";
import { getAssetClassification, getAssetPublicationHistory, getLibraryAsset, getLibraryAssets, getPeople } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { beginClassificationCopyAction } from "../actions";

export const dynamic = "force-dynamic";
const photoExtensions = new Set(["jpg", "jpeg", "png", "webp", "heic"]);

function displayDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Perth" }).format(new Date(`${value.endsWith("Z") ? value : `${value}Z`}`));
}

export default async function AssetPage({ searchParams }: { searchParams: Promise<{ asset?: string;notice?:string }> }) {
  const { asset: assetId = "",notice="" } = await searchParams;
  const creator = await getActiveCreator();
  const asset = getLibraryAsset(creator.id, assetId);
  if (!asset) notFound();
  const classification = getAssetClassification(creator.id, asset.id)!;
  const creatorFriends=getPeople(creator.id).map((person)=>({id:person.id,name:person.stage_name||person.display_name,handles:person.tags}));
  const relatedAssets=getLibraryAssets({creatorId:creator.id,limit:120}).filter((item)=>item.id!==asset.id).map((item)=>({id:item.id,basename:item.basename}));
  const history = getAssetPublicationHistory(creator.id, asset.id);
  const mediaUrl = `/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`;
  const published = history.filter((item) => item.status === "published");
  const counts = Object.entries(published.reduce<Record<string, number>>((result, item) => { result[item.platform] = (result[item.platform] || 0) + 1; return result; }, {}));

  return (
    <main className="app-shell">
      <AppNav active="Content library" />
      <section className="workspace asset-detail-workspace">
        <header className="asset-detail-header"><div><Link href="/library">← Content library</Link><h1>{asset.basename}</h1><p>{asset.relative_path}</p></div>{counts.length > 0 && <div className="asset-total-shares"><span>SHARED</span>{counts.map(([platform,count]) => <strong key={platform}>{platform === "instagram" ? "IG" : platform.toUpperCase()} {count}</strong>)}</div>}</header>
        {notice==="saved"&&<div className="connection-alert success">Classification saved. This asset is now ready for the matching Library, Operations and Vault filters.</div>}
        <div className="asset-detail-layout">
          <section className="asset-preview-panel">
            {photoExtensions.has(asset.extension) ? <div className="asset-detail-image"><Image src={mediaUrl} alt={asset.basename} fill sizes="(max-width: 900px) 100vw, 60vw" unoptimized priority /></div> : <video className="asset-detail-video" src={mediaUrl} controls preload="metadata" />}
          </section>
          <aside className="asset-detail-sidebar">
            <AssetClassificationForm assetId={asset.id} initial={{safety:classification.safety,destinations:classification.destinations,isTeaser:classification.is_teaser===1,isMulti:classification.is_multi===1,teaserForAssetId:classification.teaser_for_asset_id,notes:classification.notes,personIds:classification.person_ids}} creatorFriends={creatorFriends} relatedAssets={relatedAssets} hasTeaserCount={classification.teaser_count}/>
            <form action={beginClassificationCopyAction} className="classification-copy-form"><input type="hidden" name="assetId" value={asset.id}/><button className="secondary-button">Copy classification to other assets</button><small>You will choose the fields and target assets on the next screen.</small></form>
            <div className="asset-file-facts"><h2>File</h2><span>{asset.extension.toUpperCase()}</span><span>{(asset.bytes / 1024 / 1024).toFixed(2)} MB</span><span>Modified {displayDate(asset.modified_at)}</span></div>
          </aside>
        </div>
        <section className="asset-history-panel">
          <div><h2>Posting history</h2><p>Confirmed shares are counted only when the post package was marked published.</p></div>
          {history.length === 0 ? <div className="empty-state">This asset has not been used in a post package yet.</div> : <div className="asset-history-list">{history.map((item) => <article key={item.post_package_id}><div><b>{item.platform === "instagram" ? "IG" : item.platform.toUpperCase()}</b><strong>{item.account_label} {item.handle ? `· ${item.handle}` : ""}</strong><span>{item.status === "published" ? `Posted ${displayDate(item.published_at)}` : item.scheduled_at ? `Scheduled ${displayDate(item.scheduled_at)}` : item.status.replaceAll("_", " ")}</span></div><div className="history-proof"><span className={`history-status ${item.status}`}>{item.status.replaceAll("_", " ")}</span>{item.permalink && <a href={item.permalink} target="_blank" rel="noreferrer">Open live post ↗</a>}<Link href={`/approvals/${item.post_package_id}`}>Open package</Link></div></article>)}</div>}
        </section>
      </section>
    </main>
  );
}
