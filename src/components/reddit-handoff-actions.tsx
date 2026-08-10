"use client";

import { useState } from "react";

export function RedditHandoffActions({
  title,
  body,
  media,
  submitUrl,
}: {
  title: string;
  body: string;
  media: Array<{ url: string; filename: string }>;
  submitUrl: string;
}) {
  const [message, setMessage] = useState("");
  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied.`);
  }
  return (
    <div className="reddit-handoff-actions">
      <button onClick={() => copy(title, "Title")}>Copy Reddit title</button>
      <button onClick={() => copy(body, "Caption")}>Copy caption</button>
      {media.map((item, index) => <a href={`${item.url}?download=1`} download key={item.url}>Download {media.length > 1 ? `image ${index + 1}` : "media"}</a>)}
      <a className="dark" href={submitUrl} target="_blank" rel="noreferrer">Open subreddit composer ↗</a>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
