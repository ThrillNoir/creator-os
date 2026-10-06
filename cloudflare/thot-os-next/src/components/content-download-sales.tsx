"use client";

import { useEffect, useState, useTransition } from "react";
import { listDownloadSalesAction, updateDownloadSaleAction } from "@/app/content-link-actions";
import { SALE_CURRENCIES } from "@/lib/content-download-sales";

type Sales = Awaited<ReturnType<typeof listDownloadSalesAction>>;

function exponent(currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function amountText(amountMinor: number | null, currency: string | null) {
  if (amountMinor === null || !currency) return "";
  return (amountMinor / 10 ** exponent(currency)).toFixed(exponent(currency));
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(amountMinor / 10 ** exponent(currency));
}

export function ContentDownloadSales({ assetId, refreshKey }: { assetId: string; refreshKey: number }) {
  const [sales, setSales] = useState<Sales | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setSales(null);
    setLoading(true);
    listDownloadSalesAction(assetId, offset).then((result) => { if (active) setSales(result); }).catch(() => { if (active) setMessage("Private sales history is unavailable."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assetId, offset, refreshKey]);

  function update(data: FormData) {
    startTransition(async () => {
      setMessage("");
      try {
        const result = await updateDownloadSaleAction(data);
        if ("code" in result) { setMessage("Check the recipient reference, amount and currency."); return; }
        if (!result.ok) {
          try { setSales(await listDownloadSalesAction(assetId, offset)); } catch { setMessage("This sale changed or is unavailable. Private history could not refresh."); return; }
          setMessage("This sale changed or is unavailable. Review the current record before editing again.");
          return;
        }
        try {
          setSales(await listDownloadSalesAction(assetId, offset));
          setMessage("Download sale saved.");
        } catch { setMessage("Download sale saved. Private history could not refresh."); }
      } catch { setMessage("Could not update this download sale."); }
    });
  }

  if (!sales) return <section className="history"><h3>Private download sales</h3><p role="status">{message || "Loading private history…"}</p></section>;

  return <section className="history">
    <h3>Private download sales</h3>
    <p>Manual records only. Saving a price does not confirm that payment was received. Clear a recipient reference when it should no longer be retained; void a sale to exclude it from totals.</p>
    <h4>Totals across this video</h4>
    {sales.totals.length ? <ul>{sales.totals.map((total) => <li key={total.currency}>{money(total.amountMinor, total.currency)} {total.currency} · {total.paidCount} paid · {total.complimentaryCount} complimentary</li>)}</ul> : <p>No recorded sales.</p>}
    {sales.rows.length ? sales.rows.map((row) => <details key={`${row.id}:${row.revision}`}>
      <summary>{row.voidedAt ? "Voided" : row.amountMinor === 0 ? "Complimentary" : row.amountMinor !== null ? "Paid amount recorded" : "No sale recorded"} · {row.recipientReference || "No recipient reference"}</summary>
      <article>
      <div><strong>{row.voidedAt ? "Voided" : row.amountMinor === 0 ? "Complimentary" : row.amountMinor !== null ? "Paid amount recorded" : "No sale recorded"}</strong><small>{row.updatedAt ? `Updated ${new Date(row.updatedAt).toLocaleString()}` : "No sales details"}</small></div>
      <form action={update}>
        <input type="hidden" name="linkId" value={row.id} />
        <input type="hidden" name="expectedRevision" value={row.revision} />
        <input type="hidden" name="operation" value="save" />
        <label>Recipient reference (private)<input name="recipientReference" defaultValue={row.recipientReference ?? ""} maxLength={120} placeholder="Optional identifier" /></label>
        <label>Amount (optional)<input name="saleAmount" inputMode="decimal" defaultValue={amountText(row.amountMinor, row.currency)} placeholder="Blank means no paid amount" /></label>
        <label>Currency<select name="saleCurrency" defaultValue={row.currency ?? ""}><option value="">No currency</option>{SALE_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
        <button className="secondary-action" disabled={pending} type="submit">Save correction</button>
      </form>
      {row.recipientReference && <form action={update}><input type="hidden" name="linkId" value={row.id} /><input type="hidden" name="expectedRevision" value={row.revision} /><input type="hidden" name="operation" value="clear_recipient" /><button className="secondary-action" disabled={pending} type="submit">Clear recipient reference</button></form>}
      {!row.voidedAt && <form action={update}><input type="hidden" name="linkId" value={row.id} /><input type="hidden" name="expectedRevision" value={row.revision} /><input type="hidden" name="operation" value="void" /><button className="danger-action" disabled={pending} type="submit">Void sale record</button></form>}
      </article>
    </details>) : <p>No download links on this page.</p>}
    <div className="connection-row-actions"><button className="secondary-action" disabled={pending || loading || offset === 0} onClick={() => { setSales(null); setOffset(Math.max(0, offset - 50)); }} type="button">Previous</button><button className="secondary-action" disabled={pending || loading || sales.nextOffset === null} onClick={() => { setSales(null); setOffset(sales.nextOffset ?? offset); }} type="button">Next</button></div>
    <p role="status">{message}</p>
  </section>;
}
