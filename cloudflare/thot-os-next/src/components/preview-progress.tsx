"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreviewProgress as PreviewProgressState } from "@/lib/library";
import { boundedRetryAfterMs, canStartPreviewPoll, hasPendingPreviewJobs, nextPreviewPollDelayIndex, previewPollDelayMs, previewProgressChanged } from "@/lib/preview-polling";

function browserPollingState() {
  return {
    visible: typeof document === "undefined" || document.visibilityState === "visible",
    online: typeof navigator === "undefined" || navigator.onLine,
  };
}

export function PreviewProgress({ initial, source = "all" }: { initial: PreviewProgressState; source?: "native" | "legacy" | "all" }) {
  const [progress, setProgress] = useState(initial);
  const [browserState, setBrowserState] = useState(browserPollingState);
  const router = useRouter();
  const progressRef = useRef(progress);
  const delayIndex = useRef(0);
  const inFlight = useRef(false);
  const pending = hasPendingPreviewJobs(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    progressRef.current = initial;
    delayIndex.current = 0;
    setProgress(initial);
  }, [initial]);

  useEffect(() => {
    const updateBrowserState = () => setBrowserState(browserPollingState());
    document.addEventListener("visibilitychange", updateBrowserState);
    window.addEventListener("online", updateBrowserState);
    window.addEventListener("offline", updateBrowserState);
    return () => {
      document.removeEventListener("visibilitychange", updateBrowserState);
      window.removeEventListener("online", updateBrowserState);
      window.removeEventListener("offline", updateBrowserState);
    };
  }, []);

  useEffect(() => {
    if (!pending || !browserState.visible || !browserState.online) return;
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const schedule = (delayMs: number) => {
      timer = window.setTimeout(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (cancelled || !canStartPreviewPoll({ progress: progressRef.current, visible: browserState.visible, online: browserState.online, inFlight: inFlight.current })) return;
      inFlight.current = true;
      controller = new AbortController();
      let nextDelayMs: number = previewPollDelayMs(delayIndex.current);
      try {
        const response = await fetch(`/api/library/preview-status?source=${encodeURIComponent(source)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          delayIndex.current = nextPreviewPollDelayIndex(delayIndex.current, false);
          nextDelayMs = Math.max(previewPollDelayMs(delayIndex.current), boundedRetryAfterMs(response.headers.get("retry-after")) ?? 0);
        } else {
          const next = await response.json() as PreviewProgressState;
          if (cancelled) return;
          const changed = previewProgressChanged(progressRef.current, next);
          delayIndex.current = nextPreviewPollDelayIndex(delayIndex.current, changed);
          nextDelayMs = Math.max(previewPollDelayMs(delayIndex.current), boundedRetryAfterMs(response.headers.get("retry-after")) ?? 0);
          if (changed) {
            progressRef.current = next;
            setProgress(next);
            router.refresh();
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          delayIndex.current = nextPreviewPollDelayIndex(delayIndex.current, false);
          nextDelayMs = previewPollDelayMs(delayIndex.current);
        }
      } finally {
        inFlight.current = false;
        controller = undefined;
      }
      if (!cancelled && canStartPreviewPoll({ progress: progressRef.current, visible: browserState.visible, online: browserState.online, inFlight: inFlight.current })) schedule(nextDelayMs);
    };
    schedule(previewPollDelayMs(delayIndex.current));
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [browserState.online, browserState.visible, pending, router, source]);

  if (!progress.total) return null;
  const percent = Math.round((progress.ready / progress.total) * 100);
  const native = source === "native";
  return <section className={`preview-progress ${pending ? "active" : progress.failed ? "attention" : "complete"}`} aria-live="polite">
    <div><strong>{pending ? "Generating private previews" : progress.failed ? "Preview generation needs attention" : "Private previews ready"}</strong><span>{progress.ready} of {progress.total} ready{pending ? ` · ${pending} queued` : ""}{progress.failed ? ` · ${progress.failed} failed` : ""}</span></div>
    <progress max={progress.total} value={progress.ready}>{percent}%</progress>
    <small>{pending ? "This continues securely in the background; you can leave this page." : progress.failed ? native ? "Retry the preview from the upload row before leaving this page." : "Run Sync Dropbox to retry failed previews." : native ? "All Cloudflare-native images have private previews." : "All supported legacy assets have previews."}</small>
  </section>;
}
