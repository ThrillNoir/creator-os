import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const REDDIT_OAUTH_COOKIE = "creator_os_reddit_oauth_nonce";
export const REDDIT_SCOPES = ["identity", "submit", "read"];

export function getRedditConfiguration() {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim() ?? "";
  const userAgent = process.env.REDDIT_USER_AGENT?.trim() ?? "";
  const baseUrl = (process.env.CREATOR_OS_BASE_URL?.trim() ?? "http://localhost:3000").replace(/\/$/, "");
  const sharedReady = Boolean(process.env.CREATOR_OS_TOKEN_ENCRYPTION_KEY?.trim() && process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim());
  return {
    clientId,
    clientSecret,
    userAgent,
    baseUrl,
    redirectUri: `${baseUrl}/api/connections/reddit/callback`,
    ready: Boolean(clientId && clientSecret && userAgent && sharedReady),
    checks: { clientId: Boolean(clientId), clientSecret: Boolean(clientSecret), userAgent: Boolean(userAgent), secureStorage: sharedReady },
  };
}

function stateSecret() {
  const value = process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim();
  if (!value) throw new Error("OAuth state protection is not configured.");
  return value;
}

export function createRedditOAuthState(creatorId: string, accountId: string) {
  const payload = { creatorId, accountId, nonce: randomBytes(24).toString("base64url"), issuedAt: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(`reddit.${encoded}`).digest("base64url");
  return { state: `${encoded}.${signature}`, nonce: payload.nonce };
}

export function verifyRedditOAuthState(state: string, cookieNonce?: string) {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !cookieNonce) throw new Error("OAuth state is incomplete.");
  const expected = createHmac("sha256", stateSecret()).update(`reddit.${encoded}`).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("OAuth state is invalid.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { creatorId: string; accountId: string; nonce: string; issuedAt: number };
  if (payload.nonce !== cookieNonce || Date.now() - payload.issuedAt > 10 * 60 * 1000) throw new Error("OAuth request expired or belongs to another browser.");
  return payload;
}

async function redditJson<T>(response: Response, label: string) {
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(`${label}: ${body.message ?? body.error ?? `HTTP ${response.status}`}`);
  return body;
}

export async function exchangeRedditAuthorizationCode(code: string) {
  const config = getRedditConfiguration();
  if (!config.ready) throw new Error("Reddit connection settings are incomplete.");
  const token = await redditJson<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>(
    await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": config.userAgent,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri }),
      cache: "no-store",
    }),
    "Reddit token exchange failed",
  );
  const identity = await redditJson<{ id: string; name: string; total_karma?: number; created_utc?: number }>(
    await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": config.userAgent },
      cache: "no-store",
    }),
    "Reddit identity verification failed",
  );
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    scopes: token.scope.split(/\s+/).filter(Boolean),
    accountId: identity.id,
    username: identity.name,
    metadata: { totalKarma: identity.total_karma ?? null, createdUtc: identity.created_utc ?? null },
  };
}
