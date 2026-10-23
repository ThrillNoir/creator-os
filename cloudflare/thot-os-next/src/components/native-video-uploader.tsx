"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { sha256File } from "@/lib/incremental-sha256";
import { canonicalR2MultipartPartEtag } from "@/lib/r2-multipart-etag";
import { UploaderBatchReview } from "@/components/uploader-batch-review";

const maxFiles = 4;
const maxBytes = 5 * 1024 * 1024 * 1024;
const mimeByExtension: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime" };
type UploadItem = { id: string; file: File; status: "queued" | "hashing" | "uploading" | "finalizing" | "complete" | "failed"; detail: string; progress: number; assetId?: string; sourceHash?: string };
type IntentResponse = { ok?: boolean; error?: string; sessionId?: string; assetId?: string; partBytes?: number; replay?: boolean; status?: string; playback?: string; sourceCodec?: string; uploadUrl?: string; expiresAt?: string; partNumber?: number };

function mimeFor(file: File) { const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : ""; return mimeByExtension[extension] ?? ""; }
async function payload<T>(response: Response): Promise<T> { return response.json().catch(() => ({})) as Promise<T>; }
function messageFor(error: string) {
  return ({
    invalid_intent: "Use an MP4 or MOV video within the private upload limit.",
    active_video_upload_limit: "Finish or let an existing video upload expire before starting another.",
    idempotency_conflict: "This saved upload ID belongs to a different file. Choose the file again.",
    session_expired: "Upload expired—try again.",
    session_aborted: "This upload was cancelled. Start this video again.",
    session_failed: "That upload could not be resumed. Start this video again.",
    direct_video_upload_unavailable: "Direct private video uploads are not configured yet. Try again after staging setup is complete.",
    direct_part_upload_failed: "That video part did not reach private storage. You can retry this file.",
    completion_requires_reconciliation: "Verification was interrupted. Choose this same video again to retry finalization.",
    session_finalizing: "Verification was interrupted. Choose this same video again to retry finalization.",
    source_media_container_invalid: "The uploaded file is not a valid MP4 or MOV container.",
    source_media_type_unsupported: "The uploaded object is not a supported MP4 or MOV video.",
    source_media_video_codec_unsupported: "This video container is valid, but its H.264 or H.265 codec could not be verified.",
    source_media_byte_mismatch: "The completed R2 object did not match the selected video's verified byte count.",
    source_media_metadata_mismatch: "The completed R2 object metadata did not match this upload session.",
  } as Record<string, string>)[error] ?? "Video upload failed. You can retry this file without changing its source.";
}

