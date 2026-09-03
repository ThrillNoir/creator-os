"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendFanslyReplyAction, sendInstagramQuickReplyAction, sendTelegramCreatorMessageAction } from "@/app/actions";
import { MessageAttachmentPicker, type MessageReplyAsset } from "@/components/message-attachment-picker";

type QuickReplyPlatform = "instagram" | "telegram" | "fansly";

export function confirmMessageNavigation() {
  return window.dispatchEvent(new Event("message:navigate", { cancelable: true }));
}

const platformConfig = {
  instagram: { action: sendInstagramQuickReplyAction, field: "body", maximum: 1000 },
  telegram: { action: sendTelegramCreatorMessageAction, field: "message", maximum: 4096 },
  fansly: { action: sendFanslyReplyAction, field: "body", maximum: 2000 },
} as const;

export function MessageQuickReply({ platform, threadId, participant, assets = [] }: { platform: QuickReplyPlatform; threadId: string; participant: string; assets?: MessageReplyAsset[] }) {
  const [body, setBody] = useState("");
  const [assetId, setAssetId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef("");
  const intentKeyRef = useRef<string | null>(null);
  const retryRequestRef = useRef(false);
  const router = useRouter();
  const config = platformConfig[platform];
  const inputId = `${platform}-quick-reply-body`;
  const dirty = Boolean(body.trim() || assetId || sending);
  useEffect(() => {
    if (!dirty) return;
    const confirm = (event: Event) => {
      if (!window.confirm(sending ? "A reply is still sending. Leave this conversation and check its receipt later?" : "Discard this unsent reply?")) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const target = new URL(link.href);
      if (target.pathname === location.pathname && target.search === location.search) return;
      if (!confirmMessageNavigation()) { event.preventDefault(); event.stopPropagation(); }
    };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("message:navigate", confirm);
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("message:navigate", confirm); document.removeEventListener("click", click, true); window.removeEventListener("beforeunload", unload); };
  }, [dirty, sending]);
  const send = async (form: HTMLFormElement) => {
    if (platform === "instagram" && assetId && body.trim()) {
      setError("Send this photo or video on its own. Remove the text or attachment first.");
      return;
    }
    const requestId = form.elements.namedItem("clientRequestId");
    const formData = new FormData(form);
    const intentKey = `${body}\u0000${String(formData.get("assetId") ?? "")}`;
    const clientRequestId = !retryRequestRef.current && requestIdRef.current && intentKeyRef.current === intentKey ? requestIdRef.current : crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    intentKeyRef.current = intentKey;
    retryRequestRef.current = false;
    if (requestId instanceof HTMLInputElement) requestId.value = clientRequestId;
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
        setAssetId("");
        requestIdRef.current = "";
        intentKeyRef.current = null;
      } else {
        setError(result.error || "The reply was not confirmed. Review the receipt before trying again.");
        retryRequestRef.current = result.saved === "instagram_send_failed" || result.saved === "telegram_failed";
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reply could not be completed. Check the connection and try again.");
      router.refresh();
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
    {platform === "instagram" && <MessageAttachmentPicker assets={assets} value={assetId} onChange={setAssetId} disabled={sending} />}
    {platform !== "instagram" && <small>Photo/video replies are not available for {platform === "fansly" ? "Fansly" : "Telegram"} yet.</small>}
    <label htmlFor={inputId}>Reply</label>
    <textarea id={inputId} name={config.field} value={body} required={!assetId} disabled={sending} maxLength={config.maximum} placeholder={assetId ? "Photo/video sends on its own; remove the attachment to write a reply." : `Write a reply to ${participant}…`} onChange={(event) => setBody(event.currentTarget.value)} onKeyDown={(event) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (!sending && (body.trim() || assetId)) event.currentTarget.form?.requestSubmit();
    }} />
    {error && <div className="reply-error quick-reply-error" role="alert">{error}</div>}
    <div><small aria-live="polite">{sending ? platform === "fansly" ? "Queuing…" : "Sending…" : "Enter to send · Shift+Enter for a new line"}</small><button className="primary" type="submit" disabled={sending}>{sending ? platform === "fansly" ? "Queuing…" : "Sending…" : assetId ? assets.find((asset) => asset.id === assetId)?.verifiedMimeType.startsWith("video/") ? "Send video" : "Send photo" : "Send"}</button></div>
  </form>;
}
