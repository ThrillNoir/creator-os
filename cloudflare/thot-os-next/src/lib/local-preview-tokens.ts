const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(standard), (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function localPreviewNonce() {
  return base64Url(crypto.getRandomValues(new Uint8Array(18)));
}

export async function issueLocalPreviewToken(value: object, secret: string) {
  const payload = base64Url(encoder.encode(JSON.stringify(value)));
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload))));
  return `${payload}.${signature}`;
}

export async function readLocalPreviewToken(token: string | undefined, secret: string): Promise<unknown | null> {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const verified = await crypto.subtle.verify("HMAC", await signingKey(secret), fromBase64Url(signature), encoder.encode(payload));
    return verified ? JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as unknown : null;
  } catch {
    return null;
  }
}
