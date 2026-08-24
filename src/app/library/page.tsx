import Link from "next/link";
import { ClipboardCopy, Grid3X3, List, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AssetClassificationForm } from "@/components/asset-classification-form";
import { EmptyState, MediaCard, MediaFilterBar, MediaListRow, destinationLabels, isPhotoAsset } from "@/components/media-workflow";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ASSET_DESTINATIONS, getAssetClassification, getAssetCount, getLibraryAssets, getPeople, type AssetDestination } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { applyClassificationCopyAction, beginClassificationCopyAction, syncLibraryAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchValues = {
  q?: string;
  type?: string;
  safety?: string;
  destination?: string;
  trait?: string;
  usage?: string;
  view?: string;
  notice?: string;
  count?: string;
  detail?: string;
  copyFrom?: string;
  savedAsset?: string;
};

function Notice({ children, variant = "success" }: { children: React.ReactNode; variant?: "success" | "error" }) {
  return <div className={`media-notice media-notice-${variant}`} role={variant === "error" ? "alert" : "status"}>{children}</div>;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const {
    q = "",
    type = "all",
    safety = "",
    destination = "",
    trait = "",
    usage = "",
    view = "thumbnails",
    notice = "",
    count = "",
    detail = "",
    copyFrom = "",
    savedAsset = "",
  } = await searchParams;
  const creator = await getActiveCreator();
  const mediaType = type === "photos" || type === "videos" ? type : "all";
  const galleryView = view === "list" || copyFrom ? "list" : "thumbnails";
  const assets = getLibraryAssets({ creatorId: creator.id, query: q, mediaType, safety, destination, trait, usage, limit: 120 });
  // A thumbnail grid can have several same-size LCP candidates. Keep eager work to
  // the initial visible row, while the remainder of the 120-item grid stays lazy.
  const aboveFoldPhotoIds = new Set(assets.filter((asset) => isPhotoAsset(asset)).slice(0, 5).map((asset) => asset.id));
  const priorityAssetId = assets.find((asset) => isPhotoAsset(asset))?.id;
  const total = getAssetCount(creator.id);
  const copySource = copyFrom ? getLibraryAssets({ creatorId: creator.id, limit: 500 }).find((item) => item.id === copyFrom) : undefined;
  const sourceClassification = copySource ? getAssetClassification(creator.id, copySource.id) : undefined;
  const creatorFriends = getPeople(creator.id).map((person) => ({
    id: person.id,
    name: person.stage_name || person.display_name,
    handles: person.tags,
    consentStatus: person.consent_status,
    taggingPreference: person.tagging_preference,
  }));
  const relatedAssets = assets.map((asset) => ({ id: asset.id, basename: asset.basename }));
  const queryFor = (next: Record<string, string>) => new URLSearchParams({
    ...(q ? { q } : {}),
    ...(mediaType !== "all" ? { type: mediaType } : {}),
    ...(safety ? { safety } : {}),
    ...(destination ? { destination } : {}),
    ...(trait ? { trait } : {}),
    ...(usage ? { usage } : {}),
    ...(galleryView !== "thumbnails" ? { view: galleryView } : {}),
    ...(copyFrom ? { copyFrom } : {}),
    ...next,
  }).toString();
  const listReturnTo = `/library?${queryFor({ view: "list" })}`;

  return (
    <AppShell active="Content library">
      <section className="workspace media-workspace">
        <PageHeader
          eyebrow="Source Library · read-only"
          title={`${creator.name} content library`}
          description={`${total} assets indexed · ${assets.length} shown. Classify source media without changing its file.`}
          actions={<>
            <form action={syncLibraryAction}>
              <Button size="sm" type="submit" variant="secondary"><RefreshCw aria-hidden="true" />Sync Dropbox</Button>
            </form>
            <Button asChild size="sm"><Link href="/content/new"><Plus aria-hidden="true" />Create local drafts</Link></Button>
          </>}
        />

        {notice === "sync_complete" ? <Notice>Dropbox sync complete. {count || total} {creator.name} assets are indexed.</Notice> : null}
        {notice === "sync_failed" ? <Notice variant="error">The Dropbox library could not be synced. Check that Dropbox has finished downloading the files, then try again.{detail ? <><br /><small>{detail}</small></> : null}</Notice> : null}
        {notice === "batch_saved" ? <Notice>Classification copied to {count} asset{count === "1" ? "" : "s"}. Each change was added to the audit history.</Notice> : null}
        {notice === "asset_saved" ? <Notice>Asset classification saved without leaving List view.</Notice> : null}

        <div className="media-library-controls">
          <nav className="media-tabs" aria-label="Media type">
            {[["all", "All"], ["photos", "Photos"], ["videos", "Videos"]].map(([value, label]) => <Link className={mediaType === value ? "active" : ""} href={`/library?${queryFor({ type: value === "all" ? "" : value })}`} key={value}>{label}</Link>)}
          </nav>
          <nav className="media-view-toggle" aria-label="Library presentation">
            <Link className={galleryView === "thumbnails" ? "active" : ""} href={`/library?${queryFor({ view: "" })}`}><Grid3X3 aria-hidden="true" />Thumbnails</Link>
            <Link className={galleryView === "list" ? "active" : ""} href={`/library?${queryFor({ view: "list" })}`}><List aria-hidden="true" />List</Link>
          </nav>
        </div>

        <MediaFilterBar
          copyFrom={copyFrom}
          destination={destination}
          mediaType={mediaType}
          query={q}
          safety={safety}
          trait={trait}
          usage={usage}
          view={galleryView}
        />

        {assets.length === 0 ? <EmptyState description="Try clearing one or more filters, or refresh the read-only catalogue after Dropbox has finished syncing." title="No assets match these filters" action={<Button asChild size="sm" variant="secondary"><Link href="/library">Clear filters</Link></Button>} /> : null}

        {assets.length > 0 && galleryView === "thumbnails" ? <div className="media-grid">
          {assets.map((asset) => <MediaCard asset={asset} eager={aboveFoldPhotoIds.has(asset.id)} key={asset.id} priority={asset.id === priorityAssetId} />)}
        </div> : null}

        {assets.length > 0 && galleryView === "list" && copySource && sourceClassification ? <form action={applyClassificationCopyAction} className="media-list-workflow">
          <Card className="media-batch-bar" variant="quiet">
            <CardContent>
              <input name="sourceAssetId" type="hidden" value={copySource.id} />
              <div>
                <p className="media-overline">Copying from</p>
                <strong>{copySource.basename}</strong>
                <span>{sourceClassification.safety?.toUpperCase() || "Needs review"} · {sourceClassification.destinations.map((item) => destinationLabels[item]).join(", ") || "No destinations"}</span>
              </div>
              <fieldset>
                <legend>Fields to apply</legend>
                <div className="media-check-row">
                  {[["safety", "Safety"], ["destinations", "Destinations"], ["teaser", "Teaser link"], ["people", "Creator friends"], ["notes", "Notes"]].map(([value, label]) => <label key={value}><input defaultChecked={value === "safety" || value === "destinations" || value === "teaser"} name="fields" type="checkbox" value={value} />{label}</label>)}
                </div>
              </fieldset>
              <Button size="sm" type="submit"><ClipboardCopy aria-hidden="true" />Apply to selected</Button>
              <Button asChild size="sm" variant="ghost"><Link href="/library?view=list">Cancel</Link></Button>
            </CardContent>
          </Card>
          <div className="media-list">
            {assets.map((asset) => <MediaListRow asset={asset} key={asset.id} leading={asset.id !== copySource.id ? <input aria-label={`Select ${asset.basename} as a classification target`} className="media-native-checkbox" name="targetAssetIds" type="checkbox" value={asset.id} /> : <span className="media-source-marker">Source</span>} />)}
          </div>
        </form> : null}

        {assets.length > 0 && galleryView === "list" && !(copySource && sourceClassification) ? <section className="media-list-workflow">
          <Card className="media-list-intro" variant="quiet">
            <CardContent>
              <div>
                <p className="media-overline">Attribute copy</p>
                <h2>Classify once, then apply selected fields in bulk.</h2>
                <p>Save a source asset’s classification, choose Copy attributes, then select target assets in List view.</p>
              </div>
              <Button asChild size="sm" variant="secondary"><Link href="/library"><Grid3X3 aria-hidden="true" />Thumbnail view</Link></Button>
            </CardContent>
          </Card>
          <div className="media-list">
            {assets.map((asset) => {
              const destinations = asset.destinations.split("|").filter((item): item is AssetDestination => ASSET_DESTINATIONS.includes(item as AssetDestination));
              const personIds = asset.person_ids.split("|").map(Number).filter(Number.isInteger);
              return <MediaListRow asset={asset} key={asset.id}>
                <div className="media-list-actions">
                  <form action={beginClassificationCopyAction}>
                    <input name="assetId" type="hidden" value={asset.id} />
                    <Button size="sm" type="submit" variant="ghost"><ClipboardCopy aria-hidden="true" />Copy attributes</Button>
                  </form>
                  <details className="media-classification-details" open={savedAsset === asset.id}>
                    <summary>{savedAsset === asset.id ? "Saved · edit again" : "Edit classification"}</summary>
                    <AssetClassificationForm
                      assetId={asset.id}
                      compact
                      creatorFriends={creatorFriends}
                      hasTeaserCount={asset.teaser_count}
                      initial={{ safety: asset.classification_safety, destinations, isTeaser: asset.is_teaser === 1, isMulti: asset.is_multi === 1, teaserForAssetId: asset.teaser_for_asset_id, notes: asset.classification_notes, personIds }}
                      relatedAssets={relatedAssets.filter((item) => item.id !== asset.id)}
                      returnTo={listReturnTo}
                    />
                  </details>
                </div>
              </MediaListRow>;
            })}
          </div>
        </section> : null}
      </section>
    </AppShell>
  );
}
