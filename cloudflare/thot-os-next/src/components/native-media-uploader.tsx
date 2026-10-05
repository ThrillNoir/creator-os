"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";

const maxFiles = 20;
const maxBytes = 64 * 1024 * 1024;
const mimeByExtension: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

type UploadItem = { id: string; file: File; status: "queued" | "hashing" | "uploading" | "finalizing" | "complete" | "attention" | "failed"; detail: string; progress: number; sessionId?: string; sourceHash?: string };
type IntentResponse = { ok?: boolean; error?: string; sessionId?: string; assetId?: string; partBytes?: number; replay?: boolean; status?: string; finalizationState?: string };
type FinalizeResponse = { ok?: boolean; error?: string; preview?: "ready" | "failed" | "not_requested" };

function mimeFor(file: File) {
  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
  return mimeByExtension[extension] ?? "";
}

async function digest(file: File) {
  const value = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function payload<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}

type FinalizeRecoveryDependencies = {
  fetcher: typeof fetch;
  parse: (response: Response) => Promise<FinalizeResponse>;
  update: (id: string, patch: Partial<UploadItem>) => void;
  removeSession: (hash: string) => void;
  refresh: () => void;
};

export async function finalizeSavedNativeImage(item: UploadItem, sessionId: string, sourceHash: string, detail: string, dependencies: FinalizeRecoveryDependencies) {
  const response = await dependencies.fetcher(`/api/source-media/intents/${sessionId}/finalize`, { method: "POST", credentials: "same-origin" });
  const result = await dependencies.parse(response);
  if (!response.ok || !result.ok) throw new Error(result.error ?? "native_preview_failed");
  if (result.preview === "ready") {
    dependencies.removeSession(sourceHash);
    dependencies.update(item.id, { status: "complete", detail: "Private original and preview are ready.", progress: 100 });
  } else dependencies.update(item.id, { status: "attention", detail, progress: 100 });
  // Finalize has safely saved the original even when preview creation needs another attempt.
  dependencies.refresh();
  return result;
}

export async function retryNativeImagePreview(item: UploadItem, dependencies: FinalizeRecoveryDependencies) {
  if (!item.sessionId) return;
  dependencies.update(item.id, { status: "finalizing", detail: "Retrying private preview…" });
  try {
    await finalizeSavedNativeImage(item, item.sessionId, item.sourceHash ?? "", "Original saved privately; the preview is still unavailable.", dependencies);
  } catch {
    dependencies.update(item.id, { status: "attention", detail: "The original is safe in private storage, but its preview retry failed. Retry the preview again when available." });
  }
}

const resumeFinalizationStates = new Set(["completing", "completed_unreconciled", "verifying", "verified"]);
const terminalFinalizationStates = new Set(["failed", "quarantined", "expired", "aborted"]);

/** Reconcile a replayed image session before attempting any part PUTs. */
export async function resumeNativeImageIntent(
  item: UploadItem,
  intent: IntentResponse,
  sourceHash: string,
  dependencies: FinalizeRecoveryDependencies,
  uploadParts: () => Promise<void>,
) {
  const state = intent.finalizationState;
  if (state && terminalFinalizationStates.has(state)) throw new Error(`session_${state}`);
  if (intent.status === "finalized" || (state && resumeFinalizationStates.has(state))) {
    dependencies.update(item.id, { status: "finalizing", detail: "Reconciling the saved original and private preview…", progress: 95 });
    await finalizeSavedNativeImage(item, intent.sessionId ?? "", sourceHash, "Original saved privately; the preview needs a retry.", dependencies);
    return "finalized" as const;
  }
  await uploadParts();
  return "uploaded" as const;
}

function messageFor(error: string) {
  return ({
    invalid_intent: "This file is not a supported image.",
    idempotency_conflict: "This upload ID belongs to a different file. Choose the file again.",
    session_expired: "The upload session expired. Start this file again.",
    session_failed: "This upload session failed and cannot be resumed.",
    session_quarantined: "This file was quarantined during verification and cannot be resumed.",
    session_aborted: "This upload session was stopped and cannot be resumed.",
    source_media_verification_failed: "The uploaded bytes did not match the selected file.",
    native_preview_failed: "The original is safe in private storage, but its preview needs a retry.",
  } as Record<string, string>)[error] ?? "Upload failed. You can retry this file without changing its source.";
}

