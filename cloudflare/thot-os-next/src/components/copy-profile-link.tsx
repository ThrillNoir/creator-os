"use client";

import { useState } from "react";

type Props = {
  title: string;
  detail: string;
  url: string;
};

export function CopyProfileLink({ title, detail, url }: Props) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("manual");
    }
  }

  return <section className="copy-profile-link" aria-label={title}>
    <div>
      <b>{title}</b>
      <span>{detail}</span>
    </div>
    <label>
      <span className="sr-only">{title}</span>
      <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
    </label>
    <button className="secondary-action" type="button" onClick={() => void copyLink()}>{status === "copied" ? "Copied" : "Copy link"}</button>
    <span className="copy-profile-link-status" role="status" aria-live="polite">{status === "copied" ? "Copied to clipboard." : status === "manual" ? "Select the link field and copy it manually." : ""}</span>
  </section>;
}
