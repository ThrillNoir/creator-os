import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const META_OAUTH_COOKIE = "creator_os_meta_oauth_nonce";
export const META_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export function getMetaConfiguration() {
  const appId = process.env.META_INSTAGRAM_APP_ID?.trim() ?? "";
  const appSecret = process.env.META_INSTAGRAM_APP_SECRET?.trim() ?? "";
  const baseUrl = process.env.CREATOR_OS_BASE_URL?.trim() ?? "http://localhost:3000";
  const graphVersion = process.env.META_GRAPH_VERSION?.trim() ?? "v23.0";
  const encryptionReady = Boolean(process.env.CREATOR_OS_TOKEN_ENCRYPTION_KEY?.trim());
  const stateReady = Boolean(process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim());
  return {
    appId,
    appSecret,
    baseUrl: baseUrl.replace(/\/$/, ""),
    graphVersion,
    redirectUri: `${baseUrl.replace(/\/$/, "")}/api/connections/meta/callback`,
    ready: Boolean(appId && appSecret && encryptionReady && stateReady),
    checks: {
      appId: Boolean(appId),
      appSecret: Boolean(appSecret),
      encryptionKey: encryptionReady,
      stateSecret: stateReady,
    },
  };
}

function stateSecret() {
  const secret = process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim();
  if (!secret) throw new Error("OAuth state protection is not configured.");
  return secret;
}

export type MetaOAuthState = {
  creatorId: string;
  accountId: string;
  nonce: string;
  issuedAt: number;
};

export function createMetaOAuthState(creatorId: string, accountId: string) {
  const payload: MetaOAuthState = {
    creatorId,
    accountId,
    nonce: randomBytes(24).toString("base64url"),
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(encoded).digest("base64url");
  return { state: `${encoded}.${signature}`, nonce: payload.nonce };
}

export function verifyMetaOAuthState(state: string, cookieNonce: string | undefined) {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !cookieNonce) throw new Error("OAuth state is incomplete.");
  const expected = createHmac("sha256", stateSecret()).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("OAuth state signature is invalid.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as MetaOAuthState;
  if (payload.nonce !== cookieNonce) throw new Error("OAuth browser session does not match.");
  if (Date.now() - payload.issuedAt > 10 * 60 * 1000) throw new Error("OAuth request expired.");
  return payload;
}

type InstagramTokenResponse = {
  access_token?: string;
  user_id?: string | number;
  permissions?: string[];
  data?: Array<{ access_token?: string; user_id?: string | number; permissions?: string[] }>;
  error_type?: string;
  code?: number;
  error_message?: string;
};

async function checkedJson<T>(response: Response, label: string) {
  const body = await response.json() as T & { error?: { message?: string }; error_message?: string };
  if (!response.ok) throw new Error(`${label}: ${body.error?.message ?? body.error_message ?? `HTTP ${response.status}`}`);
  return body;
}

export async function exchangeMetaAuthorizationCode(code: string) {
  const config = getMetaConfiguration();
  if (!config.ready) throw new Error("Meta connection settings are incomplete.");
  const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code,
    }),
    cache: "no-store",
  });
  const tokenBody = await checkedJson<InstagramTokenResponse>(tokenResponse, "Instagram token exchange failed");
  const tokenRecord = tokenBody.data?.[0] ?? tokenBody;
  if (!tokenRecord.access_token) throw new Error("Instagram returned no access token.");

  const longTokenUrl = new URL("https://graph.instagram.com/access_token");
  longTokenUrl.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: config.appSecret,
    access_token: tokenRecord.access_token,
  }).toString();
  const longToken = await checkedJson<{ access_token: string; token_type?: string; expires_in?: number }>(
    await fetch(longTokenUrl, { cache: "no-store" }),
    "Instagram long-lived token exchange failed",
  );
  const accessToken = longToken.access_token;
  const profileUrl = new URL(`https://graph.instagram.com/${config.graphVersion}/me`);
  profileUrl.search = new URLSearchParams({
    fields: "user_id,username,account_type",
    access_token: accessToken,
  }).toString();
  const profile = await checkedJson<{ id?: string; user_id?: string; username?: string; account_type?: string }>(
    await fetch(profileUrl, { cache: "no-store" }),
    "Instagram profile verification failed",
  );
  const expiresAt = longToken.expires_in
    ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
    : null;
  return {
    accessToken,
    externalAccountId: String(profile.user_id ?? profile.id ?? tokenRecord.user_id ?? ""),
    externalUsername: profile.username ?? "",
    accountType: profile.account_type ?? "",
    scopes: tokenRecord.permissions?.length ? tokenRecord.permissions : META_SCOPES,
    expiresAt,
  };
}
