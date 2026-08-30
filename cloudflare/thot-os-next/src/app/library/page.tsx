import Link from "next/link";
import { saveAssetAttributesAction, syncDropboxCatalogueAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { AssetCard } from "@/components/asset-card";
import { AttributeFields } from "@/components/attribute-fields";
import { NativeMediaUploader } from "@/components/native-media-uploader";
import { PreviewProgress } from "@/components/preview-progress";
import { destinations, getAssetByObjectId, getLibraryAssets, getLibrarySummary, getPreviewProgress } from "@/lib/library";
import { requireCreatorContext } from "@/lib/identity";
import { roleCan } from "@/lib/authorization";

function filterHref(current: Record<string, string | undefined>, key: string, value: string) {
  const next = { ...current, saved: undefined, [key]: value };
  const params = new URLSearchParams(Object.entries(next).filter(([entry, item]) => item && (entry === "source" || item !== "all")) as [string, string][]);
  return `/library${params.size ? `?${params}` : ""}`;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const context = await requireCreatorContext();
  const creatorId = context.creator.creator_id;
  const canMutate = roleCan(context.creator.role, "mutate");
  const activeSource: "native" | "legacy" | "all" = filters.source === "legacy" || filters.source === "all" ? filters.source : "native";
  const [summary, previewProgress, assets, template] = await Promise.all([getLibrarySummary(creatorId, activeSource), getPreviewProgress(creatorId, activeSource), getLibraryAssets(creatorId, { ...filters, source: activeSource }), /^[a-f0-9]{64}$/.test(filters.template ?? "") ? getAssetByObjectId(creatorId, filters.template!) : null]);
  const currentUrl = filterHref({ ...filters, template: undefined }, "saved", "all");
  return <AppShell active="Content library"><header className="top library-page-header"><div><span className="eyebrow">CREATOR WORKSPACE</span><h1>Content Library</h1><p>Find, classify and prepare {context.creator.creator_name}&apos;s content.</p></div>{activeSource === "legacy" ? <div className="library-sync-action"><small>Refreshes this creator&apos;s read-only Dropbox catalogue.</small>{canMutate ? <form action={syncDropboxCatalogueAction}><button className="secondary-action" type="submit">Sync Dropbox</button></form> : <span className="secondary-action disabled-action">Sync requires editor access</span>}</div> : <div className="library-sync-action"><small>Cloudflare-native originals are private and creator scoped.</small><span className="secondary-action disabled-action">Native library</span></div>}</header>
    {filters.notice === "sync_complete" && <div className="success">Dropbox catalogue refreshed. {filters.count || summary?.assets || 0} assets are available. Preview generation is continuing automatically in the background.</div>}
    {filters.notice === "sync_failed" && <div className="connection-banner blocked"><div><strong>Dropbox catalogue refresh failed</strong><span>{filters.detail || "No catalogue changes were applied. Check the Dropbox connection and try again."}</span></div>{filters.detail === "Dropbox root is not configured for this creator." && <Link className="secondary-action" href="/accounts">Add Dropbox source</Link>}</div>}
    {filters.saved && <div className="success">Saved attributes for {filters.saved} asset{filters.saved === "1" ? "" : "s"}.</div>}
    {activeSource === "native" && canMutate ? <NativeMediaUploader /> : null}
    <PreviewProgress initial={previewProgress} source={activeSource} />
    <section className="panel library-panel"><div className="library-heading"><div><h2>{activeSource === "native" ? "Cloudflare-native assets" : activeSource === "legacy" ? "Legacy Dropbox assets" : `${context.creator.creator_name} assets`}</h2><p>{assets.length} shown · {summary?.assets ?? 0} total · {summary?.needs_review ?? 0} need review</p></div><nav className="view-links" aria-label="Library view"><Link className={activeSource === "native" ? "active" : ""} href={filterHref(filters,"source","native")}>Native</Link><Link className={activeSource === "all" ? "active" : ""} href={filterHref(filters,"source","all")}>All</Link><Link className={activeSource === "legacy" ? "active" : ""} href={filterHref(filters,"source","legacy")}>Legacy Dropbox</Link><Link className={!filters.view || filters.view === "thumbnails" ? "active" : ""} href={filterHref(filters,"view","thumbnails")}>Grid</Link><Link className={filters.view === "list" ? "active" : ""} href={filterHref(filters,"view","list")}>List</Link></nav></div>
      <form className="library-toolbar" method="get"><input type="hidden" name="view" value={filters.view ?? "thumbnails"} /><input type="hidden" name="source" value={activeSource} /><label className="search-field"><span className="sr-only">Search assets</span><input type="search" name="query" defaultValue={filters.query ?? ""} placeholder="Search files and folders…" /></label><label><span>Type</span><select name="type" defaultValue={filters.type ?? "all"}><option value="all">All content</option><option value="photos">Photos</option><option value="videos">Videos</option></select></label><label><span>Safety</span><select name="safety" defaultValue={filters.safety ?? "all"}><option value="all">All safety</option><option value="review">Needs review</option><option value="sfw">SFW</option><option value="nsfw">NSFW</option></select></label><label><span>Destination</span><select name="destination" defaultValue={filters.destination ?? "all"}><option value="all">All destinations</option>{destinations.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button type="submit">Apply</button><Link className="clear-filters" href={filterHref({ view: filters.view }, "source", activeSource)}>Reset</Link></form>
      <div className="library-status"><span><b>{summary?.previews ?? 0}</b> previews ready</span><span><b>{summary?.sfw ?? 0}</b> SFW</span><span><b>{summary?.nsfw ?? 0}</b> NSFW</span></div>
      {canMutate ? <form className="batch-form" action={saveAssetAttributesAction}><input type="hidden" name="returnTo" value={currentUrl} /><details className="batch-panel" open={Boolean(template)}><summary><span><b>Batch edit</b><small>Select assets and apply the same classification</small></span><span className="summary-action">Open</span></summary><p>{template ? <>Starting with attributes copied from <strong>{template.basename}</strong>. Select the assets to update. <Link href={filterHref(filters,"template","all")}>Clear copied attributes</Link></> : "Choose up to 50 assets below, set their shared attributes, then save once."}</p><AttributeFields asset={template ?? undefined} /><button className="primary" type="submit">Apply to selected assets</button></details>
        <div className={`asset-grid ${filters.view === "list" ? "list" : ""}`}>{assets.map((asset) => <AssetCard asset={asset} selectable templateHref={currentUrl} key={asset.id} />)}</div>
        {!assets.length && <div className="empty"><b>No assets match these filters.</b><span>Try changing or resetting the filters above.</span></div>}
      </form> : <><div className="connection-banner muted"><div><strong>Read-only workspace</strong><span>Viewer access can inspect this creator&apos;s library but cannot change classifications or consent records.</span></div></div><div className={`asset-grid ${filters.view === "list" ? "list" : ""}`}>{assets.map((asset) => <AssetCard asset={asset} key={asset.id} />)}</div>{!assets.length && <div className="empty"><b>No assets match these filters.</b><span>Try changing or resetting the filters above.</span></div>}</>}
    </section>
  </AppShell>;
}
