import { notFound } from "next/navigation";
import { saveAssetAttributesAction } from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AttributeFields } from "@/components/attribute-fields";
import { CreatorFriendFields } from "@/components/creator-friend-fields";
import { getAssetByObjectId, getAssetEvents, getAttachedFriends, getCreatorFriends, getNativeImagePreviewRecoverySession, objectIdFor } from "@/lib/library";
import { requireCreatorContext } from "@/lib/identity";
import { PrivateStreamPlayer } from "@/components/private-stream-player";
import { VerifiedVideoPreview } from "@/components/verified-video-preview";
import { canPreviewVerifiedVideo } from "@/lib/verified-video-preview";
import Link from "next/link";
import { roleCan } from "@/lib/authorization";
import { NativeImagePreviewRetry } from "@/components/native-image-preview-retry";
import { headers } from "next/headers";
import { ContentLinkForm } from "@/components/content-link-form";
import { cloudflareEnv } from "@/lib/cloudflare";
import { getPortfolioAddChoices, getPortfolioItem } from "@/lib/portfolio-authoring";
import { togglePortfolioItemAction } from "@/app/portfolio/actions";
import { VideoPosterEditor } from "@/components/video-poster-editor";
import { PortfolioLibraryControl } from "@/components/portfolio-library-control";
import { portfolioLibraryBlockedReason, portfolioLibraryEligible } from "@/lib/portfolio-library-eligibility";

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
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(objectId)) notFound();
  const context = await requireCreatorContext();
  const creatorId = context.creator.creator_id;
  const canMutate = roleCan(context.creator.role, "mutate");
  const asset = await getAssetByObjectId(creatorId, objectId);
  if (!asset) notFound();
  const portfolioEnabled = String((cloudflareEnv() as { PORTFOLIO_AUTHORING_ENABLED?: string }).PORTFOLIO_AUTHORING_ENABLED) === "1";
  const portfolioAvailable = portfolioLibraryEligible(asset);
  const [friends, attached, events, portfolioItem, portfolioChoices] = await Promise.all([
    getCreatorFriends(creatorId), getAttachedFriends(creatorId, asset.id), getAssetEvents(creatorId, asset.id),
    portfolioEnabled ? getPortfolioItem(creatorId, asset.id) : Promise.resolve(null),
    portfolioEnabled && canMutate && portfolioAvailable ? getPortfolioAddChoices(creatorId) : Promise.resolve({ categories: [], fullVideos: [] }),
  ]);
  const query = await searchParams;
  const previewId = objectIdFor(asset);
  const video = asset.video_state !== null;
  const posterUrl = video && previewId ? `/api/preview/${previewId}` : null;
  const posterAvailable = portfolioEnabled && canMutate && video && canPreviewVerifiedVideo(asset.video_state)
    && Boolean((cloudflareEnv() as { IMAGES?: ImagesBinding; PREVIEWS?: R2Bucket }).IMAGES)
    && Boolean((cloudflareEnv() as { IMAGES?: ImagesBinding; PREVIEWS?: R2Bucket }).PREVIEWS);
  const host = (await headers()).get("host") ?? "";
  const localContentLinks = process.env.CONTENT_DOWNLOAD_LINKS_LOCAL === "1" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const stagingContentLinks = host === "thot-os-staging.thot-os.workers.dev" && (cloudflareEnv() as { CONTENT_DOWNLOAD_LINKS_ENABLED?: string }).CONTENT_DOWNLOAD_LINKS_ENABLED === "1";
  const previewRecovery = canMutate && !video && !asset.preview_r2_key
    ? await getNativeImagePreviewRecoverySession(creatorId, asset.id) : null;
  return <AppShell active="Content library"><PageHeader title="Review & tag" subtitle={asset.basename} /><Link className="secondary-action" href="/library">← Content library</Link>
    {query.saved && <div className="success">Asset attributes saved.</div>}
    <div className="asset-detail"><section className="panel detail-preview">{video ? <>{asset.video_state === "playback_ready" && <PrivateStreamPlayer assetId={asset.id} />}{canPreviewVerifiedVideo(asset.video_state) ? <><VerifiedVideoPreview assetId={asset.id} basename={asset.basename} poster={posterUrl} /><p>The original is available for review. If your browser cannot play this format, download it to review locally.</p>{asset.video_state !== "playback_ready" && <p>{asset.playback_failure_code === "stream_submission_uncertain" ? "Browser playback preparation needs checking. Your upload is safe; do not re-upload or retry preparation yet." : "Browser-compatible playback is not ready yet. You can still review and save tags."}</p>}<p>File checksum supplied by uploader; server checked size, container and storage identity.</p><a className="secondary-action" href={`/api/source-media/videos/${asset.id}/download`}>Download verified original</a></> : <p>The private video is still uploading or unavailable for review.</p>}</> : previewId ? <img src={`/api/preview/${previewId}`} alt={asset.basename} /> : <><p>{asset.media_state === "preview_failed" ? "Private preview is unavailable. You can still save tags." : "Preview preparing. You can still save tags."}</p>{previewRecovery && <NativeImagePreviewRetry sessionId={previewRecovery.id} />}</>}</section><section className="panel classification-panel"><h2>{canMutate ? "Review & tag this asset" : "Classification"}</h2>{canMutate ? <><p>Saving marks this review complete and records your changes.</p><form action={saveAssetAttributesAction}><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="returnTo" value={`/library/${objectId}`} /><AttributeFields asset={asset} multiFields={<CreatorFriendFields friends={friends} attached={attached} />} /><button className="primary wide" type="submit">Save classification</button></form></> : <><p>Viewer access is read-only.</p><dl className="account-details"><div><dt>Safety</dt><dd>{asset.safety ?? "Needs review"}</dd></div><div><dt>Destinations</dt><dd>{asset.destinations ? asset.destinations.split("|").join(", ") : "None assigned"}</dd></div><div><dt>People</dt><dd>{asset.is_multi ? `${attached.length} attached creator${attached.length === 1 ? "" : "s"}` : "Creator only"}</dd></div></dl></>}
      {portfolioEnabled && <PortfolioLibraryControl assetId={asset.id} selected={Boolean(portfolioItem)} available={portfolioAvailable} canEdit={canMutate} action={togglePortfolioItemAction} embedded
        selectedCategoryName={portfolioItem?.category_name} selectedFullLengthName={portfolioItem?.full_length_basename}
        categories={portfolioChoices.categories} fullVideos={portfolioChoices.fullVideos}
        blockedReason={portfolioLibraryBlockedReason(asset) ?? undefined} />}</section></div>
    {posterAvailable && <section className="panel library-video-poster"><VideoPosterEditor assetId={asset.id} posterUrl={posterUrl} /></section>}
    <section className="panel history"><h2>Asset use &amp; change history</h2><p>Classification, consent and future publication activity will appear here.</p>{events.length ? events.map((event) => <article key={event.id}><div><strong>{event.event_type.replaceAll("_"," ")}</strong><small>{event.actor} · {new Date(event.created_at).toLocaleString("en-AU")}</small></div><span>{eventSummary(event.snapshot)}</span></article>) : <div className="empty">No cloud changes recorded yet.</div>}</section>
    {(localContentLinks || stagingContentLinks) && canMutate && video && <ContentLinkForm assetId={asset.id} eligibility={[
      !asset.safety && "Classify this video as SFW or NSFW first.",
      Boolean(asset.is_multi) && "Download links are unavailable for videos with multiple creators.",
      attached.length > 0 && "Download links are unavailable for videos with attached people.",
    ].filter((reason): reason is string => Boolean(reason))} />}
  </AppShell>;
}
