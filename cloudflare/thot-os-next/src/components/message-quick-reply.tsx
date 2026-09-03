"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef("");
  const router = useRouter();
  const config = platformConfig[platform];
  const inputId = `${platform}-quick-reply-body`;
  const send = async (form: HTMLFormElement) => {
    const requestId = form.elements.namedItem("clientRequestId");
    const clientRequestId = requestIdRef.current || crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    if (requestId instanceof HTMLInputElement) requestId.value = clientRequestId;
    const formData = new FormData(form);
    formData.set("clientRequestId", clientRequestId);
    formData.set("inline", "1");
    setSending(true);
    setError(null);
    try {
      const result = await config.action(formData) as { ok?: boolean; saved?: string; error?: string } | void;
      if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
        setError("The reply outcome was not confirmed. Check the receipt before trying again.");
        return;
      }
      if (result.ok) {
        setBody("");
        requestIdRef.current = "";
      } else {
        setError(result.error || "The reply was not confirmed. Review the receipt before trying again.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reply could not be completed. Check the connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return <form className="reply-compose quick-reply" onSubmit={(event) => {
    event.preventDefault();
    if (!sending) void send(event.currentTarget);
  }}>
    <input type="hidden" name="threadId" value={threadId} />
    <input type="hidden" name="inline" value="1" />
    <input type="hidden" name="clientRequestId" defaultValue="" />
    <label htmlFor={inputId}>Reply</label>
    <textarea id={inputId} name={config.field} value={body} required maxLength={config.maximum} placeholder={`Write a reply to ${participant}…`} onChange={(event) => setBody(event.currentTarget.value)} onKeyDown={(event) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (!sending && body.trim()) event.currentTarget.form?.requestSubmit();
    }} />
    {error && <div className="reply-error quick-reply-error" role="alert">{error}</div>}
    <div><small aria-live="polite">{sending ? platform === "fansly" ? "Queuing…" : "Sending…" : "Enter to send · Shift+Enter for a new line · receipt recorded"}</small><button className="primary" type="submit" disabled={sending}>{sending ? platform === "fansly" ? "Queuing…" : "Sending…" : "Send"}</button></div>
  </form>;
}
