import Image from "next/image";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { AssetClassificationForm } from "@/components/asset-classification-form";
import { ASSET_DESTINATIONS, getAssetClassification, getAssetCount, getLibraryAssets, getPeople, type AssetDestination } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { applyClassificationCopyAction, beginClassificationCopyAction, syncLibraryAction } from "./actions";

export const dynamic = "force-dynamic";

const photoExtensions = new Set(["jpg", "jpeg", "png", "webp", "heic"]);

function platformLabel(platform: string) {
  return platform === "instagram" ? "IG" : platform === "tiktok" ? "TIK TOK" : platform.toUpperCase();
}

const destinationLabels:Record<string,string>={instagram:"IG",facebook:"FB",tiktok:"TikTok",threads:"Threads",x:"X",reddit:"Reddit",subscription:"Subscription",ppv:"PPV"};

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; safety?:string;destination?:string;trait?:string;usage?:string; view?: string; notice?: string; count?: string; detail?: string; copyFrom?:string;savedAsset?:string }> }) {
  const { q = "", type = "all", safety="",destination="",trait="",usage="", view = "thumbnails", notice = "", count = "", detail = "",copyFrom="",savedAsset="" } = await searchParams;
  const creator = await getActiveCreator();
  const mediaType = type === "photos" || type === "videos" ? type : "all";
  const assets = getLibraryAssets({ creatorId: creator.id, query: q, mediaType, safety,destination,trait,usage,limit: 120 });
  const total = getAssetCount(creator.id);
  const galleryView = view === "list"||copyFrom ? "list" : "thumbnails";
  const copySource=copyFrom?getLibraryAssets({creatorId:creator.id,limit:500}).find((item)=>item.id===copyFrom):undefined;
  const sourceClassification=copySource?getAssetClassification(creator.id,copySource.id):undefined;
  const creatorFriends=getPeople(creator.id).map((person)=>({id:person.id,name:person.stage_name||person.display_name,handles:person.tags}));
  const relatedAssets=assets.map((asset)=>({id:asset.id,basename:asset.basename}));
  const queryFor = (next: Record<string, string>) => new URLSearchParams({ ...(q ? { q } : {}), ...(mediaType !== "all" ? { type: mediaType } : {}), ...(safety?{safety}:{}),...(destination?{destination}:{}),...(trait?{trait}:{}),...(usage?{usage}:{}), ...(galleryView !== "thumbnails" ? { view: galleryView } : {}),...(copyFrom?{copyFrom}:{}), ...next }).toString();
  const listReturnTo=`/library?${queryFor({view:"list"})}`;

  return (
    <main className="app-shell">
      <AppNav active="Content library" />
      <section className="workspace library-workspace">
        <header className="topbar">
          <div><span className="eyebrow">SOURCE LIBRARY · READ ONLY</span><h1>{creator.name} content library</h1><p className="page-subtitle">{total} assets indexed · {assets.length} shown</p></div>
          <div className="library-header-actions">
            <form action={syncLibraryAction}><button className="handoff-button" title="Refresh the read-only Dropbox catalogue">↻ Sync Dropbox</button></form>
            <Link className="primary-button button-link" href="/content/new">＋ Create post</Link>
          </div>
        </header>

        {notice === "sync_complete" && <div className="connection-alert success">Dropbox sync complete. {count || total} {creator.name} assets are now indexed.</div>}
        {notice === "sync_failed" && <div className="connection-alert error">The Dropbox library could not be synced. Check that Dropbox has finished downloading the files, then try again.{detail && <><br /><small>{detail}</small></>}</div>}
        {notice === "batch_saved" && <div className="connection-alert success">Classification copied to {count} asset{count==="1"?"":"s"}. Each change was added to the audit history.</div>}
        {notice === "asset_saved" && <div className="connection-alert success">Asset classification saved without leaving List view.</div>}

        <div className="library-view-bar"><nav className="library-tabs" aria-label="Media type">{[['all','All'],['photos','Photos'],['videos','Videos']].map(([value,label]) => <Link key={value} className={mediaType === value ? "active" : ""} href={`/library?${queryFor({ type: value === 'all' ? '' : value })}`}>{label}</Link>)}</nav><nav className="gallery-view-toggle" aria-label="Gallery view"><Link className={galleryView === "thumbnails" ? "active" : ""} href={`/library?${queryFor({ view: "" })}`}>▦ Thumbnails</Link><Link className={galleryView === "list" ? "active" : ""} href={`/library?${queryFor({ view: "list" })}`}>☷ List</Link></nav></div>

        <form className="library-tools">
          <input type="hidden" name="type" value={mediaType === "all" ? "" : mediaType} />
          <input type="hidden" name="view" value={galleryView === "thumbnails" ? "" : galleryView} />
          {copyFrom&&<input type="hidden" name="copyFrom" value={copyFrom}/>}
          <input name="q" defaultValue={q} placeholder="Search filenames and folders…" />
          <select name="safety" defaultValue={safety} aria-label="Filter by safety"><option value="">All safety</option><option value="needs_review">Needs review</option><option value="sfw">SFW</option><option value="nsfw">NSFW</option></select>
          <select name="destination" defaultValue={destination} aria-label="Filter by destination"><option value="">All destinations</option>{ASSET_DESTINATIONS.map((item)=><option value={item} key={item}>{destinationLabels[item]}</option>)}</select>
          <select name="trait" defaultValue={trait} aria-label="Filter by trait"><option value="">All traits</option><option value="has_teaser">Has teaser</option><option value="is_teaser">Is teaser</option><option value="multi">Multi creator</option></select>
          <select name="usage" defaultValue={usage} aria-label="Filter by use"><option value="">Any use</option><option value="unused">Never used</option><option value="used">Used before</option></select>
          <button>Filter</button>
          {(q || safety||destination||trait||usage|| mediaType !== "all") && <Link href="/library">Clear</Link>}
        </form>

        {galleryView === "thumbnails" ? <div className="asset-grid">
          {assets.map((asset) => {
            const tags = [asset.classification_safety?.toUpperCase()||"NEEDS REVIEW",...(asset.destinations?asset.destinations.split("|").map((item)=>destinationLabels[item]||item):[]),...(asset.teaser_count?["HAS TEASER"]:[]),...(asset.is_teaser?["TEASER"]:[]),...(asset.is_multi?["MULTI"]:[])];
            const shares = asset.share_counts ? asset.share_counts.split("|").map((item) => { const [platform,count] = item.split(":"); return { platform, count }; }) : [];
            const mediaUrl = `/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`;
            return (
              <Link className="asset-card asset-card-link" href={`/library/asset?asset=${encodeURIComponent(asset.id)}`} key={asset.id}>
                <div className="asset-image">
                  {photoExtensions.has(asset.extension) ? <Image src={mediaUrl} alt={asset.basename} fill sizes="(max-width: 700px) 50vw, (max-width: 1100px) 25vw, 220px" unoptimized /> : <video src={mediaUrl} muted preload="metadata" />}
                  {!photoExtensions.has(asset.extension) && <span className="video-pill">▶ VIDEO</span>}
                  {asset.repeated_basename === 1 && <span className="duplicate-pill">Repeated name</span>}
                </div>
                <div className="asset-copy">
                  <strong title={asset.basename}>{asset.basename}</strong>
                  <span>{(asset.bytes / 1024).toFixed(0)} KB · {asset.filename_class}</span>
                  <div className="asset-tags">{tags.map((item) => <b key={item}>{item}</b>)}</div>
                  {shares.length > 0 && <div className="share-counts">{shares.map((item) => <span key={item.platform}>{platformLabel(item.platform)} {item.count}</span>)}</div>}
                </div>
              </Link>
            );
          })}
        </div> : copySource&&sourceClassification ? <form action={applyClassificationCopyAction} className="asset-list-form">
          <div className="batch-copy-bar"><input type="hidden" name="sourceAssetId" value={copySource.id}/><div><span>COPYING FROM</span><strong>{copySource.basename}</strong><small>{sourceClassification.safety?.toUpperCase()||"Needs review"} · {sourceClassification.destinations.map((item)=>destinationLabels[item]).join(", ")||"No destinations"}</small></div><fieldset><legend>Fields to apply</legend>{[["safety","Safety"],["destinations","Destinations"],["teaser","Teaser link"],["people","Creator friends"],["notes","Notes"]].map(([value,label])=><label key={value}><input type="checkbox" name="fields" value={value} defaultChecked={value==="safety"||value==="destinations"||value==="teaser"}/>{label}</label>)}</fieldset><button className="primary-button">Apply to selected</button><Link href="/library?view=list">Cancel</Link></div>
          <div className="asset-list">{assets.map((asset)=>{const tags=[asset.classification_safety?.toUpperCase()||"NEEDS REVIEW",...(asset.destinations?asset.destinations.split("|").map((item)=>destinationLabels[item]||item):[]),...(asset.teaser_count?["HAS TEASER"]:[]),...(asset.is_teaser?["TEASER"]:[]),...(asset.is_multi?["MULTI"]:[])];const mediaUrl=`/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`;return <article key={asset.id} className="asset-list-row batch-list-row">{asset.id!==copySource.id&&<input className="batch-target-check" type="checkbox" name="targetAssetIds" value={asset.id}/>}<Link className="asset-list-thumb" href={`/library/asset?asset=${encodeURIComponent(asset.id)}`}>{photoExtensions.has(asset.extension)?<Image src={mediaUrl} alt={asset.basename} fill sizes="90px" unoptimized/>:<video src={mediaUrl} muted preload="metadata"/>}</Link><div className="asset-list-copy"><Link href={`/library/asset?asset=${encodeURIComponent(asset.id)}`}>{asset.basename}</Link><span>{asset.relative_path}</span></div><div className="asset-tags list-tags">{tags.map((item)=><b key={item}>{item}</b>)}</div></article>})}</div>
        </form> : <div className="asset-list-form inline-classification-list">
          <div className="asset-list-save"><p><strong>To paste attributes:</strong> expand a source asset, save its classification, then choose <em>Copy attributes</em>. Select the target assets and press <em>Apply to selected</em>.</p><Link className="primary-button button-link" href="/library">Thumbnail view</Link></div>
          <div className="asset-list">{assets.map((asset)=>{const tags=[asset.classification_safety?.toUpperCase()||"NEEDS REVIEW",...(asset.destinations?asset.destinations.split("|").map((item)=>destinationLabels[item]||item):[]),...(asset.teaser_count?["HAS TEASER"]:[]),...(asset.is_teaser?["TEASER"]:[]),...(asset.is_multi?["MULTI"]:[])];const mediaUrl=`/api/media/${asset.relative_path.split("/").map(encodeURIComponent).join("/")}`;const destinations=asset.destinations?asset.destinations.split("|").filter((item):item is AssetDestination=>ASSET_DESTINATIONS.includes(item as AssetDestination)):[];const personIds=asset.person_ids?asset.person_ids.split("|").map(Number).filter(Number.isInteger):[];return <article key={asset.id} className="asset-list-row editable-classification-row"><Link className="asset-list-thumb" href={`/library/asset?asset=${encodeURIComponent(asset.id)}`}>{photoExtensions.has(asset.extension)?<Image src={mediaUrl} alt={asset.basename} fill sizes="90px" unoptimized/>:<video src={mediaUrl} muted preload="metadata"/>}</Link><div className="asset-list-copy"><Link href={`/library/asset?asset=${encodeURIComponent(asset.id)}`}>{asset.basename}</Link><span>{asset.relative_path}</span><form action={beginClassificationCopyAction}><input type="hidden" name="assetId" value={asset.id}/><button className="row-copy-button">Copy attributes</button></form></div><details className="list-classification-details" open={savedAsset===asset.id}><summary><div className="asset-tags list-tags">{tags.map((item)=><b key={item}>{item}</b>)}</div><span>{savedAsset===asset.id?"Saved · edit again":"Edit classification"}</span></summary><AssetClassificationForm compact assetId={asset.id} initial={{safety:asset.classification_safety,destinations,isTeaser:asset.is_teaser===1,isMulti:asset.is_multi===1,teaserForAssetId:asset.teaser_for_asset_id,notes:asset.classification_notes,personIds}} creatorFriends={creatorFriends} relatedAssets={relatedAssets.filter((item)=>item.id!==asset.id)} hasTeaserCount={asset.teaser_count} returnTo={listReturnTo}/></details></article>})}</div>
        </div>}
        {assets.length === 0 && <div className="empty-state">No assets match the current filters.</div>}
      </section>
    </main>
  );
}
