import type { AssetRow } from "./library";

export function portfolioLibraryEligible(asset: Pick<AssetRow, "safety" | "media_authority_state" | "extension" | "video_codec">) {
  return asset.safety === "nsfw" &&
    ["canonical_verified", "preview_ready", "preview_failed"].includes(asset.media_authority_state ?? "") &&
    (["jpg", "jpeg", "png", "webp"].includes(asset.extension.toLowerCase()) ||
      (asset.extension.toLowerCase() === "mp4" && asset.video_codec === "h264"));
}

export function portfolioLibraryBlockedReason(asset: Pick<AssetRow, "safety" | "media_authority_state" | "extension" | "video_codec">) {
  if (portfolioLibraryEligible(asset)) return null;
  if (asset.safety !== "nsfw") return "Only a correctly classified 18+ preview can be added. Save its classification first.";
  if (!["canonical_verified", "preview_ready", "preview_failed"].includes(asset.media_authority_state ?? "")) {
    return "The private original must finish upload verification before it can be added.";
  }
  if (asset.extension.toLowerCase() === "mp4" && asset.video_codec === "h265") {
    return "This verified H.265 video cannot be a Portfolio preview. Add a separate short H.264 MP4 from the Library, then link this video privately as its full-length version.";
  }
  if (asset.extension.toLowerCase() === "mp4") return "Video format is not confirmed as H.264 yet. Portfolio previews require a short H.264 MP4.";
  return "Portfolio previews must be a JPG, PNG or WebP photo, or a short H.264 MP4.";
}
