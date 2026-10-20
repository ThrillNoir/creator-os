import type { PortfolioDraftItem, PortfolioTeaser } from "./portfolio-authoring.ts";
import { isVideoPortfolioItem } from "./portfolio-video.ts";

type Item = Pick<PortfolioDraftItem, "asset_id" | "title" | "safety" | "source_available" | "category_id" | "preview_asset_id" | "preview_poster_r2_key" | "preview_r2_key" | "extension" | "video_state">;
type Teaser = Pick<PortfolioTeaser, "id" | "is_teaser" | "teaser_for_asset_id">;

export type PortfolioPublicationReadiness = {
  ready: boolean;
  message: string;
  issues: { message: string; href: string }[];
};

export function portfolioPublicationReadiness(item: Item, teasers: Teaser[]): PortfolioPublicationReadiness {
  const libraryHref = `/library/${encodeURIComponent(item.asset_id)}`;
  const editorHref = `#portfolio-item-${encodeURIComponent(item.asset_id)}`;
  if (!item.source_available) return { ready: false, message: "Original unavailable", issues: [{ message: "Original unavailable", href: libraryHref }] };
  const issues: PortfolioPublicationReadiness["issues"] = [];
  if (item.safety !== "nsfw") issues.push({ message: "Mark this item 18+ in the Library", href: libraryHref });
  if (!item.title.trim()) issues.push({ message: "Add a card title", href: editorHref });
  if (!item.category_id) issues.push({ message: "Choose a category", href: editorHref });
  if (isVideoPortfolioItem(item)) {
    if (!item.preview_asset_id) issues.push({ message: "Choose a separate short preview", href: editorHref });
    else {
      if (!teasers.some((teaser) => teaser.id === item.preview_asset_id && teaser.is_teaser === 1 && teaser.teaser_for_asset_id === item.asset_id)) {
        issues.push({ message: "Link and mark the short clip as a teaser in the Library", href: `/library/${encodeURIComponent(item.preview_asset_id)}` });
      }
      if (!item.preview_poster_r2_key) issues.push({ message: "Choose a thumbnail for the short preview", href: editorHref });
    }
  } else if (!item.preview_r2_key) {
    issues.push({ message: "Image preview still preparing", href: libraryHref });
  }
  return { ready: issues.length === 0, message: issues.length === 0 ? "Ready for final release checks" : issues.length === 1 ? issues[0].message : `${issues.length} things to finish`, issues };
}
