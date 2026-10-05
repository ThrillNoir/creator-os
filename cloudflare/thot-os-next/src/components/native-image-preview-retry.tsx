"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export async function retrySavedNativePreview(sessionId: string, fetcher: typeof fetch, refresh: () => void) {
  const response = await fetcher(`/api/source-media/intents/${sessionId}/finalize`, { method: "POST", credentials: "same-origin" });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; preview?: string };
  if (!response.ok || !result.ok) throw new Error("preview_retry_unavailable");
  refresh();
  return result.preview === "ready";
}

export function NativeImagePreviewRetry({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("Your original is saved privately. Retry its preview without uploading again.");
  const retry = async () => {
    if (pending) return;
    setPending(true);
    try {
      const ready = await retrySavedNativePreview(sessionId, fetch, () => router.refresh());
      setMessage(ready ? "Private preview is ready." : "Your original is saved. The preview is still unavailable; you can retry later.");
    } catch {
      setMessage("Preview retry could not finish. Your saved original remains available; retry when the service is available.");
    } finally { setPending(false); }
  };
  return <div><p role="status">{message}</p><button className="secondary-action" type="button" disabled={pending} onClick={() => void retry()}>{pending ? "Retrying preview…" : "Retry private preview"}</button></div>;
}
