import type { PortfolioDraftItem } from "./portfolio-authoring.ts";
import { isVideoPortfolioItem } from "./portfolio-video.ts";

type Item = Pick<PortfolioDraftItem, "asset_id" | "title" | "safety" | "source_available" | "category_id" | "preview_r2_key" | "extension" | "video_state">;

export type PortfolioPublicationReadiness = {
  ready: boolean;
  message: string;
  issues: { message: string; href: string }[];
};

export function portfolioPublicationReadiness(item: Item): PortfolioPublicationReadiness {
  const libraryHref = `/library/${encodeURIComponent(item.asset_id)}`;
  const editorHref = `#portfolio-item-${encodeURIComponent(item.asset_id)}`;
  if (!item.source_available) return { ready: false, message: "Preview unavailable", issues: [{ message: "Preview unavailable", href: libraryHref }] };
  const issues: PortfolioPublicationReadiness["issues"] = [];
  if (item.safety !== "nsfw") issues.push({ message: "Mark this item 18+ in the Library", href: libraryHref });
  if (!item.title.trim()) issues.push({ message: "Add a card title", href: editorHref });
  if (!item.category_id) issues.push({ message: "Choose a category", href: editorHref });
  if (isVideoPortfolioItem(item)) {
    if (!item.preview_r2_key) issues.push({ message: "Choose a thumbnail for this short clip", href: editorHref });
  } else if (!item.preview_r2_key) {
    issues.push({ message: "Image preview still preparing", href: libraryHref });
  }
  return { ready: issues.length === 0, message: issues.length === 0 ? "Ready for final release checks" : issues.length === 1 ? issues[0].message : `${issues.length} things to finish`, issues };
}
