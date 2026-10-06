import type { DownloadActor } from "./content-download-links.ts";

export const SALE_CURRENCIES = ["AUD", "USD", "EUR", "GBP", "CAD", "NZD", "JPY", "KWD"] as const;
const precision: Record<(typeof SALE_CURRENCIES)[number], number> = { AUD: 2, USD: 2, EUR: 2, GBP: 2, CAD: 2, NZD: 2, JPY: 0, KWD: 3 };
const roles = "'agency_admin','operator','creator'";
const grant = `EXISTS (SELECT 1 FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email)
  JOIN creators c ON c.id=m.creator_id WHERE m.creator_id=content_download_links.creator_id
    AND lower(m.user_email)=lower(?) AND m.status='active' AND u.status='active' AND c.status='active' AND m.role IN (${roles}))`;

export class DownloadSaleError extends Error {
  readonly code = "invalid_request";
  constructor() { super("Check the recipient reference and sale amount."); this.name = "DownloadSaleError"; }
}

export function parseDownloadSale(input: { recipientReference?: unknown; saleAmount?: unknown; saleCurrency?: unknown }) {
  let recipientReference: string | null = null;
  if (input.recipientReference !== undefined && input.recipientReference !== null) {
    if (typeof input.recipientReference !== "string") throw new DownloadSaleError();
    const value = input.recipientReference.trim();
    if (value.length > 120 || /\p{Cc}/u.test(value)) throw new DownloadSaleError();
    recipientReference = value || null;
  }
  const amount = typeof input.saleAmount === "string" ? input.saleAmount.trim() : input.saleAmount;
  const currency = typeof input.saleCurrency === "string" ? input.saleCurrency.trim().toUpperCase() : input.saleCurrency;
  if (amount === undefined || amount === null || amount === "") {
    if (currency !== undefined && currency !== null && currency !== "") throw new DownloadSaleError();
    return { recipientReference, amountMinor: null, currency: null };
  }
  if (typeof amount !== "string" || typeof currency !== "string" || !SALE_CURRENCIES.includes(currency as (typeof SALE_CURRENCIES)[number])) throw new DownloadSaleError();
  const digits = precision[currency as (typeof SALE_CURRENCIES)[number]];
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(amount);
  if (!match || amount.length > 32 || (match[2]?.length ?? 0) > digits) throw new DownloadSaleError();
  const scale = 10n ** BigInt(digits);
  const fraction = digits ? (match[2] ?? "").padEnd(digits, "0") : "";
  const minor = BigInt(match[1]) * scale + BigInt(fraction || "0");
  if (minor > 1_000_000_000_000n) throw new DownloadSaleError();
  return { recipientReference, amountMinor: Number(minor), currency };
}

async function activeActor(DB: D1Database, actor: DownloadActor) {
  if (!actor?.creatorId || !actor.email || actor.email.length > 254) return false;
  return Boolean(await DB.prepare(`SELECT 1 FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email) JOIN creators c ON c.id=m.creator_id
    WHERE m.creator_id=? AND lower(m.user_email)=lower(?) AND m.status='active' AND u.status='active' AND c.status='active'
      AND m.role IN (${roles}) LIMIT 1`).bind(actor.creatorId, actor.email).first());
}

export async function getDownloadSales(DB: D1Database, input: { actor: DownloadActor; assetId: string; offset?: number }) {
  const offset = input.offset ?? 0;
  if (!await activeActor(DB, input.actor) || !input.assetId || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return { rows: [], totals: [], nextOffset: null };
  const rows = await DB.prepare(`SELECT id,recipient_reference,amount_minor,sale_currency,voided_at,COALESCE(updated_at,created_at) AS updated_at,COALESCE(updated_by,created_by) AS updated_by,revision
    FROM content_download_links WHERE creator_id=? AND asset_id=? AND ${grant} ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?`).bind(input.actor.creatorId, input.assetId, input.actor.email, offset).all<{
      id: string; recipient_reference: string | null; amount_minor: number | null; sale_currency: string | null; voided_at: string | null;
      updated_at: string | null; updated_by: string | null; revision: number;
    }>();
  const totals = await DB.prepare(`SELECT sale_currency,SUM(amount_minor) AS amount_minor,COUNT(*) AS row_count,
      SUM(CASE WHEN amount_minor=0 THEN 1 ELSE 0 END) AS complimentary_count
    FROM content_download_links WHERE creator_id=? AND asset_id=? AND amount_minor IS NOT NULL AND voided_at IS NULL AND ${grant}
    GROUP BY sale_currency`).bind(input.actor.creatorId, input.assetId, input.actor.email).all<{ sale_currency: string; amount_minor: number; row_count: number; complimentary_count: number }>();
  const grouped = new Map<string, { currency: string; amountMinor: number; paidCount: number; complimentaryCount: number }>();
  for (const row of totals.results) {
    if (!Number.isSafeInteger(row.amount_minor) || !Number.isSafeInteger(row.row_count) || !Number.isSafeInteger(row.complimentary_count)) throw new Error("Download sale totals exceed safe integer range.");
    grouped.set(row.sale_currency, { currency: row.sale_currency, amountMinor: row.amount_minor, paidCount: row.row_count - row.complimentary_count, complimentaryCount: row.complimentary_count });
  }
  return {
    rows: rows.results.slice(0, 50).map((row) => ({ id: row.id, recipientReference: row.recipient_reference, amountMinor: row.amount_minor, currency: row.sale_currency, voidedAt: row.voided_at, updatedAt: row.updated_at, updatedBy: row.updated_by, revision: row.revision })),
    totals: Array.from(grouped.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
    nextOffset: rows.results.length > 50 ? offset + 50 : null,
  };
}

export async function updateDownloadSale(DB: D1Database, input: {
  actor: DownloadActor; linkId: string; recipientReference?: unknown; saleAmount?: unknown; saleCurrency?: unknown;
  expectedRevision: number; operation: "save" | "clear_recipient" | "void"; now?: string;
}) {
  if (!await activeActor(DB, input.actor) || !input.linkId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || !["save", "clear_recipient", "void"].includes(input.operation)) return false;
  const data = input.operation === "save" ? parseDownloadSale(input) : null;
  const now = input.now ? new Date(input.now).toISOString() : new Date().toISOString();
  const result = input.operation === "clear_recipient"
    ? await DB.prepare(`UPDATE content_download_links SET recipient_reference=NULL,updated_at=?,updated_by=?,revision=revision+1
      WHERE id=? AND creator_id=? AND revision=? AND ${grant}`).bind(now, input.actor.email.toLowerCase(), input.linkId, input.actor.creatorId, input.expectedRevision, input.actor.email).run()
    : input.operation === "void"
      ? await DB.prepare(`UPDATE content_download_links SET voided_at=COALESCE(voided_at,?),updated_at=?,updated_by=?,revision=revision+1
        WHERE id=? AND creator_id=? AND revision=? AND voided_at IS NULL AND ${grant}`).bind(now, now, input.actor.email.toLowerCase(), input.linkId, input.actor.creatorId, input.expectedRevision, input.actor.email).run()
      : await DB.prepare(`UPDATE content_download_links SET recipient_reference=?,amount_minor=?,sale_currency=?,updated_at=?,updated_by=?,revision=revision+1
        WHERE id=? AND creator_id=? AND revision=? AND ${grant}`).bind(data!.recipientReference, data!.amountMinor, data!.currency, now, input.actor.email.toLowerCase(), input.linkId, input.actor.creatorId, input.expectedRevision, input.actor.email).run();
  return Boolean(result.meta?.changes);
}
