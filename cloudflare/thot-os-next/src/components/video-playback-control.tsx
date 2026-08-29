"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function VideoPlaybackControl({ assetId }: { assetId: string }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const router = useRouter();
  const start = async () => {
    if (state === "working") return;
    setState("working");
    try {
      const response = await fetch(`/api/source-media/videos/${assetId}/playback`, { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { ok?: boolean };
      if (!response.ok || body.ok !== true) throw new Error("playback_start_failed");
      router.refresh();
    } catch { setState("failed"); }
  };
  return <div className="native-video-playback-control"><button className="copy-attributes" type="button" disabled={state === "working"} onClick={() => void start()}>{state === "working" ? "Preparing browser playback…" : "Prepare browser playback"}</button>{state === "failed" && <small>Playback preparation could not start. The private original remains unchanged.</small>}</div>;
}
