"use client";

import { useEffect, useState, useTransition } from "react";
import { generateContentLinkAction, revokeContentLinkAction, listContentLinksAction } from "@/app/content-link-actions";
import { ContentDownloadSales } from "@/components/content-download-sales";
import { SALE_CURRENCIES } from "@/lib/content-download-sales";

export function ContentLinkForm({ assetId, eligibility }: { assetId: string; eligibility: string[] }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listContentLinksAction>>>([]);
  const [salesRefresh, setSalesRefresh] = useState(0);
  useEffect(() => { let active = true; listContentLinksAction(assetId).then((items) => { if (active) setHistory(items); }).catch(() => { if (active) setMessage("Link history unavailable."); }); return () => { active = false; }; }, [assetId]);
  return <section className="panel content-download-panel">
    <h2>One-time download link</h2>
    <p>One video, one redemption, 24 hours to claim. The recipient has one hour to resume their download. Anyone holding the link can claim it first. No payment is collected.</p>
    <form action={(data) => startTransition(async () => {
      setMessage("");
      try {
        const result = await generateContentLinkAction(data);
        if (!result.ok) { setMessage(result.code === "invalid_request" ? "Check the title, message, recipient reference, amount/currency and sharing confirmation." : "This video is not currently eligible for sharing. Check its saved review and source availability."); return; }
        setLink(result.link);
        setSalesRefresh((value) => value + 1);
        try { setHistory(await listContentLinksAction(assetId)); }
        catch { setMessage("Link created. Link history is unavailable."); }
      }
      catch { setMessage("Could not generate link. Please try again."); }
    })}>
      <input type="hidden" name="assetId" value={assetId} />
      <label>Recipient-facing title<input name="title" required maxLength={120} placeholder="Choose a title safe to share" /></label>
      <label>Message to recipient (optional)<textarea name="customMessage" maxLength={500} rows={3} placeholder="Add a personal note" aria-describedby="download-message-help" /></label>
      <p id="download-message-help">Up to 500 characters. Anyone with this link can read your message while download access is valid.</p>
      <label>Recipient reference (private, optional)<input name="recipientReference" maxLength={120} placeholder="A private identifier for your records" /></label>
      <label>Sale amount (optional)<input name="saleAmount" inputMode="decimal" placeholder="Leave blank if no amount was recorded" /></label>
      <label>Currency<select name="saleCurrency" defaultValue=""><option value="">No currency</option>{SALE_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      <p>These are manual records only. Recording an amount does not confirm that payment was received. Leave both amount and currency blank when no amount is recorded. Record each sale once; replacement links should not repeat its amount.</p>
      <label className="download-sharing-confirmation"><input type="checkbox" name="sharingConfirmed" value="yes" required />I approve this video and message for direct download sharing and confirm the video features only the owning creator.</label>
      <button className="primary" disabled={pending || Boolean(link) || eligibility.length > 0} type="submit">Generate one-time link</button>
    </form>
    {eligibility.length > 0 && <ul role="status">{eligibility.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    {link && <div>
      <p>Redeem before {new Date(link.expiresAt).toLocaleString()}.</p>
      <label>Copy this link now; it is not stored in readable form.<input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} /></label>
      <button className="secondary-action" type="button" disabled={pending} onClick={async () => { try { await navigator.clipboard.writeText(link.url); setMessage("Copied."); } catch { setMessage("Select and copy the link above."); } }}>Copy link</button>
      <button className="secondary-action" type="button" disabled={pending} onClick={() => startTransition(async () => {
        try { const result = await revokeContentLinkAction(link.id); if (!result.ok) { setMessage("That link is unavailable or already revoked."); return; } setLink(null); setMessage("Link revoked. Future downloads are blocked."); try { setHistory(await listContentLinksAction(assetId)); } catch { setMessage("Link revoked. Link history is unavailable."); } }
        catch { setMessage("Could not revoke link."); }
      })}>Revoke link</button>
    </div>}
    {history.length > 0 && <ul>{history.map((item) => <li key={item.id}>{item.title} — {item.status}
      {item.status !== "revoked" && item.status !== "expired" && <button className="secondary-action" type="button" disabled={pending} onClick={() => startTransition(async () => {
        try { const result = await revokeContentLinkAction(item.id); if (!result.ok) { setMessage("That link is unavailable or already revoked."); return; } if (link?.id === item.id) setLink(null); setMessage("Link revoked."); try { setHistory(await listContentLinksAction(assetId)); } catch { setMessage("Link revoked. Link history is unavailable."); } }
        catch { setMessage("Could not revoke link."); }
      })}>Revoke</button>}
    </li>)}</ul>}
    <ContentDownloadSales key={assetId} assetId={assetId} refreshKey={salesRefresh} />
    <p role="status">{message}</p>
  </section>;
}
