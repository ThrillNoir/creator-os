export function isVideoPortfolioItem(item: { extension: string; video_state: string | null }) {
  return item.video_state !== null || ["mp4", "mov", "m4v", "webm"].includes(item.extension.toLowerCase());
}

export function suggestedLinkedPreviewAssetId(fullAssetId: string, candidates: readonly { id: string; teaser_for_asset_id: string | null }[]) {
  const linked = candidates.filter((candidate) => candidate.id !== fullAssetId && candidate.teaser_for_asset_id === fullAssetId);
  return linked.length === 1 ? linked[0].id : "";
}
