"use client";

import { useState } from "react";

export function PrivateStreamPlayer({ assetId, canPrepare = false }: { assetId: string; canPrepare?: boolean }) {
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const token = async () => {
    const response = await fetch(`/api/source-media/videos/${assetId}/playback-token`, { cache: "no-store", credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; iframeUrl?: unknown };
    if (response.ok && body.ok === true && typeof body.iframeUrl === "string") { setIframeUrl(body.iframeUrl); return true; }
    return false;
  };
  const open = async () => {
    if (state === "working") return;
    setState("working");
    try {
      if (await token()) return;
      if (!canPrepare) throw new Error("playback_unavailable");
      const response = await fetch(`/api/source-media/videos/${assetId}/playback`, { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok && body.error !== "playback_already_submitted") throw new Error("playback_start_failed");
      if (response.ok && body.ok !== true) throw new Error("playback_start_failed");
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await fetch("/api/library/video-playback-status", { cache: "no-store", credentials: "same-origin" });
        if (await token()) return;
      }
      throw new Error("playback_processing_timeout");
    } catch { setState("failed"); }
  };
  if (iframeUrl) return <iframe className="private-stream-player" src={iframeUrl} title="Private video playback" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />;
  return <div className="native-video-playback-control"><button className="copy-attributes" type="button" disabled={state === "working"} onClick={() => void open()}>{state === "working" ? "Preparing private playback…" : "Play private video"}</button>{state === "failed" && <small>Private playback is still preparing or unavailable. The original remains unchanged.</small>}</div>;
}
