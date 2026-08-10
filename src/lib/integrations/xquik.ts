import "server-only";

const BASE_URL = "https://xquik.com/api/v1";

export type XQuikAccount = {
  id: string;
  xUsername: string;
  xUserId: string;
  status: string;
  health: "healthy" | "locked" | "needsReauth" | "recovering" | "suspended" | "temporaryIssue";
};

function apiKey() {
  const value = process.env.XQUIK_API_KEY?.trim();
  if (!value) throw new Error("Add XQUIK_API_KEY to the private THOT OS environment first.");
  return value;
}

export function getXQuikConfiguration() {
  return { ready: Boolean(process.env.XQUIK_API_KEY?.trim()) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "x-api-key": apiKey(), "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.message || body.error || `XQuik returned ${response.status}.`));
  return body as T;
}

export async function listXQuikAccounts() {
  const result = await request<{ accounts: XQuikAccount[] }>("/x/accounts");
  return result.accounts || [];
}

export async function createXQuikPost(input: { account: string; text: string; media: string[]; idempotencyKey: string }) {
  return request<Record<string, unknown>>("/x/tweets", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ account: input.account, text: input.text, ...(input.media.length ? { media: input.media } : {}) }),
  });
}
