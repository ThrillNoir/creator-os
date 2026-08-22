import "server-only";

import { notFound } from "next/navigation";
import { issueLocalPreviewToken, localPreviewNonce, readLocalPreviewToken } from "@/lib/local-preview-tokens";
import { localAdultPreviewAvailable } from "@/lib/local-preview-runtime";

export { localAdultPreviewAvailable } from "@/lib/local-preview-runtime";

const COOKIE_NAME = "thot_local_adult_preview";
const MAX_AGE_SECONDS = 60 * 60;
const GATE_TOKEN_MAX_AGE_SECONDS = 5 * 60;

type PreviewSession = { creatorId: string; versionId: string; expiresAt: number };
type GateToken = PreviewSession & { purpose: "local_adult_age_gate"; nonce: string };

function localOnly() {
  return localAdultPreviewAvailable();
}

function localSecret() {
  const secret = process.env.LOCAL_ADULT_PREVIEW_SIGNING_SECRET;
  // Next development can render route handlers in separate workers. A process
  // environment key keeps token verification stable across those workers while
  // remaining local-only and never falling back to a committed value.
  if (typeof secret !== "string" || secret.length < 32) notFound();
  return secret;
}

export function requireLocalAdultPreview() {
  if (!localOnly()) notFound();
}

export async function createLocalAdultPreviewSession(creatorId: string, versionId: string) {
  requireLocalAdultPreview();
  return issueLocalPreviewToken({ creatorId, versionId, expiresAt: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS } satisfies PreviewSession, localSecret());
}

export async function readLocalAdultPreviewSession(token: string | undefined) {
  requireLocalAdultPreview();
  const decoded = await readLocalPreviewToken(token, localSecret());
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
  try {
    const session = decoded as Partial<PreviewSession>;
    const expiresAt = session.expiresAt;
    if (typeof session.creatorId !== "string" || typeof session.versionId !== "string" || typeof expiresAt !== "number" || !Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return session as PreviewSession;
  } catch { return null; }
}

/**
 * A short-lived signed token for the local-only age confirmation form. It is
 * deliberately distinct from the protected-session cookie, and carries no
 * destination or adult content.
 */
export async function createLocalAdultGateToken(creatorId: string, versionId: string) {
  requireLocalAdultPreview();
  return issueLocalPreviewToken({
    purpose: "local_adult_age_gate",
    creatorId,
    versionId,
    nonce: localPreviewNonce(),
    expiresAt: Math.floor(Date.now() / 1000) + GATE_TOKEN_MAX_AGE_SECONDS,
  } satisfies GateToken, localSecret());
}

export async function verifyLocalAdultGateToken(token: string | undefined, creatorId: string, versionId: string) {
  requireLocalAdultPreview();
  const decoded = await readLocalPreviewToken(token, localSecret());
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return "invalid" as const;
  const gate = decoded as Partial<GateToken>;
  if (gate.purpose !== "local_adult_age_gate" || typeof gate.creatorId !== "string" || typeof gate.versionId !== "string" || typeof gate.nonce !== "string" || gate.nonce.length < 16 || typeof gate.expiresAt !== "number" || !Number.isInteger(gate.expiresAt)) return "invalid" as const;
  if (gate.expiresAt <= Math.floor(Date.now() / 1000)) return "expired" as const;
  if (gate.creatorId !== creatorId) return "creator_mismatch" as const;
  if (gate.versionId !== versionId) return "version_mismatch" as const;
  return "valid" as const;
}

export function localAdultPreviewCookie(token: string) {
  return `${COOKIE_NAME}=${token}; Path=/public-profile/preview/adult; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`;
}

export { COOKIE_NAME as localAdultPreviewCookieName };
