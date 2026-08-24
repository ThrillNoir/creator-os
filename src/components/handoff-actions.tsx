"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HandoffActions({
  media,
  caption,
  platformUrl,
  platform,
  actionLabel,
}: {
  media: Array<{ url: string; filename: string; available: boolean }>;
  caption: string;
  platformUrl: string;
  platform: string;
  actionLabel?: string;
}) {
  const [message, setMessage] = useState("");
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const mediaAvailable = media.length > 0 && media.every((item) => item.available);

  async function copyCaption() {
    if (!caption) {
      setMessage("This package has no caption yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(caption);
      setMessage("Caption copied. THOT OS has not marked the package published.");
    } catch {
      setMessage("Caption could not be copied in this browser. Select and copy it from the approved caption field.");
    }
  }

  async function shareToApps() {
    if (!accountConfirmed || !mediaAvailable) {
      setMessage(mediaAvailable ? "Confirm the logged-in destination account first." : "Source media is unavailable locally. Restore it before sharing this package.");
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
      setMessage("Shared to your selected app. THOT OS has not marked the package published.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "Sharing failed.");
    }
  }

  return (
    <section className="workflow-handoff-actions" aria-label="Approved handoff actions">
      <label className="workflow-account-confirmation">
        <input checked={accountConfirmed} onChange={(event) => setAccountConfirmed(event.target.checked)} type="checkbox" />
        <span>I am logged into the correct {platform} account.</span>
      </label>
      <Button className="workflow-share-button" disabled={!accountConfirmed || !mediaAvailable} onClick={shareToApps} type="button"><Share2 aria-hidden="true" />Share media to apps</Button>
      {media.map((item, index) => item.available ? <Button asChild key={item.url} size="sm" variant="outline"><a download href={`${item.url}?download=1`}><Download aria-hidden="true" />Download {media.length > 1 ? `media ${index + 1}` : "media"}</a></Button> : <Button disabled key={item.url} size="sm" type="button" variant="outline"><Download aria-hidden="true" />Source unavailable</Button>)}
      <Button onClick={copyCaption} size="sm" type="button" variant="outline"><Copy aria-hidden="true" />Copy caption</Button>
      {accountConfirmed && mediaAvailable ? <Button asChild className="workflow-platform-button" variant="secondary"><a href={platformUrl} rel="noreferrer" target="_blank">{actionLabel || `Open ${platform}`}<ExternalLink aria-hidden="true" /></a></Button> : <Button className="workflow-platform-button" disabled type="button" variant="secondary"><CheckCircle2 aria-hidden="true" />{mediaAvailable ? "Confirm account to open platform" : "Restore source media to continue"}</Button>}
      {message ? <p aria-live="polite" role="status">{message}</p> : null}
    </section>
  );
}
