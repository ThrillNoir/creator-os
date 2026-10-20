import type { AssetRow } from "./library";

export function portfolioLibraryEligible(asset: Pick<AssetRow, "safety" | "media_authority_state" | "extension" | "video_codec">) {
  return asset.safety === "nsfw" &&
    ["canonical_verified", "preview_ready", "preview_failed"].includes(asset.media_authority_state ?? "") &&
    (["jpg", "jpeg", "png", "webp"].includes(asset.extension.toLowerCase()) ||
      (asset.extension.toLowerCase() === "mp4" && asset.video_codec === "h264"));
}
