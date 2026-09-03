"use client";

export type MessageReplyAsset = {
  id: string;
  basename: string;
  extension: string;
  bytes: number;
  verifiedMimeType: string;
  previewUrl: string | null;
};

const assetLabel = (asset: MessageReplyAsset) => `${asset.basename} · ${asset.verifiedMimeType.startsWith("video/") ? "video" : "photo"} · ${Math.ceil(asset.bytes / 1024)} KB`;

export function MessageAttachmentPicker({ assets, value, onChange }: { assets: MessageReplyAsset[]; value: string; onChange: (assetId: string) => void }) {
  const selected = assets.find((asset) => asset.id === value) ?? null;
  return <div className="message-attachment-picker">
    <label htmlFor="instagram-reply-asset">Attach approved photo or video <select id="instagram-reply-asset" name="assetId" value={value} onChange={(event) => onChange(event.currentTarget.value)} disabled={!assets.length}>
      <option value="">No attachment</option>
      {assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
    </select></label>
    {selected ? <div className="selected-message-attachment">
      {selected.previewUrl ? <img src={selected.previewUrl} alt="" loading="lazy" /> : <span className="selected-message-attachment-icon">{selected.verifiedMimeType.startsWith("video/") ? "VIDEO" : "PHOTO"}</span>}
      <div><strong>{selected.basename}</strong><small>Instagram media-only reply · {selected.verifiedMimeType}</small><button className="secondary-action" type="button" onClick={() => onChange("")}>Remove attachment</button></div>
    </div> : <small className="message-attachment-help">{assets.length ? "Optional. Instagram media replies are sent without text." : "No approved SFW Instagram photo or video is ready to attach."}</small>}
  </div>;
}
