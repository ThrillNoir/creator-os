"use client";

import { canPreviewVerifiedVideo, verifiedVideoPreviewUrl } from "@/lib/verified-video-preview";

export type MessageReplyAsset = {
  id: string;
  basename: string;
  extension: string;
  bytes: number;
  verifiedMimeType: string;
  previewUrl: string | null;
  videoState: string | null;
};

const assetLabel = (asset: MessageReplyAsset) => `${asset.basename} · ${asset.verifiedMimeType.startsWith("video/") ? "video" : "photo"} · ${Math.ceil(asset.bytes / 1024)} KB`;

export function MessageAttachmentPicker({ assets, value, onChange, disabled = false }: { assets: MessageReplyAsset[]; value: string; onChange: (assetId: string) => void; disabled?: boolean }) {
  const selected = assets.find((asset) => asset.id === value) ?? null;
  return <div className="message-attachment-picker">
    <label htmlFor="instagram-reply-asset">Attach approved photo or video <select id="instagram-reply-asset" name="assetId" value={value} onChange={(event) => onChange(event.currentTarget.value)} disabled={disabled || !assets.length}>
      <option value="">No attachment</option>
      {assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
    </select></label>
    {selected ? <div className="selected-message-attachment">
      {selected.verifiedMimeType.startsWith("video/") ? <video src={canPreviewVerifiedVideo(selected.videoState) ? verifiedVideoPreviewUrl(selected.id) : `/api/source-media/${encodeURIComponent(selected.id)}`} controls preload="none" playsInline aria-label={`Preview ${selected.basename}`} style={{ maxWidth: "100%", maxHeight: 240 }} /> : <img src={`/api/source-media/${encodeURIComponent(selected.id)}`} alt={`Preview ${selected.basename}`} loading="lazy" />}
      <div><strong>{selected.basename}</strong><small>Instagram media-only reply · {selected.verifiedMimeType}</small><button className="secondary-action" type="button" disabled={disabled} onClick={() => onChange("")}>Remove attachment</button></div>
    </div> : <small className="message-attachment-help">{assets.length ? "Optional. Instagram media replies are sent without text." : "No approved SFW Instagram photo or video is ready to attach."}</small>}
  </div>;
}
