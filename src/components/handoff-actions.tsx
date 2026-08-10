"use client";

import { useState } from "react";

export function HandoffActions({
  media,
  caption,
  platformUrl,
  platform,
  actionLabel,
}: {
  media: Array<{ url: string; filename: string }>;
  caption: string;
  platformUrl: string;
  platform: string;
  actionLabel?: string;
}) {
  const [message, setMessage] = useState("");
  const [accountConfirmed, setAccountConfirmed] = useState(false);

  async function copyCaption() {
    if (!caption) {
      setMessage("This package has no caption yet.");
      return;
    }
    await navigator.clipboard.writeText(caption);
    setMessage("Caption copied.");
  }

  async function shareToApps() {
    if (!accountConfirmed) {
      setMessage("Confirm the logged-in destination account first.");
      return;
    }
    try {
      const files = await Promise.all(media.map(async (item) => {
        const response = await fetch(item.url);
        if (!response.ok) throw new Error("Media could not be loaded.");
        return new File([await response.blob()], item.filename, {
          type: response.headers.get("content-type") ?? "image/jpeg",
        });
      }));
      if (!navigator.share || !navigator.canShare?.({ files })) {
        setMessage("File sharing is not supported in this browser. Download the image instead.");
        return;
      }
      await navigator.share({
        files,
        text: caption || undefined,
        title: `Post to ${platform}`,
      });
      setMessage("Shared to your selected app.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "Sharing failed.");
    }
  }

  return (
    <div className="handoff-actions">
      <label className="account-confirmation"><input type="checkbox" checked={accountConfirmed} onChange={(event) => setAccountConfirmed(event.target.checked)} /> I am logged into the correct {platform} account</label>
      <button className="primary-button" disabled={!accountConfirmed} onClick={shareToApps}>Share media to apps</button>
      {media.map((item, index) => <a className="handoff-button" href={`${item.url}?download=1`} download key={item.url}>Download {media.length > 1 ? `image ${index + 1}` : "media"}</a>)}
      <button className="handoff-button" onClick={copyCaption}>Copy caption</button>
      {accountConfirmed ? <a className="handoff-button dark" href={platformUrl} target="_blank" rel="noreferrer">{actionLabel || `Open ${platform}`} ↗</a> : <span className="handoff-button disabled">Confirm account to continue</span>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
