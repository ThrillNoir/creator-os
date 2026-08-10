import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COMPOSIO_API_ROOT = "https://backend.composio.dev/api";
const COMPOSIO_API_BASE = `${COMPOSIO_API_ROOT}/v3`;
export const COMPOSIO_OAUTH_COOKIE = "creator_os_composio_oauth";

type StatePayload = {
  creatorId: string;
  accountId: string;
  nonce: string;
  expiresAt: number;
};

type LinkResponse = {
  redirect_url: string;
  connected_account_id: string;
  expires_at?: string;
};

type InstagramIdentity = {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
};

export type ComposioCreatorService = "dropbox" | "reddit" | "youtube" | "telegram";

export type CreatorServiceIdentity = {
  externalAccountId: string;
  displayName: string;
  email: string;
};

function baseUrl() {
  return process.env.CREATOR_OS_BASE_URL?.trim() || "http://localhost:3000";
}

function stateSecret() {
  const secret = process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim();
  if (!secret) throw new Error("OAuth state protection is not configured.");
  return secret;
}

function apiKey() {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) throw new Error("Composio API key is not configured.");
  return key;
}

export function getComposioConfiguration() {
  const instagramAuthConfigId = process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID?.trim() || "";
  const dropboxAuthConfigId = process.env.COMPOSIO_DROPBOX_AUTH_CONFIG_ID?.trim() || "";
  const redditAuthConfigId = process.env.COMPOSIO_REDDIT_AUTH_CONFIG_ID?.trim() || "";
  const youtubeAuthConfigId = process.env.COMPOSIO_YOUTUBE_AUTH_CONFIG_ID?.trim() || "";
  const telegramAuthConfigId = process.env.COMPOSIO_TELEGRAM_AUTH_CONFIG_ID?.trim() || "";
  return {
    ready: Boolean(process.env.COMPOSIO_API_KEY?.trim() && instagramAuthConfigId && process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim()),
    callbackUrl: new URL("/api/connections/composio/callback", baseUrl()).toString(),
    checks: {
      apiKey: Boolean(process.env.COMPOSIO_API_KEY?.trim()),
      instagramAuthConfig: Boolean(instagramAuthConfigId),
      stateSecret: Boolean(process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim()),
    },
    instagramAuthConfigId,
    dropboxAuthConfigId,
    redditAuthConfigId,
    youtubeAuthConfigId,
    telegramAuthConfigId,
  };
}

export async function createComposioServiceLink(input: {
  creatorId: string;
  service: ComposioCreatorService;
  alias: string;
  callbackUrl: string;
}) {
  const config = getComposioConfiguration();
  const authConfigId = {
    dropbox: config.dropboxAuthConfigId,
    reddit: config.redditAuthConfigId,
    youtube: config.youtubeAuthConfigId,
    telegram: config.telegramAuthConfigId,
  }[input.service];
  if (!process.env.COMPOSIO_API_KEY?.trim() || !authConfigId) throw new Error(`${input.service} is not configured.`);
  return composioRequest<LinkResponse>("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({
      auth_config_id: authConfigId,
      user_id: `creator-os:${input.creatorId}:service:${input.service}`,
      alias: input.alias,
      callback_url: input.callbackUrl,
    }),
  });
}

async function executeComposioProxy<T>(input: {
  connectedAccountId: string;
  endpoint: string;
}) {
  const response = await composioRequest<{ status: number; data?: T }>("/v3.1/tools/execute/proxy", {
    method: "POST",
    body: JSON.stringify({
      connected_account_id: input.connectedAccountId,
      endpoint: input.endpoint,
      method: "GET",
    }),
  });
  if (response.status < 200 || response.status >= 300 || !response.data) {
    throw new Error(`Composio identity request failed (${response.status}).`);
  }
  return response.data;
}

