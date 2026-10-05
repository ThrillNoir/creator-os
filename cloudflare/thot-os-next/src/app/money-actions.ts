"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { financePlatforms, normaliseFinanceCsv, type FinancePlatform } from "@/lib/finance-metrics";
import { requireCreatorContext } from "@/lib/identity";

function platformValue(value: FormDataEntryValue | null): FinancePlatform {
  const platform = String(value ?? "").toLowerCase();
  if (!financePlatforms.includes(platform as FinancePlatform)) throw new Error("Choose OnlyFans, Fansly or Stripe.");
  return platform as FinancePlatform;
}

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type FinanceImportResult =
  | { kind: "imported" }
  | { kind: "duplicate" }
  | { kind: "error"; message: string };

export async function importFinanceCsvAction(formData: FormData): Promise<FinanceImportResult> {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  let platform: FinancePlatform;
  let file: File;
  let sourceName: string;
  let contentHash: string;
  let rows: ReturnType<typeof normaliseFinanceCsv>;
  try {
    platform = platformValue(formData.get("platform"));
    const upload = formData.get("file");
    if (!(upload instanceof File) || !upload.size) throw new Error("Choose a CSV export to import.");
    if (upload.size > 1_000_000) throw new Error("Finance CSV imports are limited to 1 MB.");
    if (!upload.name.toLowerCase().endsWith(".csv") && upload.type !== "text/csv") throw new Error("Choose a CSV file.");
    file = upload;
    sourceName = file.name.replace(/[\r\n]/g, " ").slice(0, 180);
    const bytes = await file.arrayBuffer();
    const [hash, normalizedRows] = await Promise.all([sha256(bytes), Promise.resolve(normaliseFinanceCsv(new TextDecoder().decode(bytes)))]);
    contentHash = hash;
    rows = normalizedRows;
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Review the selected CSV and try again." };
  }
  try {
    const importSeed = new TextEncoder().encode(`${creatorId}|${platform}|${contentHash}`);
    const importId = `finance-${(await sha256(importSeed.buffer as ArrayBuffer)).slice(0, 40)}`;
    const { DB } = cloudflareEnv();
    const existing = await creatorPrepare(DB, creatorId, "SELECT id FROM finance_imports WHERE creator_id=@creator AND platform=? AND content_hash=?").bind(platform, contentHash).first<{ id: string }>();
    if (existing) return { kind: "duplicate" };

    const statements: D1PreparedStatement[] = [
      creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO finance_imports
        (id,creator_id,platform,source_name,content_hash,row_count,imported_by) VALUES (?,@creator,?,?,?,?,?)`)
        .bind(importId, platform, sourceName, contentHash, rows.length, identity.email),
    ];
    for (let start = 0; start < rows.length; start += 10) {
      const chunk = rows.slice(start, start + 10);
      const placeholders = chunk.map(() => "(@creator,?,?,?,?,?,?,?,?)").join(",");
      const values = chunk.flatMap((row) => [platform, row.periodDate, row.currency, row.grossRevenueMinor, row.refundsMinor, row.netRevenueMinor, row.subscribers, importId]);
      statements.push(creatorPrepare(DB, creatorId, `INSERT INTO finance_daily_metrics
        (creator_id,platform,period_date,currency,gross_revenue_minor,refunds_minor,net_revenue_minor,subscribers,import_id)
        VALUES ${placeholders}
        ON CONFLICT(creator_id,platform,period_date,currency) DO UPDATE SET
          gross_revenue_minor=excluded.gross_revenue_minor,refunds_minor=excluded.refunds_minor,
          net_revenue_minor=excluded.net_revenue_minor,subscribers=excluded.subscribers,
          import_id=excluded.import_id,updated_at=CURRENT_TIMESTAMP`).bind(...values));
    }
    statements.push(creatorPrepare(DB, creatorId, `INSERT INTO finance_audit_events
      (id,creator_id,actor,actor_role,event_type,detail) VALUES (?,@creator,?,?,'finance_csv_imported',?)`)
      .bind(crypto.randomUUID(), identity.email, identity.creator.role, JSON.stringify({ platform, sourceName, rows: rows.length, contentHash })));
    await DB.batch(statements);
    revalidatePath("/money");
    return { kind: "imported" };
  } catch {
    return { kind: "error", message: "The import could not be confirmed. Your file is still selected; check recent imports before retrying. Exact duplicate exports are skipped." };
  }
}

export async function saveAgencySplitAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const raw = String(formData.get("agencySplitPercent") ?? "").trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw)) throw new Error("Enter an agency percentage between 0 and 100.");
  const percent = Number(raw);
  if (percent < 0 || percent > 100) throw new Error("Agency percentage must be between 0 and 100.");
  const basisPoints = Math.round(percent * 100);
  const effectiveOn = String(formData.get("effectiveOn") ?? "").trim();
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(effectiveOn);
  if (!dateMatch) throw new Error("Enter an effective date for the proposed percentage.");
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (year < 1 || calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new Error("Enter a valid effective date.");
  }
  const requestId = String(formData.get("requestId") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw new Error("Refresh the form before saving proposed terms.");
  }
  const { DB } = cloudflareEnv();
  const eventType = "agency_split_proposed";
  const detail = JSON.stringify({
    agencySplitBps: basisPoints,
    effectiveOn,
    revenueScope: "thot_generated_paid_site_sales",
    eligibleRevenueEvidence: "unresolved",
    basis: "unresolved",
    cadence: "unresolved",
    softwareFee: "none_currently",
    futureFee: "undecided",
  });
  const findById = () => creatorPrepare(DB, creatorId, `SELECT id,event_type,actor,detail FROM finance_audit_events
    WHERE creator_id=@creator AND id=?`).bind(requestId).first<{ id: string; event_type: string; actor: string; detail: string }>();
  const matchesRequest = (existing: { event_type: string; actor: string; detail: string } | null) =>
    existing?.event_type === eventType && existing.actor === identity.email && existing.detail === detail;
  const existing = await findById();
  if (existing) {
    if (!matchesRequest(existing)) throw new Error("This request ID was already used for different proposed terms.");
    redirect("/money?notice=split_saved");
  }
  await creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO finance_audit_events
    (id,creator_id,actor,actor_role,event_type,detail,created_at)
    VALUES (?,@creator,?,?,'agency_split_proposed',?,strftime('%Y-%m-%d %H:%M:%f','now'))`)
    .bind(requestId, identity.email, identity.creator.role, detail).run();
  const persisted = await findById();
  if (!matchesRequest(persisted)) throw new Error("This request ID was already used for different proposed terms.");
  revalidatePath("/money");
  redirect("/money?notice=split_saved");
}

export async function recordCommissionPaymentAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  if (identity.creator.role !== "agency_admin") throw new Error("Only an agency administrator can record commission payment evidence.");
  const creatorId = identity.creator.creator_id;
  const requestId = String(formData.get("requestId") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw new Error("Refresh the form before recording payment evidence.");
  }

  const rawAmount = String(formData.get("amount") ?? "").trim();
  const amountMatch = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(rawAmount);
  if (!amountMatch) throw new Error("Enter a positive amount with no more than two decimal places.");
  const amountMinorBig = BigInt(amountMatch[1]) * 100n + BigInt(((amountMatch[2] ?? "") + "00").slice(0, 2));
  if (amountMinorBig <= 0n || amountMinorBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The reported amount is outside the supported range.");
  const amountMinor = Number(amountMinorBig);

  const receivedOn = String(formData.get("receivedOn") ?? "").trim();
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(receivedOn);
  if (!dateMatch) throw new Error("Enter the date the payment was reported received.");
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (year < 1 || calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new Error("Enter a valid payment date.");
  }

  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Enter a three-letter currency code.");
  const reference = String(formData.get("reference") ?? "").trim();
  if (!reference || reference.length > 160 || /[\u0000-\u001f\u007f]/.test(reference)) {
    throw new Error("Enter a non-sensitive reference of up to 160 characters.");
  }

  const { DB } = cloudflareEnv();
  const [settings, proposal] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT agency_split_bps FROM creator_finance_settings WHERE creator_id=@creator")
      .first<{ agency_split_bps: number }>(),
    creatorPrepare(DB, creatorId, `SELECT detail FROM finance_audit_events WHERE creator_id=@creator AND event_type='agency_split_proposed'
      ORDER BY created_at DESC,id DESC LIMIT 1`).first<{ detail: string }>(),
  ]);
  let validProposal = false;
  if (proposal) {
    try {
      const detail = JSON.parse(proposal.detail) as Record<string, unknown>;
      const effectiveOn = detail.effectiveOn;
      const proposalDateMatch = typeof effectiveOn === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(effectiveOn) : null;
      const proposalDate = proposalDateMatch ? proposalDateMatch.slice(1).map(Number) : null;
      const parsedProposalDate = proposalDate ? new Date(0) : null;
      if (parsedProposalDate && proposalDate) {
        parsedProposalDate.setUTCFullYear(proposalDate[0], proposalDate[1] - 1, proposalDate[2]);
        parsedProposalDate.setUTCHours(0, 0, 0, 0);
      }
      const validEffectiveDate = Boolean(proposalDate && parsedProposalDate && proposalDate[0] >= 1
        && parsedProposalDate.getUTCFullYear() === proposalDate[0]
        && parsedProposalDate.getUTCMonth() === proposalDate[1] - 1
        && parsedProposalDate.getUTCDate() === proposalDate[2]);
      validProposal = Number.isSafeInteger(detail.agencySplitBps) && Number(detail.agencySplitBps) >= 0 && Number(detail.agencySplitBps) <= 10000
        && validEffectiveDate
        && detail.revenueScope === "thot_generated_paid_site_sales" && detail.eligibleRevenueEvidence === "unresolved"
        && detail.basis === "unresolved" && detail.cadence === "unresolved"
        && detail.softwareFee === "none_currently" && detail.futureFee === "undecided";
    } catch { /* Malformed legacy audit detail is not a valid saved proposal. */ }
  }
  if (!settings && !validProposal) throw new Error("Save a commission percentage proposal before recording payment evidence.");

  const eventType = "commission_payment_reported";
  const detail = JSON.stringify({ amountMinor, currency, receivedOn, reference });
  const findById = () => creatorPrepare(DB, creatorId, `SELECT id,event_type,actor,detail FROM finance_audit_events
    WHERE creator_id=@creator AND id=?`).bind(requestId).first<{ id: string; event_type: string; actor: string; detail: string }>();
  const matchesRequest = (existing: { event_type: string; actor: string; detail: string } | null) =>
    existing?.event_type === eventType && existing.actor === identity.email && existing.detail === detail;
  const existing = await findById();
  if (existing) {
    if (!matchesRequest(existing)) throw new Error("This request ID was already used for different evidence.");
  } else {
    await creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO finance_audit_events
      (id,creator_id,actor,actor_role,event_type,detail) VALUES (?,@creator,?,?,'commission_payment_reported',?)`)
      .bind(requestId, identity.email, identity.creator.role, detail).run();
    const persisted = await findById();
    if (!matchesRequest(persisted)) throw new Error("This request ID was already used for different evidence.");
  }

  revalidatePath("/money");
  redirect("/money?notice=commission_payment_reported");
}
