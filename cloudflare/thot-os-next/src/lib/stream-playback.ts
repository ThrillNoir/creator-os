import { presignCanonicalVideoRead } from "./r2-direct-video-upload";

type StreamPlaybackEnv = CloudflareEnv & { STREAM?: StreamBinding; R2_STREAM_PLAYBACK_ENABLED?: string };

export type StreamPlaybackDetails = Pick<StreamVideo, "id" | "readyToStream" | "status" | "hlsPlaybackUrl">;

export function streamPlaybackAvailable(env: StreamPlaybackEnv) {
  return env.R2_STREAM_PLAYBACK_ENABLED === "1" && Boolean(env.STREAM);
}

export function validStreamVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

export async function playbackCorrelation(creatorId: string, assetId: string) {
  const bytes = new TextEncoder().encode(`creatoros-stream-playback:v1:${creatorId}:${assetId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function stagingPlaybackOrigin(env: StreamPlaybackEnv) {
  const configured = new URL(env.APP_BASE_URL);
  if (configured.protocol !== "https:" || configured.hostname !== "thot-os-staging.thot-os.workers.dev") throw new Error("stream_playback_origin_invalid");
  return configured.hostname;
}

/**
 * This helper intentionally returns only the parameters that Stream needs;
 * the short-lived source URL is handed directly to the binding and must never
 * enter a response, persistence, or diagnostic record.
 */
export async function createStreamCopyRequest(env: StreamPlaybackEnv, input: { creatorId: string; assetId: string; objectKey: string }) {
  if (!streamPlaybackAvailable(env)) throw new Error("stream_playback_unavailable");
  const source = await presignCanonicalVideoRead(env, input.objectKey);
  const correlation = await playbackCorrelation(input.creatorId, input.assetId);
  return {
    sourceUrl: source.url,
    params: {
      allowedOrigins: [stagingPlaybackOrigin(env)],
      creator: correlation,
      meta: { creatorosPlayback: correlation },
      requireSignedURLs: true,
    } satisfies StreamUrlUploadParams,
  };
}

export function streamSubmissionFailureCode(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "RateLimitedError") return "stream_submission_rate_limited";
  if (name === "QuotaReachedError") return "stream_submission_quota_reached";
  if (name === "MaxFileSizeError") return "stream_submission_size_rejected";
  if (name === "BadRequestError") return "stream_submission_rejected";
  return "stream_submission_uncertain";
}

export function streamProcessingFailureCode(details: Pick<StreamVideo, "readyToStream" | "status">) {
  if (details.readyToStream) return null;
  return details.status?.state === "error" ? "stream_processing_failed" : null;
}

/** The Stream binding supplies a signed token; a player URL is derived only
 * in memory and returned in a private no-store response to its authorised
 * creator. Neither the token nor Stream's UID is persisted or logged. */
export function streamIframeUrl(details: StreamPlaybackDetails, token: string) {
  if (!validStreamVideoId(details.id) || typeof token !== "string" || !token || token.length > 8192 || /\s/.test(token)) throw new Error("stream_playback_token_invalid");
  const hls = new URL(details.hlsPlaybackUrl);
  if (hls.protocol !== "https:" || !hls.hostname.endsWith(".cloudflarestream.com")) throw new Error("stream_playback_origin_invalid");
  return `https://${hls.hostname}/${encodeURIComponent(token)}/iframe`;
}
