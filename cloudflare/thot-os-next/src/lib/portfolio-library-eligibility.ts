import type { AssetRow } from "./library";

export function portfolioLibraryEligible(asset: Pick<AssetRow, "media_authority_state" | "extension" | "video_codec">) {
  return ["canonical_verified", "preview_ready", "preview_failed"].includes(asset.media_authority_state ?? "") &&
    (["jpg", "jpeg", "png", "webp"].includes(asset.extension.toLowerCase()) ||
      (asset.extension.toLowerCase() === "mp4" && ["h264", "h265"].includes(asset.video_codec ?? "")));
}

export function portfolioLibraryBlockedReason(asset: Pick<AssetRow, "media_authority_state" | "extension" | "video_codec">) {
  if (portfolioLibraryEligible(asset)) return null;
  if (!["canonical_verified", "preview_ready", "preview_failed"].includes(asset.media_authority_state ?? "")) {
    return "The private original must finish upload verification before it can be added.";
  }
  if (asset.extension.toLowerCase() === "mp4") return "This video's codec is not confirmed yet. Verified H.264 and H.265 MP4 clips can be added.";
  return "Portfolio previews must be a verified JPG, PNG or WebP photo, or a short MP4 clip.";
}
