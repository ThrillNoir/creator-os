export type PortfolioMediaFact = {
  id: string;
  extension: string;
  source_available: number;
  authority_ready: number;
  canonical_ready: number;
  missing_consent_count: number;
  source_codec: string | null;
  video_state: string | null;
  byte_count: number | null;
};

export type Blocker = { message: string; href: string };
type Card = {
  assetId: string; title: string; categoryId: string | null; fullLengthAssetId: string | null;
  video: boolean; legacy: boolean; sourceAvailable: boolean; mediaReady: boolean;
};

const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const VIDEO_STATES = ["canonical_verified", "processing_queued", "processing", "playback_ready", "processing_failed"];

export function portfolioCardBlockers(card: Card, categories: { id: string; name: string }[], facts: Record<string, PortfolioMediaFact>,
  fullVideos: { id: string; basename: string }[] = []): Blocker[] {
  const titleField = `#portfolio-title-${encodeURIComponent(card.assetId)}`;
  const categoryField = `#portfolio-category-${encodeURIComponent(card.assetId)}`;
  const fullField = `#portfolio-full-video-${encodeURIComponent(card.assetId)}`;
  const thumbnail = `#portfolio-thumbnail-${encodeURIComponent(card.assetId)}`;
  const library = `/library/${encodeURIComponent(card.assetId)}`;
  const blockers: Blocker[] = [];
  const fact = facts[card.assetId];
  if (card.legacy) blockers.push({ message: "Replace this old full-video card with its short clip", href: library });
  if (!card.sourceAvailable || !fact?.authority_ready) blockers.push({ message: "Verify the private original in the Library", href: library });
  if (fact?.missing_consent_count) blockers.push({ message: "Record consent for the people attached to this item", href: library });
  if (!card.title.trim()) blockers.push({ message: "Add a card title", href: titleField });
  if (!card.categoryId) blockers.push({ message: "Choose a category", href: categoryField });
  else if (!categories.some((category) => category.id === card.categoryId && !/[<>]/.test(category.name))) {
    blockers.push({ message: "Choose or rename a valid category", href: "#portfolio-categories" });
  }
  if (!card.mediaReady) blockers.push({ message: card.video ? "Choose a thumbnail for this clip" : "Prepare an image preview", href: card.video ? thumbnail : library });
  if (card.video && fact) {
    if (fact.extension.toLowerCase() !== "mp4" || !fact.canonical_ready || !["h264", "h265"].includes(fact.source_codec ?? "") ||
      !VIDEO_STATES.includes(fact.video_state ?? "") || fact.byte_count === null) blockers.push({ message: "Finish video source verification", href: library });
    if (fact.byte_count !== null && (fact.byte_count < 1 || fact.byte_count > MAX_VIDEO_BYTES)) {
      blockers.push({ message: "Choose an MP4 clip under 64 MB for the public preview", href: library });
    }
  }
  if (card.fullLengthAssetId) {
    const full = facts[card.fullLengthAssetId];
    const fullName = fullVideos.find((video) => video.id === card.fullLengthAssetId)?.basename ?? "linked private video";
    if (!full || !full.source_available || !full.authority_ready || full.extension.toLowerCase() !== "mp4") {
      blockers.push({ message: `Choose an available, verified private full video (${fullName})`, href: fullField });
    } else if (full.missing_consent_count) {
      blockers.push({ message: `Record consent for the people attached to ${fullName}`, href: `/library/${encodeURIComponent(full.id)}` });
    }
  }
  return blockers;
}

type ReleaseFailureContext = { detail: string | null; manifest: string | null };

export function portfolioReleaseFailure(code: string | null, context?: ReleaseFailureContext): Blocker {
  let cause = code;
  let item: { title: string; assetId: string; fullLengthAssetId?: string | null } | null = null;
  if (context?.detail && context.manifest) {
    try {
      const detail = JSON.parse(context.detail) as { cardId?: unknown; cause?: unknown };
      const manifest = JSON.parse(context.manifest) as { cards?: unknown };
      if (typeof detail.cardId === "string" && Array.isArray(manifest.cards)) {
        const card = manifest.cards.find((candidate) => candidate && typeof candidate === "object" && candidate.id === detail.cardId);
        if (card && typeof card.title === "string" && typeof card.assetId === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(card.assetId)) item = card;
      }
      if (typeof detail.cause === "string") cause = detail.cause;
    } catch { /* Older release receipts may not include structured card details. */ }
  }
  const preview = item ? `/library/${encodeURIComponent(item.assetId)}` : "/library";
  const full = item?.fullLengthAssetId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item.fullLengthAssetId)
    ? `/library/${encodeURIComponent(item.fullLengthAssetId)}` : "#portfolio-layout-title";
  const named = (message: string, href = preview): Blocker => ({ message: item ? `${item.title}: ${message}` : message, href });
  switch (cause) {
    case "portfolio_full_length_consent_missing": return named("the linked private full video needs source verification or recorded consent for attached people", full);
    case "portfolio_media_rights_or_consent_missing": return named("the selected preview needs source verification or recorded consent for attached people", preview);
    case "portfolio_video_preview_missing": return named("the selected short clip is unavailable", preview);
    case "portfolio_source_integrity_failed":
    case "portfolio_source_changed_during_copy":
    case "portfolio_source_checksum_failed": return named("the preview or thumbnail changed during release. Check its Library item", preview);
    case "portfolio_public_copy_failed": return named("the public preview copy could not be completed. Try publishing again", preview);
    case "portfolio_full_length_unavailable": return named("the linked private full video is unavailable. Choose another one", full);
    case "portfolio_video_preview_exceeds_sixty_seconds_or_is_unreadable":
    case "preview_duration_failed": return named("the video is over 60 seconds or its MP4 length could not be read. Choose a short clip", preview);
    case "portfolio_short_preview_changed_or_too_large": return named("the clip or thumbnail changed, or the clip is over 64 MB. Review this item", preview);
    case "portfolio_image_preview_changed":
    case "portfolio_image_preview_missing":
    case "portfolio_short_preview_poster_missing": return named("the preview or thumbnail is unavailable. Review its Library item", preview);
  }
  switch (code) {
    case "portfolio_adult_profile_not_current": return { message: "Publish the current 18+ profile first", href: "/adult-profile" };
    default: return { message: "The last release did not complete. Review the selected media and try again", href: "#portfolio-layout-title" };
  }
}
