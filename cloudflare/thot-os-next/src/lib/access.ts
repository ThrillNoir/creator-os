import { headers } from "next/headers";
import { cloudflareEnv } from "./cloudflare";

type AccessClaims = { aud: string | string[]; email?: string; exp?: number; nbf?: number };
type AccessJwk = JsonWebKey & { kid?: string };
let cachedKeys: Promise<AccessJwk[]> | null = null;

function decodeBase64Url(value: string) {
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalised), (character) => character.charCodeAt(0));
}

export async function requireAccessIdentity() {
  const env = cloudflareEnv();
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  if (env.LOCAL_ACCESS_BYPASS === "1" && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return { email: env.ACCESS_ALLOWED_EMAIL };
  }
  const token = requestHeaders.get("cf-access-jwt-assertion");
  if (!token) throw new Error("Cloudflare Access identity is required.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Cloudflare Access token is invalid.");

  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as { alg?: string; kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as AccessClaims;
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (header.alg !== "RS256" || !header.kid || !audiences.includes(env.ACCESS_AUD) || !claims.exp || claims.exp <= now || (claims.nbf ?? 0) > now) {
    throw new Error("Cloudflare Access token is invalid.");
  }
  if (claims.email?.toLowerCase() !== env.ACCESS_ALLOWED_EMAIL.toLowerCase()) {
    throw new Error("This Cloudflare identity is not authorised for THOT OS.");
  }

  cachedKeys ??= fetch(env.ACCESS_JWKS_URL).then(async (response) => {
    if (!response.ok) throw new Error("Cloudflare Access keys are unavailable.");
    return ((await response.json()) as { keys: AccessJwk[] }).keys;
  });
  const jwk = (await cachedKeys).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Cloudflare Access signing key was not found.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("Cloudflare Access signature is invalid.");
  return { email: claims.email };
}
