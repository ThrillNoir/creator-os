import type { VideoPlaybackProgress } from "@/lib/library";

const delays = [5_000, 15_000, 30_000, 60_000] as const;

export function hasPendingVideoPlayback(progress: VideoPlaybackProgress) { return progress.processing > 0; }
export function videoPlaybackDelay(index: number) { return delays[Math.max(0, Math.min(delays.length - 1, index))]; }
export function nextVideoPlaybackDelayIndex(index: number, changed: boolean) { return changed ? 0 : Math.min(delays.length - 1, index + 1); }
export function videoPlaybackChanged(current: VideoPlaybackProgress, next: VideoPlaybackProgress) {
  return current.total !== next.total || current.ready !== next.ready || current.queued !== next.queued || current.processing !== next.processing || current.failed !== next.failed;
}
export function canStartVideoPlaybackPoll(input: { progress: VideoPlaybackProgress; visible: boolean; online: boolean; inFlight: boolean }) {
  return hasPendingVideoPlayback(input.progress) && input.visible && input.online && !input.inFlight;
}
