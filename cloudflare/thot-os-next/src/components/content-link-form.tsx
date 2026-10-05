"use client";

import { useEffect, useState, useTransition } from "react";
import { generateContentLinkAction, revokeContentLinkAction, listContentLinksAction } from "@/app/content-link-actions";

export function ContentLinkForm({ assetId }: { assetId: string }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listContentLinksAction>>>([]);
  useEffect(() => { let active = true; listContentLinksAction(assetId).then((items) => { if (active) setHistory(items); }).catch(() => { if (active) setMessage("Link history unavailable."); }); return () => { active = false; }; }, [assetId]);
  return <section className="panel">
    <h2>One-time download link</h2>
    <p>One video, one redemption, 24 hours to claim. The recipient has one hour to resume their download. Anyone holding the link can claim it first. No payment is collected.</p>
    <form action={(data) => startTransition(async () => {
      setMessage("");
      try { setLink(await generateContentLinkAction(data)); setHistory(await listContentLinksAction(assetId)); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not generate link."); }
    })}>
      <input type="hidden" name="assetId" value={assetId} />
      <label>Recipient-facing title<input name="title" required maxLength={120} placeholder="Choose a title safe to share" /></label>
      <label style={{ display: "flex", gap: "0.6rem", alignItems: "start" }}><input type="checkbox" name="sharingConfirmed" value="yes" required style={{ width: "1rem", height: "1rem", flex: "0 0 1rem" }} />I approve this video for direct download sharing and confirm it features only the owning creator.</label>
      <button className="primary" disabled={pending || Boolean(link)} type="submit">Generate one-time link</button>
    </form>
    {link && <div>
      <p>Redeem before {new Date(link.expiresAt).toLocaleString()}.</p>
      <label>Copy this link now; it is not stored in readable form.<input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} /></label>
      <button type="button" disabled={pending} onClick={async () => { try { await navigator.clipboard.writeText(link.url); setMessage("Copied."); } catch { setMessage("Select and copy the link above."); } }}>Copy link</button>
      <button type="button" disabled={pending} onClick={() => startTransition(async () => {
        try { await revokeContentLinkAction(link.id); setLink(null); setHistory(await listContentLinksAction(assetId)); setMessage("Link revoked. Future downloads are blocked."); }
        catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke link."); }
      })}>Revoke link</button>
    </div>}
    {history.length > 0 && <ul>{history.map((item) => <li key={item.id}>{item.title} — {item.status}
      {item.status !== "revoked" && item.status !== "expired" && <button type="button" disabled={pending} onClick={() => startTransition(async () => {
        try { await revokeContentLinkAction(item.id); if (link?.id === item.id) setLink(null); setHistory(await listContentLinksAction(assetId)); setMessage("Link revoked."); }
        catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke link."); }
      })}>Revoke</button>}
    </li>)}</ul>}
    <p role="status">{message}</p>
  </section>;
}