export function NativeMediaUploader() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const running = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const update = (id: string, patch: Partial<UploadItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const storageKey = (hash: string) => `creator-os:native-image:${hash}`;

  const finalizeDependencies: FinalizeRecoveryDependencies = {
    fetcher: fetch,
    parse: (response) => payload<FinalizeResponse>(response),
    update,
    removeSession: (hash) => { if (hash) sessionStorage.removeItem(storageKey(hash)); },
    refresh: () => router.refresh(),
  };

  const upload = async (item: UploadItem) => {
    const mimeType = mimeFor(item.file);
    if (!mimeType || item.file.size <= 0 || item.file.size > maxBytes) {
      update(item.id, { status: "failed", detail: !mimeType ? "Use a JPEG, PNG, WebP, or HEIC image." : "Images must be 64 MB or smaller." });
      return;
    }
    let sourceHash = "";
    try {
      update(item.id, { status: "hashing", detail: "Verifying this file before upload…", progress: 0 });
      sourceHash = await digest(item.file);
      const stored = sessionStorage.getItem(storageKey(sourceHash));
      const clientUploadId = stored || crypto.randomUUID();
      if (!stored) sessionStorage.setItem(storageKey(sourceHash), clientUploadId);
      const intentResponse = await fetch("/api/source-media/native/intents", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: item.file.name, bytes: item.file.size, sha256: sourceHash, mimeType, clientUploadId }),
      });
      const intent = await payload<IntentResponse>(intentResponse);
      if (!intentResponse.ok || !intent.ok || !intent.sessionId) throw new Error(intent.error ?? "intent_failed");
      update(item.id, { sessionId: intent.sessionId, sourceHash, status: "uploading", detail: intent.replay ? "Resuming private upload…" : "Uploading directly to private storage…" });
      await resumeNativeImageIntent(item, intent, sourceHash, finalizeDependencies, async () => {
        if (!intent.partBytes) throw new Error("intent_missing_part_size");
        const partCount = Math.ceil(item.file.size / intent.partBytes);
        for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
          const start = (partNumber - 1) * intent.partBytes;
          const part = item.file.slice(start, Math.min(start + intent.partBytes, item.file.size), mimeType);
          const response = await fetch(`/api/source-media/intents/${intent.sessionId}/parts/${partNumber}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": mimeType }, body: part });
          const result = await payload<IntentResponse>(response);
          if (!response.ok || !result.ok) throw new Error(result.error ?? "part_upload_failed");
          update(item.id, { progress: Math.round((partNumber / partCount) * 92), detail: `Uploading private original · ${partNumber} of ${partCount}` });
        }
        update(item.id, { status: "finalizing", detail: "Verifying the original and creating a private preview…", progress: 95 });
        await finalizeSavedNativeImage(item, intent.sessionId!, sourceHash, "Original saved privately; the preview needs a retry.", finalizeDependencies);
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "upload_failed";
      if (code === "session_expired" && sourceHash) sessionStorage.removeItem(storageKey(sourceHash));
      update(item.id, { status: "failed", detail: messageFor(code) });
    }
  };

  const start = async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (const item of items.filter((candidate) => candidate.status === "queued" || candidate.status === "failed")) await upload(item);
    } finally { running.current = false; }
  };

  const addFiles = (files: File[]) => {
    const available = Math.max(0, maxFiles - items.length);
    const next = files.slice(0, available).map((file) => ({ id: crypto.randomUUID(), file, status: "queued" as const, detail: "Ready to upload", progress: 0 }));
    if (next.length) setItems((current) => [...current, ...next]);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  };

  return <section className="native-media-uploader panel" aria-label="Upload private source images">
    <div className="native-media-uploader-copy"><span className="eyebrow">CLOUDFLARE-NATIVE</span><h2>Upload source images</h2><p>New files go directly to private creator-scoped R2 storage.</p></div>
    <input ref={input} className="sr-only" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,image/jpeg,image/png,image/webp,image/heic" multiple onChange={(event) => { addFiles([...event.target.files ?? []]); event.currentTarget.value = ""; }} />
    <button className="native-drop-zone" type="button" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} disabled={running.current}>
      <b>Drop up to {maxFiles} images here</b><span>or choose JPEG, PNG, WebP, or HEIC files · 64 MB each</span>
    </button>
    {items.length > 0 && <div className="native-upload-list">{items.map((item) => <article key={item.id} className={`native-upload-item ${item.status}`}><div><strong>{item.file.name}</strong><small>{Math.round(item.file.size / 1024)} KB · {item.detail}</small></div><progress max="100" value={item.progress}>{item.progress}%</progress>{item.status === "attention" ? <button className="secondary-action" type="button" onClick={() => void retryNativeImagePreview(item, finalizeDependencies)}>Retry preview</button> : null}</article>)}</div>}
    <div className="native-upload-actions"><small>Uploads are resumable while their private session remains valid. Original keys and multipart identifiers never reach the browser.</small><button className="primary" type="button" disabled={running.current || !items.some((item) => item.status === "queued" || item.status === "failed")} onClick={() => void start()}>Upload selected images</button></div>
  </section>;
}
