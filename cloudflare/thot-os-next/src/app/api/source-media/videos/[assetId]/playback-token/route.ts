import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { noStoreJson } from "@/lib/source-media";
import { streamIframeUrl, streamPlaybackAvailable, validStreamVideoId } from "@/lib/stream-playback";

function validAssetId(value: string) { return /^[0-9a-f-]{16,64}$/i.test(value); }
function tokenDiagnostic(phase: "issued" | "failed", status: number, startedAt: number) {
  console.log(JSON.stringify({ event: "creatoros.video_playback_token", route: "/api/source-media/videos/[assetId]/playback-token", phase, status, durationMs: Date.now() - startedAt }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const startedAt = Date.now();
  const { assetId } = await params;
  if (!validAssetId(assetId)) return noStoreJson({ ok: false, error: "invalid_asset" }, 400);
  const context = await requireCreatorContext("view");
  const env = cloudflareEnv() as CloudflareEnv & { STREAM?: StreamBinding; R2_STREAM_PLAYBACK_ENABLED?: string };
  if (!streamPlaybackAvailable(env)) return noStoreJson({ ok: false, error: "stream_playback_unavailable" }, 503);
  const playback = await env.DB.prepare("SELECT state,playback_provider,playback_external_id FROM asset_video_playback_states WHERE asset_id=? AND creator_id=?")
    .bind(assetId, context.creator.creator_id).first<{ state: string; playback_provider: string; playback_external_id: string | null }>();
  if (!playback || playback.state !== "playback_ready" || playback.playback_provider !== "stream" || !validStreamVideoId(playback.playback_external_id)) return noStoreJson({ ok: false, error: "playback_not_ready" }, 409);
  try {
    const video = env.STREAM!.video(playback.playback_external_id);
    const [details, token] = await Promise.all([video.details(), video.generateToken()]);
    if (!details.readyToStream || !details.requireSignedURLs) return noStoreJson({ ok: false, error: "playback_not_ready" }, 409);
    const response = noStoreJson({ ok: true, iframeUrl: streamIframeUrl(details, token) });
    tokenDiagnostic("issued", 200, startedAt);
    return response;
  } catch {
    tokenDiagnostic("failed", 503, startedAt);
    return noStoreJson({ ok: false, error: "playback_token_unavailable" }, 503);
  }
}
