"use client";

import { useRef, useState } from "react";
import { sendFanslyReplyAction, sendInstagramQuickReplyAction, sendTelegramCreatorMessageAction } from "@/app/actions";

type QuickReplyPlatform = "instagram" | "telegram" | "fansly";

const platformConfig = {
  instagram: { action: sendInstagramQuickReplyAction, field: "body", maximum: 1000 },
  telegram: { action: sendTelegramCreatorMessageAction, field: "message", maximum: 4096 },
  fansly: { action: sendFanslyReplyAction, field: "body", maximum: 2000 },
} as const;

export function MessageQuickReply({ platform, threadId, participant }: { platform: QuickReplyPlatform; threadId: string; participant: string }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const requestIdRef = useRef("");
  const config = platformConfig[platform];
  const inputId = `${platform}-quick-reply-body`;

  return <form action={config.action} className="reply-compose quick-reply" onSubmit={(event) => {
    const requestId = event.currentTarget.elements.namedItem("clientRequestId");
    const clientRequestId = requestIdRef.current || crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    if (requestId instanceof HTMLInputElement) requestId.value = clientRequestId;
    setSending(true);
  }}>
    <input type="hidden" name="threadId" value={threadId} />
    <input type="hidden" name="clientRequestId" defaultValue="" />
    <label htmlFor={inputId}>Reply</label>
    <textarea id={inputId} name={config.field} value={body} required maxLength={config.maximum} placeholder={`Write a reply to ${participant}…`} onChange={(event) => setBody(event.currentTarget.value)} onKeyDown={(event) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (!sending && body.trim()) event.currentTarget.form?.requestSubmit();
    }} />
    <div><small aria-live="polite">{sending ? platform === "fansly" ? "Queuing…" : "Sending…" : "Enter to send · Shift+Enter for a new line · receipt recorded"}</small><button className="primary" type="submit" disabled={sending}>{sending ? platform === "fansly" ? "Queuing…" : "Sending…" : "Send"}</button></div>
  </form>;
}
