import Image from "next/image";
import { objectIdFor, type AssetRow } from "@/lib/library";
import { VerifiedVideoPreview } from "@/components/verified-video-preview";
import { canPreviewVerifiedVideo } from "@/lib/verified-video-preview";

export function OperationsAssetChoice({ asset, type, disabled = false, defaultChecked = false, status }: {
  asset: AssetRow;
  type: "radio" | "checkbox";
  disabled?: boolean;
  defaultChecked?: boolean;
  status: string;
}) {
  const objectId = objectIdFor(asset);
  const video = ["mp4", "mov"].includes(asset.extension.toLowerCase().replace(/^\./, ""));
  return <div className="ops-asset-choice"><label aria-disabled={disabled}>
    <input type={type} name="assetId" value={asset.id} required={type === "radio"} disabled={disabled} defaultChecked={defaultChecked} />
    <span className="picker-preview">{objectId ? <Image src={`/api/preview/${objectId}`} width={180} height={180} unoptimized alt={asset.basename} /> : <span>{video ? "Video" : "No preview"}</span>}</span>
    <strong title={asset.basename}>{asset.basename}</strong><small>{status}</small>
  </label>{video && canPreviewVerifiedVideo(asset.video_state) && <details className="ops-video-preview"><summary>Preview video</summary><VerifiedVideoPreview assetId={asset.id} basename={asset.basename} /><a href={`/api/source-media/videos/${encodeURIComponent(asset.id)}/download`}>Download original</a></details>}</div>;
}
