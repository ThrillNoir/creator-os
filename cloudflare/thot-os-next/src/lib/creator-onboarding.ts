import "server-only";

export type OnboardingRequest = {
  creatorId: string;
  name: string;
  slug: string;
  initials: string;
  accent: string;
  requestedBy: string;
};

export type ValidatedOnboardingRequest = OnboardingRequest & {
  idempotencyKey: string;
  fingerprint: string;
};

function normalizedText(value: unknown, maximum: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function canonicalCreatorId(value: unknown) {
  const id = normalizedText(value, 64).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Creator ID must use lowercase letters, numbers and single hyphens.");
  return id;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateOnboardingRequest(input: Record<string, unknown>, requestedBy: string): Promise<ValidatedOnboardingRequest> {
  const creatorId = canonicalCreatorId(input.creatorId);
  const slug = canonicalCreatorId(input.slug || creatorId);
  if (slug !== creatorId) throw new Error("Creator ID and slug must match for a new canonical workspace.");
  const name = normalizedText(input.name, 100);
  const initials = normalizedText(input.initials, 8).toUpperCase();
  const accent = normalizedText(input.accent || "#6f4df6", 7);
  const email = normalizedText(requestedBy, 254).toLowerCase();
  if (name.length < 2) throw new Error("Creator name is required.");
  if (!/^[A-Z0-9]{1,8}$/.test(initials)) throw new Error("Initials must contain only letters or numbers.");
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error("Accent must be a six-digit colour.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid authenticated operator is required.");
  const payload = JSON.stringify({ creatorId, name, slug, initials, accent: accent.toLowerCase(), requestedBy: email });
  return { creatorId, name, slug, initials, accent: accent.toLowerCase(), requestedBy: email, idempotencyKey: `creator-onboarding:${creatorId}`, fingerprint: await digest(payload) };
}

export async function getOnboardingResult(DB: D1Database, request: ValidatedOnboardingRequest) {
  const existing = await DB.prepare(`SELECT creator_id,request_fingerprint,status
    FROM creator_onboarding_receipts WHERE idempotency_key=?`).bind(request.idempotencyKey).first<{ creator_id: string; request_fingerprint: string; status: string }>();
  if (!existing) return null;
  if (existing.creator_id !== request.creatorId || existing.request_fingerprint !== request.fingerprint) {
    throw new Error("This canonical creator ID already has a different onboarding receipt.");
  }
  return existing;
}
