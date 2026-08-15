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

export async function importFinanceCsvAction(formData: FormData) {
  const identity = await requireCreatorContext("mutate");
  const creatorId = identity.creator.creator_id;
  const platform = platformValue(formData.get("platform"));
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Choose a CSV export to import.");
  if (file.size > 1_000_000) throw new Error("Finance CSV imports are limited to 1 MB.");
  if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") throw new Error("Choose a CSV file.");
  const sourceName = file.name.replace(/[\r\n]/g, " ").slice(0, 180);
  const bytes = await file.arrayBuffer();
  const [contentHash, rows] = await Promise.all([sha256(bytes), Promise.resolve(normaliseFinanceCsv(new TextDecoder().decode(bytes)))]);
  const importSeed = new TextEncoder().encode(`${creatorId}|${platform}|${contentHash}`);
  const importId = `finance-${(await sha256(importSeed.buffer as ArrayBuffer)).slice(0, 40)}`;
  const { DB } = cloudflareEnv();
  const existing = await creatorPrepare(DB, creatorId, "SELECT id FROM finance_imports WHERE creator_id=@creator AND platform=? AND content_hash=?").bind(platform, contentHash).first<{ id: string }>();
  if (existing) redirect("/money?notice=duplicate_import");

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
  redirect("/money?notice=imported");
}

export async function saveAgencySplitAction(formData: FormData) {
  const identity = await requireCreatorContext("manage_identity");
  const creatorId = identity.creator.creator_id;
  const raw = String(formData.get("agencySplitPercent") ?? "").trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw)) throw new Error("Enter an agency percentage between 0 and 100.");
  const percent = Number(raw);
  if (percent < 0 || percent > 100) throw new Error("Agency percentage must be between 0 and 100.");
  const basisPoints = Math.round(percent * 100);
  const { DB } = cloudflareEnv();
  await DB.batch([
    creatorPrepare(DB, creatorId, `INSERT INTO creator_finance_settings
      (creator_id,agency_split_bps,revenue_basis,updated_by) VALUES (@creator,?,'imported_net_earnings',?)
      ON CONFLICT(creator_id) DO UPDATE SET agency_split_bps=excluded.agency_split_bps,
        revenue_basis=excluded.revenue_basis,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(basisPoints, identity.email),
    creatorPrepare(DB, creatorId, `INSERT INTO finance_audit_events
      (id,creator_id,actor,actor_role,event_type,detail) VALUES (?,@creator,?,?,'agency_split_updated',?)`)
      .bind(crypto.randomUUID(), identity.email, identity.creator.role, JSON.stringify({ agencySplitBps: basisPoints })),
  ]);
  revalidatePath("/money");
  redirect("/money?notice=split_saved");
}
