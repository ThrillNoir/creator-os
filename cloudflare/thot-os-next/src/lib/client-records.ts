export const clientChannels = ["none", "email", "telegram", "other"] as const;
export const bookingStates = ["requested", "confirmed", "completed", "cancelled"] as const;

export function clientText(value: FormDataEntryValue | null, maximum: number, label: string, required = false, multiline = false) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (text.length > maximum || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text) || (!multiline && text.includes("\n")) || (required && !text)) {
    throw new Error(`Enter ${label} of ${maximum} characters or fewer.`);
  }
  return text;
}

export function clientDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Enter a valid date.");
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("Enter a valid date.");
  return text;
}

export function clientAmountMinor(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("Enter a positive amount with up to two decimal places.");
  const amount = BigInt(match[1]) * 100n + BigInt(((match[2] ?? "") + "00").slice(0, 2));
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The amount is outside the supported range.");
  return Number(amount);
}

export function clientCurrency(value: FormDataEntryValue | null) {
  const currency = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Enter a three-letter currency code.");
  return currency;
}

export function clientRequestId(value: FormDataEntryValue | null) {
  const id = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("Refresh the form before saving.");
  return id;
}

export function clientMoney(amountMinor: number, currency: string) {
  try { return new Intl.NumberFormat("en-AU", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountMinor / 100); }
  catch { return `${currency} ${(amountMinor / 100).toFixed(2)}`; }
}
