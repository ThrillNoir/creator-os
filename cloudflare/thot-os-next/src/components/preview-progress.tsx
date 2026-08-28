"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreviewProgress as PreviewProgressState } from "@/lib/library";

export function PreviewProgress({ initial, source = "all" }: { initial: PreviewProgressState; source?: "native" | "legacy" | "all" }) {
  const [progress, setProgress] = useState(initial);
  const router = useRouter();
  const pending = progress.queued + progress.processing;

  useEffect(() => {
    if (!pending) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/library/preview-status?source=${encodeURIComponent(source)}`, { cache: "no-store" });
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
  }, [pending, progress.ready, router, source]);

  if (!progress.total) return null;
  const percent = Math.round((progress.ready / progress.total) * 100);
  const native = source === "native";
  return <section className={`preview-progress ${pending ? "active" : progress.failed ? "attention" : "complete"}`} aria-live="polite">
    <div><strong>{pending ? "Generating private previews" : progress.failed ? "Preview generation needs attention" : "Private previews ready"}</strong><span>{progress.ready} of {progress.total} ready{pending ? ` · ${pending} queued` : ""}{progress.failed ? ` · ${progress.failed} failed` : ""}</span></div>
    <progress max={progress.total} value={progress.ready}>{percent}%</progress>
    <small>{pending ? "This continues securely in the background; you can leave this page." : progress.failed ? native ? "Retry the preview from the upload row before leaving this page." : "Run Sync Dropbox to retry failed previews." : native ? "All Cloudflare-native images have private previews." : "All supported legacy assets have previews."}</small>
  </section>;
}
