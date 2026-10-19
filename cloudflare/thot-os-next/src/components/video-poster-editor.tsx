"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { verifiedVideoPreviewUrl } from "@/lib/verified-video-preview";

const MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export function VideoPosterEditor({ assetId, posterUrl, label = "Video thumbnail" }: {
  assetId: string;
  posterUrl?: string | null;
  label?: string;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFile) { setUploadPreview(null); return; }
    const url = URL.createObjectURL(selectedFile);
    setUploadPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  async function save(blob: Blob) {
    if (!blob.size || blob.size > MAX_BYTES) { setMessage("Choose an image smaller than 12 MB."); return; }
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch(`/api/source-media/videos/${encodeURIComponent(assetId)}/poster`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": blob.type }, body: blob,
      });
      if (!response.ok) throw new Error("save_failed");
      setMessage("Private thumbnail saved.");
      setSelectedFile(null);
      setOpen(false);
      router.refresh();
    } catch { setMessage("The thumbnail could not be saved. Try again; the video is unchanged."); }
    finally { setWorking(false); }
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setMessage("Play or scrub to the frame you want first.");
      return;
    }
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) { setMessage("Frame capture is unavailable in this browser. Upload an image instead."); return; }
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .85));
      if (!blob) throw new Error("capture_failed");
      await save(blob);
    } catch { setMessage("This frame could not be captured. Upload an image instead."); }
  }

  return <div className="video-poster-editor">
    <div className="video-poster-current"><div>{posterUrl ? <img alt={`Current private ${label.toLowerCase()}`} src={posterUrl} /> : <span>No thumbnail yet</span>}</div><div><strong>{label}</strong><small>Private draft image. Public use needs separate approval.</small></div><button className="secondary-action" onClick={() => { setOpen(!open); setSelectedFile(null); setMessage(""); }} type="button">{open ? "Close" : posterUrl ? "Change thumbnail" : "Choose thumbnail"}</button></div>
    {open && <div className="video-poster-choices"><div><p>Play or scrub the private video to a frame, then save it as the thumbnail.</p><video aria-label="Scrub video to choose thumbnail" controls playsInline preload="metadata" ref={videoRef} src={verifiedVideoPreviewUrl(assetId)} onError={() => setMessage("This browser cannot load the video. You can upload an image instead.")} /><button disabled={working} onClick={() => void captureFrame()} type="button">Use current frame</button></div><div className="video-poster-upload"><label>Or upload a thumbnail image<input accept="image/jpeg,image/png,image/webp,image/avif" disabled={working} type="file" onChange={(event) => { const file = event.target.files?.[0]; const valid = file && file.size <= MAX_BYTES && IMAGE_TYPES.has(file.type); setSelectedFile(valid ? file : null); setMessage(file && !valid ? "Choose a JPEG, PNG, WebP or AVIF image smaller than 12 MB." : ""); event.target.value = ""; }} /></label>{uploadPreview && selectedFile && <div className="video-poster-upload-review"><img alt="Thumbnail image awaiting confirmation" src={uploadPreview} /><div><button disabled={working} onClick={() => void save(selectedFile)} type="button">Save thumbnail</button><button className="secondary-action" disabled={working} onClick={() => setSelectedFile(null)} type="button">Cancel</button></div></div>}</div></div>}
    {working && <p aria-live="polite">Saving private thumbnail…</p>}
    {!working && message && <p aria-live="polite">{message}</p>}
  </div>;
}
