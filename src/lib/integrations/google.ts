import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_COOKIE = "creator_os_google_oauth_nonce";
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export function getGoogleConfiguration() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const baseUrl = (process.env.CREATOR_OS_BASE_URL?.trim() ?? "http://localhost:3000").replace(/\/$/, "");
  const sharedReady = Boolean(
    process.env.CREATOR_OS_TOKEN_ENCRYPTION_KEY?.trim()
    && process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim()
  );
  return {
    clientId,
    clientSecret,
    baseUrl,
    redirectUri: `${baseUrl}/api/connections/google/callback`,
    ready: Boolean(clientId && clientSecret && sharedReady),
    checks: { clientId: Boolean(clientId), clientSecret: Boolean(clientSecret), secureStorage: sharedReady },
  };
}

function stateSecret() {
  const value = process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim();
  if (!value) throw new Error("OAuth state protection is not configured.");
  return value;
}

export function createGoogleOAuthState(creatorId: string, accountId: string) {
  const payload = { creatorId, accountId, nonce: randomBytes(24).toString("base64url"), issuedAt: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(`google.${encoded}`).digest("base64url");
  return { state: `${encoded}.${signature}`, nonce: payload.nonce };
}

export function verifyGoogleOAuthState(state: string, cookieNonce?: string) {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !cookieNonce) throw new Error("OAuth state is incomplete.");
  const expected = createHmac("sha256", stateSecret()).update(`google.${encoded}`).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("OAuth state is invalid.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    creatorId: string; accountId: string; nonce: string; issuedAt: number;
  };
  if (payload.nonce !== cookieNonce || Date.now() - payload.issuedAt > 10 * 60 * 1000) throw new Error("OAuth request expired or belongs to another browser.");
  return payload;
}

async function googleJson<T>(response: Response, label: string) {
  const body = await response.json() as T & { error?: string | { message?: string }; error_description?: string };
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(`${label}: ${body.error_description ?? error ?? `HTTP ${response.status}`}`);
  }
  return body;
}

export async function exchangeGoogleAuthorizationCode(code: string) {
  const config = getGoogleConfiguration();
  if (!config.ready) throw new Error("Google connection settings are incomplete.");
  const token = await googleJson<{
    access_token: string; expires_in: number; refresh_token?: string; scope: string; token_type: string;
  }>(await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  }), "Google token exchange failed");
  const channelsUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
  channelsUrl.search = new URLSearchParams({ part: "id,snippet", mine: "true" }).toString();
  const channels = await googleJson<{
    items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }>;
  }>(await fetch(channelsUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  }), "YouTube channel verification failed");
  const channel = channels.items?.[0];
  if (!channel?.id) throw new Error("The selected Google account does not expose a YouTube channel.");
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    scopes: token.scope.split(/\s+/).filter(Boolean),
    channelId: channel.id,
    channelTitle: channel.snippet?.title ?? "",
    customUrl: channel.snippet?.customUrl ?? "",
  };
}
