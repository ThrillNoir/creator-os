import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { FileVideo, ImageIcon, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryAssetRow } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const photoExtensions = new Set(["jpg", "jpeg", "png", "webp", "heic"]);

export const destinationLabels: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  threads: "Threads",
  x: "X",
  reddit: "Reddit",
  subscription: "Subscription",
  ppv: "PPV",
};

export type MediaAsset = Pick<
  LibraryAssetRow,
  | "id"
  | "relative_path"
  | "basename"
  | "extension"
  | "bytes"
  | "filename_class"
  | "repeated_basename"
  | "classification_safety"
  | "is_teaser"
  | "is_multi"
  | "teaser_count"
  | "destinations"
  | "people_count"
  | "share_counts"
>;

export function mediaUrl(relativePath: string) {
  return `/api/media/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function isPhotoAsset(asset: Pick<MediaAsset, "extension">) {
  return photoExtensions.has(asset.extension.toLowerCase());
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function destinationList(asset: Pick<MediaAsset, "destinations">) {
  return asset.destinations.split("|").filter(Boolean);
}

export function AssetStatusBadges({
  asset,
  compact = false,
  includePeople = false,
}: {
  asset: Pick<MediaAsset, "classification_safety" | "destinations" | "is_teaser" | "is_multi" | "teaser_count" | "people_count">;
  compact?: boolean;
  includePeople?: boolean;
}) {
  const destinations = destinationList(asset);
  const visibleDestinations = compact ? destinations.slice(0, 1) : destinations.slice(0, 2);
  const remainingDestinations = destinations.length - visibleDestinations.length;

  return (
    <div className="media-status-badges" aria-label="Asset classification summary">
      <Badge className="shadow-none" variant={asset.classification_safety === "sfw" ? "success" : asset.classification_safety === "nsfw" ? "destructive" : "warning"}>
        {asset.classification_safety ? asset.classification_safety.toUpperCase() : "Needs review"}
      </Badge>
      {visibleDestinations.map((destination) => <Badge className="shadow-none" key={destination} variant="outline">{destinationLabels[destination] ?? destination}</Badge>)}
      {remainingDestinations > 0 ? <Badge className="shadow-none" variant="outline">+{remainingDestinations}</Badge> : null}
      {asset.teaser_count > 0 ? <Badge className="shadow-none" variant="info">Has teaser</Badge> : null}
      {asset.is_teaser === 1 ? <Badge className="shadow-none" variant="accent">Teaser</Badge> : null}
      {asset.is_multi === 1 ? <Badge className="shadow-none" variant="accent">Multi</Badge> : null}
      {includePeople && asset.people_count > 0 ? <Badge className="shadow-none" variant="outline"><UsersRound aria-hidden="true" />{asset.people_count} logged</Badge> : null}
    </div>
  );
}

export function MediaPreview({
  asset,
  sizes,
  priority = false,
  eager = false,
  className,
  decorative = false,
}: {
  asset: Pick<MediaAsset, "relative_path" | "basename" | "extension" | "repeated_basename">;
  sizes: string;
  priority?: boolean;
  eager?: boolean;
  className?: string;
  decorative?: boolean;
}) {
  const photo = isPhotoAsset(asset);

  return (
    <div className={cn("media-preview", className)}>
      {photo ? (
        <Image
          alt={decorative ? "" : asset.basename}
          fill
          loading={priority ? undefined : eager ? "eager" : undefined}
          priority={priority}
          sizes={sizes}
          src={mediaUrl(asset.relative_path)}
          unoptimized
        />
      ) : (
        <video aria-hidden={decorative} muted preload="metadata" src={mediaUrl(asset.relative_path)} />
      )}
      {!photo ? <span className="media-kind-pill"><FileVideo aria-hidden="true" />Video</span> : <span className="sr-only"><ImageIcon aria-hidden="true" />Image</span>}
      {asset.repeated_basename === 1 ? <span className="media-duplicate-pill">Repeated name</span> : null}
    </div>
  );
}

export function MediaCard({ asset, priority = false, eager = false }: { asset: MediaAsset; priority?: boolean; eager?: boolean }) {
  return (
    <Link className="media-card" href={`/library/asset?asset=${encodeURIComponent(asset.id)}`}>
      <MediaPreview asset={asset} className="media-card-preview" eager={eager} priority={priority} sizes="(max-width: 640px) 50vw, (max-width: 1000px) 33vw, (max-width: 1400px) 25vw, 280px" />
      <div className="media-card-copy">
        <strong title={asset.basename}>{asset.basename}</strong>
        <span>{asset.extension.toUpperCase()} · {formatFileSize(asset.bytes)}</span>
        <AssetStatusBadges asset={asset} compact />
      </div>
    </Link>
  );
}

export function MediaListRow({
  asset,
  leading,
  children,
}: {
  asset: MediaAsset;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className={cn("media-list-row", !leading && "media-list-row-no-leading")}>
      {leading ? <div className="media-list-leading">{leading}</div> : null}
      <Link aria-label={`Open ${asset.basename}`} className="media-list-thumbnail" href={`/library/asset?asset=${encodeURIComponent(asset.id)}`}>
        <MediaPreview asset={asset} decorative sizes="88px" />
      </Link>
      <div className="media-list-copy">
        <Link href={`/library/asset?asset=${encodeURIComponent(asset.id)}`}>{asset.basename}</Link>
        <span title={asset.relative_path}>{asset.relative_path}</span>
        <small>{asset.filename_class} · {formatFileSize(asset.bytes)}</small>
      </div>
      <AssetStatusBadges asset={asset} includePeople />
      {children ? <div className="media-list-extra">{children}</div> : null}
    </article>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="media-empty-state" role="status">
      <ImageIcon aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function MediaFilterBar({
  query,
  mediaType,
  safety,
  destination,
  trait,
  usage,
  view,
  copyFrom,
  includeDestination = true,
  includeUsage = true,
  platform,
}: {
  query: string;
  mediaType: "all" | "photos" | "videos";
  safety: string;
  destination?: string;
  trait: string;
  usage?: string;
  view?: "thumbnails" | "list";
  copyFrom?: string;
  includeDestination?: boolean;
  includeUsage?: boolean;
  platform?: string;
}) {
  const hasFilters = Boolean(query || safety || destination || trait || usage || mediaType !== "all");

  return (
    <form className="media-filter-bar">
      <input name="type" type="hidden" value={mediaType === "all" ? "" : mediaType} />
      {view ? <input name="view" type="hidden" value={view === "thumbnails" ? "" : view} /> : null}
      {copyFrom ? <input name="copyFrom" type="hidden" value={copyFrom} /> : null}
      {platform ? <input name="platform" type="hidden" value={platform} /> : null}
      <label className="sr-only" htmlFor="media-search">Search media</label>
      <Input defaultValue={query} id="media-search" name="q" placeholder="Search filenames and folders" />
      <label className="sr-only" htmlFor="media-safety">Filter by safety</label>
      <select className="media-select" defaultValue={safety} id="media-safety" name="safety">
        <option value="">All safety</option>
        <option value="needs_review">Needs review</option>
        <option value="sfw">SFW</option>
        <option value="nsfw">NSFW</option>
      </select>
      {includeDestination ? <>
        <label className="sr-only" htmlFor="media-destination">Filter by destination</label>
        <select className="media-select" defaultValue={destination} id="media-destination" name="destination">
          <option value="">All destinations</option>
          {Object.entries(destinationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </> : null}
      <label className="sr-only" htmlFor="media-trait">Filter by trait</label>
      <select className="media-select" defaultValue={trait} id="media-trait" name="trait">
        <option value="">All traits</option>
        <option value="has_teaser">Has teaser</option>
        <option value="is_teaser">Is teaser</option>
        <option value="multi">Multi creator</option>
      </select>
      {includeUsage ? <>
        <label className="sr-only" htmlFor="media-usage">Filter by past use</label>
        <select className="media-select" defaultValue={usage} id="media-usage" name="usage">
          <option value="">Any use</option>
          <option value="unused">Never used</option>
          <option value="used">Used before</option>
        </select>
      </> : null}
      <Button size="sm" type="submit" variant="secondary">Filter</Button>
      {hasFilters ? <Button asChild size="sm" variant="ghost"><Link href={platform ? `/content/new?platform=${encodeURIComponent(platform)}` : "/library"}>Clear</Link></Button> : null}
    </form>
  );
}