export async function verifyComposioCreatorServiceIdentity(
  service: ComposioCreatorService,
  connectedAccountId: string,
  entityId: string,
): Promise<CreatorServiceIdentity> {
  if (service === "dropbox") {
    const identity = await executeComposioTool<{
      account_id?: string;
      email?: string;
      name?: { display_name?: string } | string;
      display_name?: string;
    }>({ slug: "DROPBOX_GET_ABOUT_ME", connectedAccountId, entityId, arguments: {} });
    const displayName = typeof identity.name === "string" ? identity.name : identity.name?.display_name || identity.display_name || "Dropbox account";
    return {
      externalAccountId: identity.account_id || identity.email || displayName,
      displayName,
      email: identity.email || "",
    };
  }

  if (service === "reddit") {
    const identity = await executeComposioProxy<{ id?: string; name?: string }>({
      connectedAccountId,
      endpoint: "/api/v1/me",
    });
    if (!identity.id || !identity.name) throw new Error("Reddit identity could not be verified.");
    return { externalAccountId: identity.id, displayName: `u/${identity.name}`, email: "" };
  }

  if (service === "telegram") {
    const response = await executeComposioTool<{
      ok?: boolean;
      result?: { id?: number; username?: string; first_name?: string; is_bot?: boolean };
    }>({ slug: "TELEGRAM_GET_ME", connectedAccountId, entityId, arguments: {} });
    const identity = response.result;
    if (!response.ok || !identity?.id || !identity.is_bot) throw new Error("Telegram bot identity could not be verified.");
    return {
      externalAccountId: String(identity.id),
      displayName: identity.username ? `@${identity.username}` : identity.first_name || "Telegram bot",
      email: "",
    };
  }

  const result = await executeComposioProxy<{
    items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
  }>({
    connectedAccountId,
    endpoint: "https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet&mine=true",
  });
  const channel = result.items?.[0];
  if (!channel?.id) throw new Error("No YouTube channel was found for the authorized Google account.");
  const title = channel.snippet?.title || "YouTube channel";
  const handle = channel.snippet?.customUrl ? ` (${channel.snippet.customUrl})` : "";
  return { externalAccountId: channel.id, displayName: `${title}${handle}`, email: "" };
}

async function composioRequest<T>(path: string, init: RequestInit) {
  const requestUrl = path.startsWith("/v3.1/") ? `${COMPOSIO_API_ROOT}${path}` : `${COMPOSIO_API_BASE}${path}`;
  const response = await fetch(requestUrl, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey(),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.error?.message === "string"
          ? payload.error.message
          : `Composio request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export async function executeComposioTool<T>(input: {
  slug: string;
  connectedAccountId: string;
  entityId: string;
  arguments: Record<string, unknown>;
}) {
  const response = await composioRequest<{ successful: boolean; data?: T; error?: string | { message?: string } }>(
    `/tools/execute/${input.slug}`,
    {
      method: "POST",
      body: JSON.stringify({
        connected_account_id: input.connectedAccountId,
        entity_id: input.entityId,
        version: "latest",
        arguments: input.arguments,
      }),
    },
  );
  if (!response.successful) {
    const message = typeof response.error === "string" ? response.error : response.error?.message;
    throw new Error(message || `${input.slug} failed.`);
  }
  if (!response.data) throw new Error(`${input.slug} returned no data.`);
  return response.data;
}

export async function createComposioInstagramLink(input: {
  creatorId: string;
  accountId: string;
  alias: string;
  callbackUrl: string;
}) {
  const config = getComposioConfiguration();
  if (!config.ready) throw new Error("Composio is not configured.");
  return composioRequest<LinkResponse>("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({
      auth_config_id: config.instagramAuthConfigId,
      user_id: `creator-os:${input.creatorId}:${input.accountId}`,
      alias: input.alias,
      callback_url: input.callbackUrl,
    }),
  });
}

export function createComposioOAuthState(input: Omit<StatePayload, "nonce" | "expiresAt">) {
  const payload: StatePayload = {
    ...input,
    nonce: randomBytes(24).toString("base64url"),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(encoded).digest("base64url");
  return { state: `${encoded}.${signature}`, nonce: payload.nonce };
}

export function verifyComposioOAuthState(state: string, cookieNonce?: string) {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !cookieNonce) throw new Error("Composio connection state is incomplete.");
  const expected = createHmac("sha256", stateSecret()).update(encoded).digest("base64url");
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error("Composio connection state is invalid.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StatePayload;
  if (payload.nonce !== cookieNonce || payload.expiresAt < Date.now()) throw new Error("Composio connection state expired.");
  return payload;
}

export async function verifyComposioInstagramIdentity(connectedAccountId: string, entityId: string) {
  const identity = await executeComposioTool<InstagramIdentity>({
    slug: "INSTAGRAM_GET_USER_INFO",
    connectedAccountId,
    entityId,
    arguments: {},
  });
  if (!identity.id || !identity.username) throw new Error("Instagram identity could not be verified through Composio.");
  return identity;
}
