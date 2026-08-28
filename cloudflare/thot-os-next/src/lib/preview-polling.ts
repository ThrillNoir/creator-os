export interface PreviewProgressSnapshot {
  total: number;
  ready: number;
  queued: number;
  processing: number;
  failed: number;
}

export const previewPollDelaysMs = [5_000, 15_000, 30_000, 60_000] as const;

export function hasPendingPreviewJobs(progress: PreviewProgressSnapshot) {
  return progress.queued + progress.processing > 0;
}

export function previewProgressChanged(current: PreviewProgressSnapshot, next: PreviewProgressSnapshot) {
  return current.total !== next.total
    || current.ready !== next.ready
    || current.queued !== next.queued
    || current.processing !== next.processing
    || current.failed !== next.failed;
}

export function previewPollDelayMs(index: number) {
  return previewPollDelaysMs[Math.min(Math.max(0, index), previewPollDelaysMs.length - 1)];
}

export function nextPreviewPollDelayIndex(currentIndex: number, changed: boolean) {
  return changed ? 0 : Math.min(Math.max(0, currentIndex) + 1, previewPollDelaysMs.length - 1);
}

export function boundedRetryAfterMs(value: string | null) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(60_000, Math.max(5_000, Math.round(seconds * 1_000)));
}

export function canStartPreviewPoll(input: { progress: PreviewProgressSnapshot; visible: boolean; online: boolean; inFlight: boolean }) {
  return hasPendingPreviewJobs(input.progress) && input.visible && input.online && !input.inFlight;
}
