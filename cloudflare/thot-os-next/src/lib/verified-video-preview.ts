const verifiedStates = new Set(["canonical_verified", "processing_queued", "processing", "playback_ready", "processing_failed"]);

export function canPreviewVerifiedVideo(state: string | null) {
  return state !== null && verifiedStates.has(state);
}

export function verifiedVideoPreviewUrl(assetId: string) {
  return `/api/source-media/videos/${encodeURIComponent(assetId)}/download?preview=1`;
}
