export const financePlatforms = ["onlyfans", "fansly", "stripe"] as const;
export type FinancePlatform = (typeof financePlatforms)[number];

export type FinanceImportRow = {
  periodDate: string;
  currency: string;
  grossRevenueMinor: number | null;
  refundsMinor: number | null;
  netRevenueMinor: number;
  subscribers: number | null;
};

export type DeliveryCounts = {
  verifiedSocial: number;
  failedSocial: number;
  unreviewedSocial: number;
  stalledSocial: number;
  approvalRequired: number;
  approvalGaps: number;
  verifiedVault: number;
  failedVault: number;
  awaitingDevice: number;
  stalledVault: number;
  unreadConversations: number;
};

function parseCsv(text: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      record.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field.trim());
      field = "";
      if (record.some(Boolean)) records.push(record);
      record = [];
    } else field += character;
  }
  record.push(field.trim());
  if (record.some(Boolean)) records.push(record);
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  if (records.length < 2) throw new Error("CSV needs a header and at least one data row.");
  const headers = records[0].map((value) => value.replace(/^\uFEFF/, "").toLowerCase().trim().replace(/[\s-]+/g, "_"));
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");
  return records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function decimalMinor(value: string | undefined, label: string, rowNumber: number) {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(/[$£€,%\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`Row ${rowNumber} has an invalid ${label}. Use no more than two decimal places.`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(Math.round(parsed * 100))) throw new Error(`Row ${rowNumber} ${label} is outside the supported range.`);
  return Math.round(parsed * 100);
}

function wholeNumber(value: string | undefined, rowNumber: number) {
  if (!value?.trim()) return null;
  const normalized = value.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(normalized)) throw new Error(`Row ${rowNumber} has an invalid subscriber count.`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Row ${rowNumber} subscriber count is outside the supported range.`);
  return parsed;
}

export function normaliseFinanceCsv(text: string): FinanceImportRow[] {
  const records = parseCsv(text);
  if (records.length > 400) throw new Error("Finance imports are limited to 400 rows at a time.");
  const seen = new Set<string>();
  return records.map((row, index) => {
    const rowNumber = index + 2;
    const rawDate = row.period_date || row.date || row.day || row.period;
    const parsedDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== rawDate) {
      throw new Error(`Row ${rowNumber} needs a date in YYYY-MM-DD format.`);
    }
    const rawCurrency = row.currency?.trim();
    if (!rawCurrency) throw new Error(`Row ${rowNumber} needs a currency code. Include a currency column and a three-letter code for every row.`);
    const currency = rawCurrency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Row ${rowNumber} needs a three-letter currency code.`);
    const key = `${rawDate}|${currency}`;
    if (seen.has(key)) throw new Error(`Row ${rowNumber} duplicates ${rawDate} ${currency} in this file.`);
    seen.add(key);
    const grossRevenueMinor = decimalMinor(row.gross_revenue || row.gross, "gross revenue", rowNumber);
    const refundsMinor = decimalMinor(row.refunds || row.refund, "refunds", rowNumber);
    const suppliedNet = decimalMinor(row.net_revenue || row.net || row.revenue || row.earnings, "net revenue", rowNumber);
    if (grossRevenueMinor === null && suppliedNet === null) throw new Error(`Row ${rowNumber} needs revenue, net_revenue or gross_revenue.`);
    const netRevenueMinor = suppliedNet ?? grossRevenueMinor! - Math.abs(refundsMinor ?? 0);
    return { periodDate: rawDate, currency, grossRevenueMinor, refundsMinor, netRevenueMinor, subscribers: wholeNumber(row.subscribers, rowNumber) };
  });
}

export function calculateDeliveryScorecard(counts: DeliveryCounts) {
  const verifiedDeliveries = counts.verifiedSocial + counts.verifiedVault;
  const failedDeliveries = counts.failedSocial + counts.failedVault;
  const completedDeliveries = verifiedDeliveries + failedDeliveries;
  const deliverySuccessPercent = completedDeliveries ? Math.round((verifiedDeliveries / completedDeliveries) * 100) : null;
  const approvalCoveragePercent = counts.approvalRequired ? Math.round(((counts.approvalRequired - counts.approvalGaps) / counts.approvalRequired) * 100) : null;
  return {
    verifiedDeliveries,
    failedDeliveries,
    deliverySuccessPercent,
    approvalCoveragePercent,
    needsReview: counts.unreviewedSocial + counts.failedVault + counts.stalledSocial + counts.stalledVault,
    awaitingDevice: counts.awaitingDevice,
    unreadConversations: counts.unreadConversations,
  };
}
