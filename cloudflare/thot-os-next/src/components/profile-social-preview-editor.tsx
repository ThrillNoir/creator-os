"use client";

import { useState } from "react";

export function ProfileSocialPreviewEditor({ versionId, editableVersionId, enabled }: { versionId: string | undefined; editableVersionId: string | undefined; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [hasImage, setHasImage] = useState(true);
  const url = versionId ? `/api/profile-social-preview?versionId=${encodeURIComponent(versionId)}&v=${revision}` : "";
  return <section className="wide" aria-label="Link preview image">
    <div className="section-heading"><div><b>Link preview image</b><p>This 1200 × 630 PNG appears when your public creator URL is shared. Save the profile first, then add an image to its private draft. The branded image is used if you skip this step.</p></div></div>
    {url && hasImage && <img src={url} alt="Your uploaded social preview" width={600} height={315} onError={() => setHasImage(false)} style={{ width: "min(100%, 600px)", height: "auto" }} />}
    <label>Choose a 1200 × 630 PNG
      <input type="file" accept="image/png" disabled={!editableVersionId || !enabled || busy} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file || !editableVersionId) return;
        if (file.size > 8 * 1024 * 1024) { setNotice("Choose a PNG smaller than 8 MB."); return; }
        void (async () => {
          setBusy(true); setNotice("");
          try {
            const form = new FormData(); form.set("file", file); form.set("versionId", editableVersionId);
            const response = await fetch("/api/profile-social-preview", { method: "POST", body: form });
            const result = await response.json() as { ok?: boolean; error?: string };
            if (!response.ok || !result.ok) throw new Error(result.error === "image_must_be_1200_by_630_png" ? "The image must be a 1200 × 630 PNG." : "The preview could not be saved. Please try again.");
            setHasImage(true); setRevision((value) => value + 1); setNotice("Preview saved to this private draft. It goes live only when you publish the profile.");
          } catch (error) { setNotice(error instanceof Error ? error.message : "The preview could not be saved."); }
          finally { setBusy(false); }
        })();
      }} />
    </label>
    {!versionId && <p>Save this profile before uploading a link preview.</p>}
    {versionId && !editableVersionId && <p>Save a new draft to replace this preview image.</p>}
    {!enabled && <p>Image processing is unavailable in this environment.</p>}
    {busy && <p role="status">Preparing preview…</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
