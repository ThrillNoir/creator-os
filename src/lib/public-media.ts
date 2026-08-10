import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

function mediaSecret() {
  const secret = process.env.CREATOR_OS_OAUTH_STATE_SECRET?.trim();
  if (!secret) throw new Error("Public media signing is not configured.");
  return secret;
}

export function getPublicMediaConfiguration() {
  const baseUrl = process.env.CREATOR_OS_PUBLIC_MEDIA_BASE_URL?.trim() || "";
  let validHttpsOrigin = false;
  try {
    const parsed = new URL(baseUrl);
    validHttpsOrigin = parsed.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    validHttpsOrigin = false;
  }
  return { baseUrl, ready: validHttpsOrigin };
}

function signaturePayload(creatorId: string, relativePath: string, expires: number) {
  return `${creatorId}\n${relativePath}\n${expires}`;
}

export function createSignedPublicMediaUrl(creatorId: string, relativePath: string, lifetimeSeconds = 30 * 60) {
  const config = getPublicMediaConfiguration();
  if (!config.ready) throw new Error("A public HTTPS media origin is required before Instagram publishing.");
  const expires = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const signature = createHmac("sha256", mediaSecret()).update(signaturePayload(creatorId, relativePath, expires)).digest("base64url");
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`/api/public-media/${encodedPath}`, config.baseUrl);
  url.searchParams.set("creator", creatorId);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

export function verifySignedPublicMediaRequest(input: { creatorId: string; relativePath: string; expires: number; signature: string }) {
  if (!Number.isInteger(input.expires) || input.expires < Math.floor(Date.now() / 1000)) return false;
  if (input.expires > Math.floor(Date.now() / 1000) + 60 * 60) return false;
  const expected = createHmac("sha256", mediaSecret()).update(signaturePayload(input.creatorId, input.relativePath, input.expires)).digest("base64url");
  const supplied = Buffer.from(input.signature);
  const correct = Buffer.from(expected);
  return supplied.length === correct.length && timingSafeEqual(supplied, correct);
}
