import Link from "next/link";
import { saveAssetAttributesAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AssetCard } from "@/components/asset-card";
import { AttributeFields } from "@/components/attribute-fields";
import { destinations, getAssetByObjectId, getLibraryAssets, getLibrarySummary } from "@/lib/library";
import { requireCreatorContext } from "@/lib/identity";
import { roleCan } from "@/lib/authorization";

function filterHref(current: Record<string, string | undefined>, key: string, value: string) {
  const next = { ...current, saved: undefined, [key]: value };
  const params = new URLSearchParams(Object.entries(next).filter(([, item]) => item && item !== "all") as [string, string][]);
  return `/library${params.size ? `?${params}` : ""}`;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const context = await requireCreatorContext();
  const creatorId = context.creator.creator_id;
  const canMutate = roleCan(context.creator.role, "mutate");
  const [summary, assets, template] = await Promise.all([getLibrarySummary(creatorId), getLibraryAssets(creatorId, filters), /^[a-f0-9]{64}$/.test(filters.template ?? "") ? getAssetByObjectId(creatorId, filters.template!) : null]);
  const currentUrl = filterHref({ ...filters, template: undefined }, "saved", "all");
  return <AppShell active="Content library"><PageHeader title="Content Library" subtitle={`Find, classify and prepare ${context.creator.creator_name}'s content.`} />
    {filters.saved && <div className="success">Saved attributes for {filters.saved} asset{filters.saved === "1" ? "" : "s"}.</div>}
    <section className="panel library-panel"><div className="library-heading"><div><h2>{context.creator.creator_name} assets</h2><p>{assets.length} shown · {summary?.assets ?? 0} total · {summary?.needs_review ?? 0} need review</p></div><div className="view-links" aria-label="Library view"><Link className={!filters.view || filters.view === "thumbnails" ? "active" : ""} href={filterHref(filters,"view","thumbnails")}>Grid</Link><Link className={filters.view === "list" ? "active" : ""} href={filterHref(filters,"view","list")}>List</Link></div></div>
      <form className="library-toolbar" method="get"><input type="hidden" name="view" value={filters.view ?? "thumbnails"} /><label className="search-field"><span className="sr-only">Search assets</span><input type="search" name="query" defaultValue={filters.query ?? ""} placeholder="Search files and folders…" /></label><label><span>Type</span><select name="type" defaultValue={filters.type ?? "all"}><option value="all">All content</option><option value="photos">Photos</option><option value="videos">Videos</option></select></label><label><span>Safety</span><select name="safety" defaultValue={filters.safety ?? "all"}><option value="all">All safety</option><option value="review">Needs review</option><option value="sfw">SFW</option><option value="nsfw">NSFW</option></select></label><label><span>Destination</span><select name="destination" defaultValue={filters.destination ?? "all"}><option value="all">All destinations</option>{destinations.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button type="submit">Apply</button><Link className="clear-filters" href={`/library${filters.view === "list" ? "?view=list" : ""}`}>Reset</Link></form>
      <div className="library-status"><span><b>{summary?.previews ?? 0}</b> previews ready</span><span><b>{summary?.sfw ?? 0}</b> SFW</span><span><b>{summary?.nsfw ?? 0}</b> NSFW</span></div>
      {canMutate ? <form className="batch-form" action={saveAssetAttributesAction}><input type="hidden" name="returnTo" value={currentUrl} /><details className="batch-panel" open={Boolean(template)}><summary><span><b>Batch edit</b><small>Select assets and apply the same classification</small></span><span className="summary-action">Open</span></summary><p>{template ? <>Starting with attributes copied from <strong>{template.basename}</strong>. Select the assets to update. <Link href={filterHref(filters,"template","all")}>Clear copied attributes</Link></> : "Choose up to 50 assets below, set their shared attributes, then save once."}</p><AttributeFields asset={template ?? undefined} /><button className="primary" type="submit">Apply to selected assets</button></details>
        <div className={`asset-grid ${filters.view === "list" ? "list" : ""}`}>{assets.map((asset) => <AssetCard asset={asset} selectable templateHref={currentUrl} key={asset.id} />)}</div>
        {!assets.length && <div className="empty"><b>No assets match these filters.</b><span>Try changing or resetting the filters above.</span></div>}
      </form> : <><div className="connection-banner muted"><div><strong>Read-only workspace</strong><span>Viewer access can inspect this creator&apos;s library but cannot change classifications or consent records.</span></div></div><div className={`asset-grid ${filters.view === "list" ? "list" : ""}`}>{assets.map((asset) => <AssetCard asset={asset} key={asset.id} />)}</div>{!assets.length && <div className="empty"><b>No assets match these filters.</b><span>Try changing or resetting the filters above.</span></div>}</>}
    </section>
  </AppShell>;
}
