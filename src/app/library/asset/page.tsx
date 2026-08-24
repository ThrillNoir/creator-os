import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ClipboardCopy, FileText, History, ImageIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AssetClassificationForm } from "@/components/asset-classification-form";
import { AssetStatusBadges, EmptyState, isPhotoAsset, mediaUrl } from "@/components/media-workflow";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAssetClassification, getAssetPublicationHistory, getLibraryAsset, getLibraryAssets, getPeople } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";
import { beginClassificationCopyAction } from "../actions";

export const dynamic = "force-dynamic";

function displayDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Perth" }).format(new Date(`${value.endsWith("Z") ? value : `${value}Z`}`));
}

function platformLabel(platform: string) {
  return platform === "instagram" ? "Instagram" : platform.toUpperCase();
}

export default async function AssetPage({ searchParams }: { searchParams: Promise<{ asset?: string; notice?: string }> }) {
  const { asset: assetId = "", notice = "" } = await searchParams;
  const creator = await getActiveCreator();
  const asset = getLibraryAsset(creator.id, assetId);
  if (!asset) notFound();

  const classification = getAssetClassification(creator.id, asset.id)!;
  const creatorFriends = getPeople(creator.id).map((person) => ({
    id: person.id,
    name: person.stage_name || person.display_name,
    handles: person.tags,
    consentStatus: person.consent_status,
    taggingPreference: person.tagging_preference,
  }));
  const relatedAssets = getLibraryAssets({ creatorId: creator.id, limit: 120 }).filter((item) => item.id !== asset.id).map((item) => ({ id: item.id, basename: item.basename }));
  const history = getAssetPublicationHistory(creator.id, asset.id);
  const published = history.filter((item) => item.status === "published");
  const counts = Object.entries(published.reduce<Record<string, number>>((result, item) => {
    result[item.platform] = (result[item.platform] || 0) + 1;
    return result;
  }, {}));
  const photo = isPhotoAsset(asset);

  return (
    <AppShell active="Content library">
      <section className="workspace media-workspace media-asset-workspace">
        <PageHeader
          eyebrow="Source library · asset review"
          title={asset.basename}
          description={`Read-only source media · ${asset.relative_path}`}
          actions={<Button asChild size="sm" variant="secondary"><Link href="/library"><ArrowLeft aria-hidden="true" />Back to library</Link></Button>}
        />

        {notice === "saved" ? <div className="media-notice media-notice-success" role="status">Classification saved. This asset is now ready for matching Library, Operations, and Vault filters.</div> : null}

        <div className="media-asset-summary">
          <AssetStatusBadges asset={{ classification_safety: classification.safety, destinations: classification.destinations.join("|"), is_teaser: classification.is_teaser, is_multi: classification.is_multi, teaser_count: classification.teaser_count, people_count: classification.person_ids.length }} includePeople />
          {counts.length ? <div className="media-share-summary"><span>Confirmed shares</span>{counts.map(([platform, count]) => <Badge className="shadow-none" key={platform} variant="info">{platformLabel(platform)} {count}</Badge>)}</div> : null}
        </div>

        <div className="media-asset-layout">
          <Card className="media-asset-preview-card">
            <CardContent>
              <div className="media-asset-preview">
                {photo ? <Image alt={asset.basename} fill priority sizes="(max-width: 900px) 100vw, 60vw" src={mediaUrl(asset.relative_path)} unoptimized /> : <video controls preload="metadata" src={mediaUrl(asset.relative_path)} />}
                {!photo ? <span className="media-kind-pill"><ImageIcon aria-hidden="true" />Video</span> : null}
              </div>
            </CardContent>
          </Card>

          <aside className="media-asset-sidebar">
            <Card>
              <CardContent>
                <AssetClassificationForm
                  assetId={asset.id}
                  creatorFriends={creatorFriends}
                  hasTeaserCount={classification.teaser_count}
                  initial={{ safety: classification.safety, destinations: classification.destinations, isTeaser: classification.is_teaser === 1, isMulti: classification.is_multi === 1, teaserForAssetId: classification.teaser_for_asset_id, notes: classification.notes, personIds: classification.person_ids }}
                  relatedAssets={relatedAssets}
                />
              </CardContent>
            </Card>

            <Card variant="quiet">
              <CardContent className="media-copy-panel">
                <ClipboardCopy aria-hidden="true" />
                <div><h2>Copy classification</h2><p>Choose the fields and target assets in List view. Every applied change is recorded in the audit history.</p></div>
                <form action={beginClassificationCopyAction}><input name="assetId" type="hidden" value={asset.id} /><Button size="sm" type="submit" variant="secondary">Choose targets</Button></form>
              </CardContent>
            </Card>

            <Card variant="quiet">
              <CardHeader><CardTitle><FileText aria-hidden="true" />File facts</CardTitle></CardHeader>
              <CardContent className="media-file-facts">
                <div><span>Format</span><strong>{asset.extension.toUpperCase()}</strong></div>
                <div><span>Size</span><strong>{(asset.bytes / 1024 / 1024).toFixed(2)} MB</strong></div>
                <div><span>Modified</span><strong>{displayDate(asset.modified_at)}</strong></div>
              </CardContent>
            </Card>
          </aside>
        </div>

        <Card className="media-history-card" variant="quiet">
          <CardHeader>
            <div className="media-history-heading"><div><CardTitle><History aria-hidden="true" />Posting history</CardTitle><CardDescription>Confirmed shares are counted only when their post package was marked published.</CardDescription></div><Badge className="shadow-none" variant="outline">{history.length} records</Badge></div>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? <EmptyState description="When a post package uses this asset, its local workflow status will appear here." title="This asset has not been used in a post package" /> : <div className="media-history-list">
              {history.map((item) => <article key={item.post_package_id}>
                <div><Badge className="shadow-none" variant="outline">{platformLabel(item.platform)}</Badge><div><strong>{item.account_label}{item.handle ? ` · ${item.handle}` : ""}</strong><span>{item.status === "published" ? `Posted ${displayDate(item.published_at)}` : item.scheduled_at ? `Scheduled ${displayDate(item.scheduled_at)}` : item.status.replaceAll("_", " ")}</span></div></div>
                <div><Badge className="shadow-none" variant={item.status === "published" ? "success" : "warning"}>{item.status.replaceAll("_", " ")}</Badge>{item.permalink ? <a href={item.permalink} rel="noreferrer" target="_blank">Open live post ↗</a> : null}<Link href={`/approvals/${item.post_package_id}`}>Open package</Link></div>
              </article>)}
            </div>}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
