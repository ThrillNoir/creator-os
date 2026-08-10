import Link from "next/link";
import { objectIdFor, type AssetRow } from "@/lib/library";

export function AssetCard({ asset, selectable = false, templateHref }: { asset: AssetRow; selectable?: boolean; templateHref?: string }) {
  const objectId = objectIdFor(asset);
  const tags = [asset.safety ?? "needs review", asset.is_teaser ? "tease" : "", asset.is_multi ? "multi" : "", ...asset.destinations.split("|")].filter(Boolean);
  return <article className="asset-card">
    {selectable && <label className="asset-select"><input type="checkbox" name="assetId" value={asset.id} /><span>Select</span></label>}
    <Link href={objectId ? `/library/${objectId}` : "/library"}>
      <div className="asset-preview">{objectId ? <img src={`/api/preview/${objectId}`} alt="" loading="lazy" /> : <span>Waiting for Dropbox download</span>}</div>
      <div className="asset-info"><strong title={asset.basename}>{asset.basename}</strong><small>{Math.round(asset.bytes / 1024)} KB · {asset.extension.toUpperCase()}</small><div className="pills">{tags.map((tag) => <span className={`pill ${tag}`} key={tag}>{tag}</span>)}</div></div>
    </Link>
    {selectable && templateHref && objectId && <Link className="copy-attributes" href={`${templateHref}${templateHref.includes("?") ? "&" : "?"}template=${objectId}`}>Copy attributes for batch edit</Link>}
  </article>;
}
