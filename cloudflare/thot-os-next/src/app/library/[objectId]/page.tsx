import { notFound } from "next/navigation";
import { saveAssetAttributesAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AttributeFields } from "@/components/attribute-fields";
import { CreatorFriendFields } from "@/components/creator-friend-fields";
import { getAssetByObjectId, getAssetEvents, getAttachedFriends, getCreatorFriends } from "@/lib/library";
import { requireCreatorContext } from "@/lib/identity";

function eventSummary(snapshotValue: string) {
  try {
    const snapshot = JSON.parse(snapshotValue) as { safety?: string; destinations?: string[] };
    return `${snapshot.safety || "needs review"}${snapshot.destinations?.length ? ` · ${snapshot.destinations.join(", ")}` : ""}`;
  } catch {
    return "Update recorded";
  }
}

export default async function AssetPage({ params, searchParams }: { params: Promise<{ objectId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { objectId } = await params;
  if (!/^[a-f0-9]{64}$/.test(objectId)) notFound();
  const context = await requireCreatorContext();
  const creatorId = context.creator.creator_id;
  const asset = await getAssetByObjectId(creatorId, objectId);
  if (!asset) notFound();
  const [friends, attached, events] = await Promise.all([getCreatorFriends(creatorId), getAttachedFriends(creatorId, asset.id), getAssetEvents(creatorId, asset.id)]);
  const query = await searchParams;
  return <AppShell active="Content library"><PageHeader title="Asset details" subtitle={asset.basename} />
    {query.saved && <div className="success">Asset attributes saved.</div>}
    <div className="asset-detail"><section className="panel detail-preview"><img src={`/api/preview/${objectId}`} alt={asset.basename} /></section><section className="panel classification-panel"><h2>Classify asset</h2><p>Saving marks this review complete and records your changes.</p><form action={saveAssetAttributesAction}><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="returnTo" value={`/library/${objectId}`} /><AttributeFields asset={asset} multiFields={<CreatorFriendFields friends={friends} attached={attached} />} /><button className="primary wide" type="submit">Save classification</button></form></section></div>
    <section className="panel history"><h2>Asset use &amp; change history</h2><p>Classification, consent and future publication activity will appear here.</p>{events.length ? events.map((event) => <article key={event.id}><div><strong>{event.event_type.replaceAll("_"," ")}</strong><small>{event.actor} · {new Date(event.created_at).toLocaleString("en-AU")}</small></div><span>{eventSummary(event.snapshot)}</span></article>) : <div className="empty">No cloud changes recorded yet.</div>}</section>
  </AppShell>;
}
