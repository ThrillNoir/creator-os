"use client";

import { useState } from "react";

export function PrivateStreamPlayer({ assetId }: { assetId: string }) {
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    try {
      const response = await fetch(`/api/source-media/videos/${assetId}/playback-token`, { cache: "no-store", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; iframeUrl?: unknown };
      if (!response.ok || body.ok !== true || typeof body.iframeUrl !== "string") throw new Error("playback_token_unavailable");
      setIframeUrl(body.iframeUrl);
    } catch { setFailed(true); }
  };
  if (iframeUrl) return <iframe className="private-stream-player" src={iframeUrl} title="Private video playback" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />;
  return <div className="native-video-playback-control"><button className="copy-attributes" type="button" onClick={() => void open()}>Play private video</button>{failed && <small>Private playback is temporarily unavailable. The original remains available for download.</small>}</div>;
}
