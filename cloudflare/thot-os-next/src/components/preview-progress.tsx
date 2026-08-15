"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreviewProgress as PreviewProgressState } from "@/lib/library";

export function PreviewProgress({ initial }: { initial: PreviewProgressState }) {
  const [progress, setProgress] = useState(initial);
  const router = useRouter();
  const pending = progress.queued + progress.processing;

  useEffect(() => {
    if (!pending) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/library/preview-status", { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as PreviewProgressState;
        if (!active) return;
        const readyChanged = next.ready !== progress.ready;
        setProgress(next);
        if (readyChanged) router.refresh();
      } catch { /* A later poll can recover without interrupting library work. */ }
    };
    const timer = window.setInterval(poll, 3000);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [pending, progress.ready, router]);

  if (!progress.total) return null;
  const percent = Math.round((progress.ready / progress.total) * 100);
  return <section className={`preview-progress ${pending ? "active" : progress.failed ? "attention" : "complete"}`} aria-live="polite">
    <div><strong>{pending ? "Generating private previews" : progress.failed ? "Preview generation needs attention" : "Private previews ready"}</strong><span>{progress.ready} of {progress.total} ready{pending ? ` · ${pending} queued` : ""}{progress.failed ? ` · ${progress.failed} failed` : ""}</span></div>
    <progress max={progress.total} value={progress.ready}>{percent}%</progress>
    <small>{pending ? "This continues securely in the background; you can leave this page." : progress.failed ? "Run Sync Dropbox to retry failed previews." : "All supported Dropbox assets have previews."}</small>
  </section>;
}
