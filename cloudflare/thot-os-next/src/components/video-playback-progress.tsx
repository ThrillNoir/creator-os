"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoPlaybackProgress as Progress } from "@/lib/library";
import { canStartVideoPlaybackPoll, hasPendingVideoPlayback, nextVideoPlaybackDelayIndex, videoPlaybackChanged, videoPlaybackDelay } from "@/lib/video-playback-polling";

function browserState() { return { visible: typeof document === "undefined" || document.visibilityState === "visible", online: typeof navigator === "undefined" || navigator.onLine }; }

export function VideoPlaybackProgress({ initial, canReconcile }: { initial: Progress; canReconcile: boolean }) {
  const [progress, setProgress] = useState(initial); const [browser, setBrowser] = useState(browserState); const progressRef = useRef(progress); const delay = useRef(0); const inFlight = useRef(false); const router = useRouter();
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { progressRef.current = initial; delay.current = 0; setProgress(initial); }, [initial]);
  useEffect(() => { const update = () => setBrowser(browserState()); document.addEventListener("visibilitychange", update); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => {
    if (!canReconcile || !hasPendingVideoPlayback(progress) || !browser.visible || !browser.online) return;
    let cancelled = false; let timer: number | undefined; let controller: AbortController | undefined;
    const schedule = (ms: number) => { timer = window.setTimeout(() => void poll(), ms); };
    const poll = async () => {
      if (cancelled || !canStartVideoPlaybackPoll({ progress: progressRef.current, visible: browser.visible, online: browser.online, inFlight: inFlight.current })) return;
      inFlight.current = true; controller = new AbortController(); let next = videoPlaybackDelay(delay.current);
      try { const response = await fetch("/api/library/video-playback-status", { cache: "no-store", signal: controller.signal }); const body = await response.json() as Progress & { changed?: boolean }; if (!response.ok) delay.current = nextVideoPlaybackDelayIndex(delay.current, false); else { const changed = videoPlaybackChanged(progressRef.current, body); delay.current = nextVideoPlaybackDelayIndex(delay.current, changed); if (changed) { progressRef.current = body; setProgress(body); router.refresh(); } } next = videoPlaybackDelay(delay.current); }
      catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { delay.current = nextVideoPlaybackDelayIndex(delay.current, false); next = videoPlaybackDelay(delay.current); } }
      finally { inFlight.current = false; controller = undefined; }
      if (!cancelled && canStartVideoPlaybackPoll({ progress: progressRef.current, visible: browser.visible, online: browser.online, inFlight: inFlight.current })) schedule(next);
    };
    schedule(videoPlaybackDelay(delay.current)); return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); controller?.abort(); };
  }, [browser.online, browser.visible, canReconcile, progress, router]);
  if (!progress.total) return null;
  return <section className={`preview-progress ${progress.processing ? "active" : progress.failed || progress.queued ? "attention" : "complete"}`} aria-live="polite"><div><strong>{progress.processing ? "Preparing private browser playback" : progress.failed || progress.queued ? "Playback preparation needs attention" : "Private browser playback ready"}</strong><span>{progress.ready} ready{progress.processing ? ` · ${progress.processing} processing` : ""}{progress.queued ? ` · ${progress.queued} needs review` : ""}{progress.failed ? ` · ${progress.failed} failed` : ""}</span></div>{progress.processing > 0 && <progress max={progress.total} value={progress.ready}>{progress.ready}</progress>}<small>{progress.processing ? "The canonical original remains private in R2 while Stream prepares browser-compatible playback." : progress.failed || progress.queued ? "The canonical original is unchanged. Review the video card before starting another provider request." : "Private playback is available on demand."}</small></section>;
}
