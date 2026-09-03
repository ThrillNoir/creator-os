import { notFound } from "next/navigation";
import { saveAssetAttributesAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AttributeFields } from "@/components/attribute-fields";
import { CreatorFriendFields } from "@/components/creator-friend-fields";
import { getAssetByObjectId, getAssetEvents, getAttachedFriends, getCreatorFriends, objectIdFor } from "@/lib/library";
import { requireCreatorContext } from "@/lib/identity";
import { PrivateStreamPlayer } from "@/components/private-stream-player";
import Link from "next/link";
import { roleCan } from "@/lib/authorization";

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
  if (!/^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(objectId)) notFound();
  const context = await requireCreatorContext();
  const creatorId = context.creator.creator_id;
  const canMutate = roleCan(context.creator.role, "mutate");
  const asset = await getAssetByObjectId(creatorId, objectId);
  if (!asset) notFound();
  const [friends, attached, events] = await Promise.all([getCreatorFriends(creatorId), getAttachedFriends(creatorId, asset.id), getAssetEvents(creatorId, asset.id)]);
  const query = await searchParams;
  const previewId = objectIdFor(asset);
  const video = asset.video_state !== null;
  return <AppShell active="Content library"><PageHeader title="Review & tag" subtitle={asset.basename} /><Link className="secondary-action" href="/library">← Content library</Link>
    {query.saved && <div className="success">Asset attributes saved.</div>}
    <div className="asset-detail"><section className="panel detail-preview">{video ? <>{asset.video_state === "playback_ready" ? <PrivateStreamPlayer assetId={asset.id} /> : <><video controls preload="metadata" src={`/api/source-media/videos/${asset.id}/download?preview=1`} aria-label={`Preview ${asset.basename}`} /><p>The original is available for review. If your browser cannot play this format, download it to review locally.</p><p>{asset.playback_failure_code === "stream_submission_uncertain" ? "Browser playback preparation needs checking. Your upload is safe; do not re-upload or retry preparation yet." : "Browser-compatible playback is not ready yet. You can still review and save tags."}</p></>}<a className="secondary-action" href={`/api/source-media/videos/${asset.id}/download`}>Download verified original</a></> : previewId ? <img src={`/api/preview/${previewId}`} alt={asset.basename} /> : <p>Preview preparing. You can still save tags.</p>}</section><section className="panel classification-panel"><h2>{canMutate ? "Review & tag this asset" : "Classification"}</h2>{canMutate ? <><p>Saving marks this review complete and records your changes.</p><form action={saveAssetAttributesAction}><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="returnTo" value={`/library/${objectId}`} /><AttributeFields asset={asset} multiFields={<CreatorFriendFields friends={friends} attached={attached} />} /><button className="primary wide" type="submit">Save classification</button></form></> : <><p>Viewer access is read-only.</p><dl className="account-details"><div><dt>Safety</dt><dd>{asset.safety ?? "Needs review"}</dd></div><div><dt>Destinations</dt><dd>{asset.destinations ? asset.destinations.split("|").join(", ") : "None assigned"}</dd></div><div><dt>People</dt><dd>{asset.is_multi ? `${attached.length} attached creator${attached.length === 1 ? "" : "s"}` : "Creator only"}</dd></div></dl></>}</section></div>
    <section className="panel history"><h2>Asset use &amp; change history</h2><p>Classification, consent and future publication activity will appear here.</p>{events.length ? events.map((event) => <article key={event.id}><div><strong>{event.event_type.replaceAll("_"," ")}</strong><small>{event.actor} · {new Date(event.created_at).toLocaleString("en-AU")}</small></div><span>{eventSummary(event.snapshot)}</span></article>) : <div className="empty">No cloud changes recorded yet.</div>}</section>
  </AppShell>;
}
