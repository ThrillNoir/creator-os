import { headers } from "next/headers";
import { cloudflareEnv } from "./cloudflare";

type AccessClaims = { aud: string | string[]; email?: string; exp?: number; nbf?: number };
type AccessJwk = JsonWebKey & { kid?: string };
const JWKS_CACHE_TTL_MS = 5 * 60_000;
let cachedKeys: { expiresAt: number; keys: Promise<AccessJwk[]> } | null = null;

function decodeBase64Url(value: string) {
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalised), (character) => character.charCodeAt(0));
}

async function accessKeys(url: string, forceRefresh = false) {
  if (forceRefresh || !cachedKeys || cachedKeys.expiresAt <= Date.now()) {
    cachedKeys = {
      expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
      keys: fetch(url).then(async (response) => {
        if (!response.ok) throw new Error("Cloudflare Access keys are unavailable.");
        return ((await response.json()) as { keys: AccessJwk[] }).keys;
      }),
    };
  }
  return cachedKeys.keys;
}

export async function requireAccessIdentity() {
  const env = cloudflareEnv();
  const localEnv = env as CloudflareEnv & { LOCAL_ACCESS_BYPASS?: string };
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  if (localEnv.LOCAL_ACCESS_BYPASS === "1" && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return { email: env.ACCESS_ALLOWED_EMAIL.toLowerCase() };
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
  if (!claims.email) throw new Error("Cloudflare Access did not provide an email identity.");

  let jwk = (await accessKeys(env.ACCESS_JWKS_URL)).find((key) => key.kid === header.kid);
  // Refresh once for rotation or retirement before treating the assertion as
  // invalid. A warm isolate must not retain a removed key indefinitely.
  if (!jwk) jwk = (await accessKeys(env.ACCESS_JWKS_URL, true)).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Cloudflare Access signing key was not found.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("Cloudflare Access signature is invalid.");
  const email = claims.email.toLowerCase();
  const user = await env.DB.prepare("SELECT email FROM users WHERE lower(email)=? AND status='active'").bind(email).first<{ email: string }>();
  if (!user) throw new Error("This Cloudflare identity is not an active THOT OS user.");
  return { email };
}