export function NativeVideoUploader() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const running = useRef(false); const input = useRef<HTMLInputElement>(null); const router = useRouter();
  const update = (id: string, patch: Partial<UploadItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const storageKey = (hash: string) => `creator-os:native-video:${hash}`;

  const releasePart = async (sessionId: string, partNumber: number) => {
    await fetch(`/api/source-media/videos/intents/${sessionId}/parts/${partNumber}/failure`, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  };

  const uploadPartDirectly = async (sessionId: string, partNumber: number, part: Blob) => {
    const authorization = await fetch(`/api/source-media/videos/intents/${sessionId}/parts/${partNumber}/authorize`, { method: "POST", credentials: "same-origin" });
    const authorized = await payload<IntentResponse>(authorization);
    if (!authorization.ok || !authorized.ok) throw new Error(authorized.error ?? "direct_part_upload_failed");
    if (authorized.replay) return;
    if (!authorized.uploadUrl) throw new Error("direct_part_upload_failed");
    const put = await fetch(authorized.uploadUrl, { method: "PUT", credentials: "omit", headers: { "content-type": part.type }, body: part });
    const etag = canonicalR2MultipartPartEtag(put.headers.get("etag"));
    if (!put.ok || !etag) { await releasePart(sessionId, partNumber); throw new Error("direct_part_upload_failed"); }
    const confirmation = await fetch(`/api/source-media/videos/intents/${sessionId}/parts/${partNumber}/confirm`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ etag }) });
    const confirmed = await payload<IntentResponse>(confirmation);
    if (!confirmation.ok || !confirmed.ok) throw new Error(confirmed.error ?? "direct_part_upload_failed");
  };

  const upload = async (item: UploadItem) => {
    const mimeType = mimeFor(item.file);
    if (!mimeType || item.file.size <= 0 || item.file.size > maxBytes) { update(item.id, { status: "failed", detail: !mimeType ? "Use an MP4 or MOV video." : "Videos must be 5 GB or smaller." }); return; }
    let sourceHash = "";
    try {
      update(item.id, { status: "hashing", detail: "Verifying the selected video before upload…", progress: 0 });
      sourceHash = await sha256File(item.file, (completed) => update(item.id, { progress: Math.max(1, Math.round((completed / item.file.size) * 18)), detail: "Verifying the selected video before upload…" }));
      const saved = sessionStorage.getItem(storageKey(sourceHash)); const clientUploadId = saved || crypto.randomUUID();
      if (!saved) sessionStorage.setItem(storageKey(sourceHash), clientUploadId);
      const intentResponse = await fetch("/api/source-media/videos/intents", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: item.file.name, bytes: item.file.size, sha256: sourceHash, mimeType, clientUploadId }) });
      const intent = await payload<IntentResponse>(intentResponse);
      if (!intentResponse.ok || !intent.ok || !intent.sessionId || !intent.partBytes) throw new Error(intent.error ?? "intent_failed");
      update(item.id, { assetId: intent.assetId, sourceHash, status: "uploading", detail: intent.replay ? "Resuming private R2 upload…" : "Uploading directly to private Cloudflare storage…" });
      if (!["finalized", "finalizing"].includes(intent.status ?? "")) {
        const partCount = Math.ceil(item.file.size / intent.partBytes);
        for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
          const start = (partNumber - 1) * intent.partBytes;
          const part = item.file.slice(start, Math.min(start + intent.partBytes, item.file.size), mimeType);
          await uploadPartDirectly(intent.sessionId, partNumber, part);
          update(item.id, { progress: 18 + Math.round((partNumber / partCount) * 74), detail: `Uploading private canonical original · ${partNumber} of ${partCount}` });
        }
      }
      update(item.id, { status: "finalizing", detail: "Verifying canonical bytes and codec…", progress: 95 });
      const finalizeResponse = await fetch(`/api/source-media/videos/intents/${intent.sessionId}/finalize`, { method: "POST", credentials: "same-origin" });
      const finalized = await payload<IntentResponse>(finalizeResponse);
      if (!finalizeResponse.ok || !finalized.ok) throw new Error(finalized.error ?? "session_finalizing");
      sessionStorage.removeItem(storageKey(sourceHash));
      update(item.id, { status: "complete", detail: finalized.playback === "ready" ? "Private original and browser playback are ready." : `Private ${finalized.sourceCodec?.toUpperCase() ?? "video"} original is verified. Cross-browser playback is awaiting the approved Stream provider.`, progress: 100 });
      router.refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "upload_failed";
      if (["session_expired", "session_aborted", "session_failed"].includes(code) && sourceHash) sessionStorage.removeItem(storageKey(sourceHash));
      update(item.id, { status: "failed", detail: messageFor(code) });
    }
  };

  const start = async () => { if (running.current) return; running.current = true; try { for (const item of items.filter((candidate) => candidate.status === "queued" || candidate.status === "failed")) await upload(item); } finally { running.current = false; } };
  const addFiles = (files: File[]) => { const next = files.slice(0, Math.max(0, maxFiles - items.length)).map((file) => ({ id: crypto.randomUUID(), file, status: "queued" as const, detail: "Ready to upload", progress: 0 })); if (next.length) setItems((current) => [...current, ...next]); };
  const onDrop = (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); addFiles([...event.dataTransfer.files]); };

  return <section className="native-media-uploader panel" aria-label="Upload private source videos">
    <div className="native-media-uploader-copy"><span className="eyebrow">VIDEOS</span><h2>Add videos</h2><p>MP4 and MOV originals stay private. H.264 and H.265 files are kept as uploaded; browser playback may need separate preparation.</p></div>
    <input ref={input} className="sr-only" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" multiple onChange={(event) => { addFiles([...event.target.files ?? []]); event.currentTarget.value = ""; }} />
    <button className="native-drop-zone" type="button" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} disabled={running.current}><b>Drop up to {maxFiles} videos here</b><span>or choose MP4 or MOV files · 5 GB each</span></button>
    {items.length > 0 && <div className="native-upload-list">{items.map((item) => <article key={item.id} className={`native-upload-item ${item.status}`}><div><strong>{item.file.name}</strong><small>{Math.round(item.file.size / (1024 * 1024))} MB · {item.detail}</small></div><progress max="100" value={item.progress}>{item.progress}%</progress></article>)}</div>}
    <div className="native-upload-actions"><small>An interrupted upload can resume while its private session is valid.</small><button className="primary" type="button" disabled={running.current || !items.some((item) => item.status === "queued" || item.status === "failed")} onClick={() => void start()}>Upload selected videos</button></div>
    <UploaderBatchReview items={items.filter((item): item is UploadItem & { assetId: string } => Boolean(item.assetId) && item.status === "complete").map((item) => ({ assetId: item.assetId, name: item.file.name }))} />
  </section>;
}
