export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  if (rows.length < 2) throw new Error("CSV needs a header and at least one data row.");
  const headers = rows[0].map((header) => header.toLowerCase().trim().replace(/[\s-]+/g, "_"));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function normaliseAnalyticsRows(rows: Array<Record<string, string>>) {
  if (rows.length > 2000) throw new Error("Import is limited to 2,000 rows at a time.");
  const number = (value: string | undefined) => {
    if (!value?.trim()) return null;
    const parsed = Number(value.replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value: ${value}`);
    return parsed;
  };
  return rows.map((row, index) => {
    const periodDate = row.period_date || row.date || row.day || row.period;
    if (!periodDate || Number.isNaN(Date.parse(periodDate))) throw new Error(`Row ${index + 2} needs a valid date or period_date.`);
    return {
      periodDate: new Date(periodDate).toISOString().slice(0, 10),
      accountHandle: row.account_handle || row.handle || row.account || "",
      impressions: number(row.impressions),
      reach: number(row.reach),
      views: number(row.views),
      followers: number(row.followers),
      subscribers: number(row.subscribers),
      revenue: number(row.revenue),
      currency: (row.currency || "AUD").toUpperCase().slice(0, 3),
    };
  });
}
