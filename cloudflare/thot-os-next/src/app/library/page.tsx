import Link from "next/link";
import { saveAssetAttributesAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { AssetCard } from "@/components/asset-card";
import { AttributeFields } from "@/components/attribute-fields";
import { LazyNativeVideoUploader } from "@/components/lazy-native-video-uploader";
import { NativeMediaUploader } from "@/components/native-media-uploader";
import { PreviewProgress } from "@/components/preview-progress";
import { VideoPlaybackProgress } from "@/components/video-playback-progress";
import { destinations, getAssetByObjectId, getLibraryPageData } from "@/lib/library";
import { getDeploymentMetadata } from "@/lib/deployment-metadata";
import { requireCreatorContext } from "@/lib/identity";
import { roleCan } from "@/lib/authorization";

function filterHref(current: Record<string, string | undefined>, key: string, value: string) {
  const next = { ...current, saved: undefined, [key]: value };
  const params = new URLSearchParams(Object.entries(next).filter(([, item]) => item && item !== "all") as [string, string][]);
  return `/library${params.size ? `?${params}` : ""}`;
}

function logLibraryRender(phase: "start" | "data_loaded" | "failed", startedAt: number, source: string, fields: Record<string, number> = {}) {
  // Keep request diagnostics useful for Error 1102 investigations without
  // recording identities, file names, filters, object keys, or user input.
  console.log(JSON.stringify({ event: "creatoros.library_render", route: "/library", phase, source, durationMs: Date.now() - startedAt, deployment: getDeploymentMetadata(), ...fields }));
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const startedAt = Date.now();
  const filters = await searchParams;
  const context = await requireCreatorContext();
  const creatorId = context.creator.creator_id;
  const canMutate = roleCan(context.creator.role, "mutate");
  logLibraryRender("start", startedAt, "r2");
  let summary; let previewProgress; let videoPlaybackProgress; let assets; let template;
  try {
    const pageData = await getLibraryPageData(creatorId, filters);
    summary = pageData.summary;
    previewProgress = pageData.previewProgress;
    videoPlaybackProgress = pageData.videoPlaybackProgress;
    assets = pageData.assets;
    template = /^[a-f0-9]{64}$/.test(filters.template ?? "") ? await getAssetByObjectId(creatorId, filters.template!) : null;
    logLibraryRender("data_loaded", startedAt, "r2", { assets: assets.length, summaryAssets: summary?.assets ?? 0, previewTotal: previewProgress.total, videoPlaybackTotal: videoPlaybackProgress.total });
  } catch (error) {
    logLibraryRender("failed", startedAt, "r2");
    throw error;
  }
  const currentUrl = filterHref({ ...filters, template: undefined }, "saved", "all");
  return <AppShell active="Content library"><header className="top library-page-header"><div><span className="eyebrow">CREATOR WORKSPACE</span><h1>Content Library</h1><p>Find, classify and prepare {context.creator.creator_name}&apos;s content.</p></div><div className="library-sync-action"><small>Cloudflare-native originals are private and creator scoped.</small><span className="secondary-action disabled-action">R2 library</span></div></header>
    {filters.saved && <div className="success">Saved attributes for {filters.saved} asset{filters.saved === "1" ? "" : "s"}.</div>}
    {canMutate ? <><NativeMediaUploader /><LazyNativeVideoUploader /></> : null}
    <PreviewProgress initial={previewProgress} />
    <VideoPlaybackProgress initial={videoPlaybackProgress} canReconcile={canMutate} />
    <section className="panel library-panel"><div className="library-heading"><div><h2>Cloudflare-native assets</h2><p>{assets.length} shown · {summary?.assets ?? 0} total · {summary?.needs_review ?? 0} need review</p></div><nav className="view-links" aria-label="Library view"><Link className={!filters.view || filters.view === "thumbnails" ? "active" : ""} href={filterHref(filters,"view","thumbnails")}>Grid</Link><Link className={filters.view === "list" ? "active" : ""} href={filterHref(filters,"view","list")}>List</Link></nav></div>
      <form className="library-toolbar" method="get"><input type="hidden" name="view" value={filters.view ?? "thumbnails"} /><label className="search-field"><span className="sr-only">Search assets</span><input type="search" name="query" defaultValue={filters.query ?? ""} placeholder="Search files…" /></label><label><span>Type</span><select name="type" defaultValue={filters.type ?? "all"}><option value="all">All content</option><option value="photos">Photos</option><option value="videos">Videos</option></select></label><label><span>Safety</span><select name="safety" defaultValue={filters.safety ?? "all"}><option value="all">All safety</option><option value="review">Needs review</option><option value="sfw">SFW</option><option value="nsfw">NSFW</option></select></label><label><span>Destination</span><select name="destination" defaultValue={filters.destination ?? "all"}><option value="all">All destinations</option>{destinations.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button type="submit">Apply</button><Link className="clear-filters" href={filterHref({ view: filters.view }, "saved", "all")}>Reset</Link></form>
      <div className="library-status"><span><b>{summary?.previews ?? 0}</b> previews ready</span><span><b>{summary?.sfw ?? 0}</b> SFW</span><span><b>{summary?.nsfw ?? 0}</b> NSFW</span></div>
      {canMutate ? <form className="batch-form" action={saveAssetAttributesAction}><input type="hidden" name="returnTo" value={currentUrl} /><details className="batch-panel" open={Boolean(template)}><summary><span><b>Batch edit</b><small>Select assets and apply the same classification</small></span><span className="summary-action">Open</span></summary><p>{template ? <>Starting with attributes copied from <strong>{template.basename}</strong>. Select the assets to update. <Link href={filterHref(filters,"template","all")}>Clear copied attributes</Link></> : "Choose up to 50 assets below, set their shared attributes, then save once."}</p><AttributeFields asset={template ?? undefined} /><button className="primary" type="submit">Apply to selected assets</button></details>
        <div className={`asset-grid ${filters.view === "list" ? "list" : ""}`}>{assets.map((asset) => <AssetCard asset={asset} selectable templateHref={currentUrl} canPreparePlayback={canMutate} key={asset.id} />)}</div>
        {!assets.length && <div className="empty"><b>No assets match these filters.</b><span>Try changing or resetting the filters above.</span></div>}
      </form> : <><div className="connection-banner muted"><div><strong>Read-only workspace</strong><span>Viewer access can inspect this creator&apos;s library but cannot change classifications or consent records.</span></div></div><div className={`asset-grid ${filters.view === "list" ? "list" : ""}`}>{assets.map((asset) => <AssetCard asset={asset} key={asset.id} />)}</div>{!assets.length && <div className="empty"><b>No assets match these filters.</b><span>Try changing or resetting the filters above.</span></div>}</>}
    </section>
  </AppShell>;
}
