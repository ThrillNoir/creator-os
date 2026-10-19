import Link from "next/link";
import { objectIdFor, type AssetRow } from "@/lib/library";
import { PrivateStreamPlayer } from "@/components/private-stream-player";
import { VerifiedVideoPreview } from "@/components/verified-video-preview";
import { canPreviewVerifiedVideo } from "@/lib/verified-video-preview";

export function AssetCard({ asset, selectable = false, templateHref, canPreparePlayback = false, canViewPlayback = false }: { asset: AssetRow; selectable?: boolean; templateHref?: string; canPreparePlayback?: boolean; canViewPlayback?: boolean }) {
  const objectId = objectIdFor(asset);
  const video = asset.video_state !== null;
  const unavailablePreview = asset.media_state === "preview_failed" ? "Private preview needs a retry" : asset.media_state === "ingesting" ? "Private original is uploading" : "Creating private preview";
  const videoStatus = asset.video_state === "playback_ready" ? "Browser playback ready" : asset.video_state === "processing" ? "Preparing browser playback" : asset.video_state === "processing_queued" ? "Preview preparation needs checking" : asset.video_state === "processing_failed" ? "Playback preparation failed · original preserved" : asset.video_state === "uploading" ? "Private video is uploading" : asset.video_state === "archived" ? "Video upload finalization failed—start this video again" : "Private original verified · browser playback can be prepared";
  const tags = [ video ? "video" : "", asset.video_codec ?? "", asset.safety ?? "needs review", asset.is_teaser ? "tease" : "", asset.is_multi ? "multi" : "", ...asset.destinations.split("|")].filter(Boolean);
  const posterUrl = video && objectId ? `/api/preview/${objectId}` : null;
  const card = <><div className="asset-preview">{posterUrl ? <img src={posterUrl} alt="" loading="lazy" /> : video ? <span>{videoStatus}</span> : objectId ? <img src={`/api/preview/${objectId}`} alt="" loading="lazy" /> : <span>{unavailablePreview}</span>}</div>
    <div className="asset-info"><strong title={asset.basename}>{asset.basename}</strong><small>{Math.round(asset.bytes / 1024)} KB · {asset.extension.toUpperCase()}</small><div className="pills">{tags.map((tag) => <span className={`pill ${tag}`} key={tag}>{tag}</span>)}</div></div></>;
  return <article className={`asset-card${video ? " video-card" : ""}`}>
    {selectable && <label className="asset-select"><input type="checkbox" name="assetId" value={asset.id} /><span>Select</span></label>}
    {video ? <><Link href={`/library/${asset.id}`}>{card}</Link><Link className="copy-attributes" href={`/library/${asset.id}`}>Review &amp; tag</Link>{canPreviewVerifiedVideo(asset.video_state) && <details className="card-video-preview"><summary>Preview original in browser</summary><VerifiedVideoPreview assetId={asset.id} basename={asset.basename} poster={posterUrl} /></details>}{((canPreparePlayback && ["canonical_verified", "processing", "playback_ready"].includes(asset.video_state ?? "")) || (canViewPlayback && asset.video_state === "playback_ready")) && <PrivateStreamPlayer assetId={asset.id} canPrepare={canPreparePlayback} />}<a className="copy-attributes" href={`/api/source-media/videos/${asset.id}/download`}>Download verified original</a></> : <Link href={`/library/${objectId ?? asset.id}`}>{card}</Link>}
    {selectable && templateHref && objectId && <Link className="copy-attributes" href={`${templateHref}${templateHref.includes("?") ? "&" : "?"}template=${objectId}`}>Copy attributes for batch edit</Link>}
  </article>;
}
