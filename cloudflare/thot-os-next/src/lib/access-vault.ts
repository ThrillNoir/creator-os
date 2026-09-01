import "server-only";

import { cloudflareEnv } from "./cloudflare";
import type { CreatorRole } from "./authorization";

const encoder = new TextEncoder();
// Cloudflare Workers Web Crypto rejects PBKDF2 counts above 100,000. The
// verifier also includes a per-record random salt and the secret vault pepper.
const PIN_ITERATIONS = 100_000;
const MAX_PIN_ITERATIONS = 100_000;
export const STEP_UP_COOKIE = "thot_os_access_step_up";

type CredentialCipher = {
  wrappedDek: ArrayBuffer;
  wrappedDekNonce: ArrayBuffer;
  ciphertext: ArrayBuffer;
  ciphertextNonce: ArrayBuffer;
  keyVersion: number;
};

type CredentialCipherRow = {
  id: string; creator_id: string; account_id: string | null; wrapped_dek: ArrayBuffer;
  wrapped_dek_nonce: ArrayBuffer; ciphertext: ArrayBuffer; ciphertext_nonce: ArrayBuffer; key_version: number;
};

function decodeBase64(value: string) {
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (!bytes.byteLength) throw new Error("empty");
    return bytes;
  } catch { throw new Error("Access vault is unavailable."); }
}

function vaultMasterKey(version: number) {
  if (version !== 1) throw new Error("Access vault is unavailable.");
  const value = (cloudflareEnv() as CloudflareEnv & { VAULT_MASTER_KEY_V1?: string }).VAULT_MASTER_KEY_V1;
  if (!value) throw new Error("Access vault is unavailable.");
  const key = decodeBase64(value);
  if (key.byteLength !== 32) throw new Error("Access vault is unavailable.");
  return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function pinPepper() {
  const value = (cloudflareEnv() as CloudflareEnv & { VAULT_PIN_PEPPER?: string }).VAULT_PIN_PEPPER;
  if (!value) throw new Error("Access vault is unavailable.");
  return decodeBase64(value);
}

function aad(creatorId: string, credentialId: string, accountId: string | null, version: number) {
  return encoder.encode(`creator-os-access:${version}:${creatorId}:${credentialId}:${accountId ?? "none"}`);
}

function random(size: number) { return crypto.getRandomValues(new Uint8Array(size)); }

function equal(left: Uint8Array, right: Uint8Array) {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export function validatePin(value: unknown) {
  const pin = String(value ?? "");
  if (!/^\d{4}$/.test(pin)) throw new Error("Enter a four-digit PIN.");
  return pin;
}

async function pinVerifier(pin: string, salt: ArrayBuffer | Uint8Array, iterations = PIN_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PIN_ITERATIONS) throw new Error("Access PIN verifier is unavailable.");
  const combinedSalt = new Uint8Array((salt instanceof Uint8Array ? salt : new Uint8Array(salt)).byteLength + pinPepper().byteLength);
  combinedSalt.set(salt instanceof Uint8Array ? salt : new Uint8Array(salt));
  combinedSalt.set(pinPepper(), combinedSalt.byteLength - pinPepper().byteLength);
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: combinedSalt, iterations }, key, 256));
}

export async function encryptCredentialPassword(input: { creatorId: string; credentialId: string; accountId: string | null; password: string; notes?: string }): Promise<CredentialCipher> {
  const keyVersion = 1;
  const master = await vaultMasterKey(keyVersion);
  const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const plaintextNonce = random(12);
  const wrappingNonce = random(12);
  const context = aad(input.creatorId, input.credentialId, input.accountId, keyVersion);
  const [ciphertext, rawDek] = await Promise.all([
    crypto.subtle.encrypt({ name: "AES-GCM", iv: plaintextNonce, additionalData: context }, dek, encoder.encode(JSON.stringify({ password: input.password, notes: input.notes ?? "" }))),
    crypto.subtle.exportKey("raw", dek),
  ]);
  const wrappedDek = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrappingNonce, additionalData: context }, master, rawDek);
  return { wrappedDek, wrappedDekNonce: wrappingNonce.buffer, ciphertext, ciphertextNonce: plaintextNonce.buffer, keyVersion };
}

export async function decryptCredentialPassword(row: CredentialCipherRow) {
  const master = await vaultMasterKey(row.key_version);
  const context = aad(row.creator_id, row.id, row.account_id, row.key_version);
  try {
    const rawDek = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.wrapped_dek_nonce, additionalData: context }, master, row.wrapped_dek);
    const dek = await crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.ciphertext_nonce, additionalData: context }, dek, row.ciphertext);
    const value = new TextDecoder().decode(plaintext);
    try { return (JSON.parse(value) as { password?: string }).password ?? value; } catch { return value; }
  } catch { throw new Error("Access vault is unavailable."); }
}

export async function savePinVerifier(input: { email: string; creatorId: string; role: CreatorRole; pin: string }) {
  const scope = input.role === "agency_admin" ? "administrator" : "creator";
  if (scope === "creator" && input.role !== "creator") throw new Error("Only a creator or agency administrator can set an Access PIN.");
  const salt = random(16);
  const verifier = await pinVerifier(input.pin, salt);
  const DB = cloudflareEnv().DB;
  const id = crypto.randomUUID();
  if (scope === "administrator") {
    await DB.prepare(`INSERT INTO vault_pin_verifiers (id,identity_email,creator_id,pin_scope,salt,verifier,kdf_iterations,failure_count,failure_cycles,locked_until)
      VALUES (?,?,NULL,'administrator',?,?,?,0,0,NULL)
      ON CONFLICT(identity_email) WHERE pin_scope='administrator' DO UPDATE SET salt=excluded.salt,verifier=excluded.verifier,kdf_iterations=excluded.kdf_iterations,failure_count=0,failure_cycles=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(id, input.email, salt.buffer, verifier.buffer, PIN_ITERATIONS).run();
  } else {
    await DB.prepare(`INSERT INTO vault_pin_verifiers (id,identity_email,creator_id,pin_scope,salt,verifier,kdf_iterations,failure_count,failure_cycles,locked_until)
      VALUES (?,?,?,'creator',?,?,?,0,0,NULL)
      ON CONFLICT(identity_email,creator_id) WHERE pin_scope='creator' DO UPDATE SET salt=excluded.salt,verifier=excluded.verifier,kdf_iterations=excluded.kdf_iterations,failure_count=0,failure_cycles=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(id, input.email, input.creatorId, salt.buffer, verifier.buffer, PIN_ITERATIONS).run();
  }
  return scope;
}

type PinRow = { id: string; pin_scope: "creator" | "administrator"; salt: ArrayBuffer; verifier: ArrayBuffer; kdf_iterations: number; locked_until: string | null };

export async function verifyPinAndCreateSession(input: { email: string; creatorId: string; role: CreatorRole; pin: string }) {
  const DB = cloudflareEnv().DB;
  const scopes: Array<"administrator" | "creator"> = input.role === "agency_admin" ? ["administrator", "creator"] : ["creator"];
  const row = await DB.prepare(`SELECT id,pin_scope,salt,verifier,kdf_iterations,locked_until FROM vault_pin_verifiers
    WHERE lower(identity_email)=lower(?) AND ((pin_scope='administrator' AND creator_id IS NULL) OR (pin_scope='creator' AND creator_id=?))
    ORDER BY CASE pin_scope WHEN 'administrator' THEN 0 ELSE 1 END LIMIT 1`).bind(input.email, input.creatorId).first<PinRow>();
  if (!row || !scopes.includes(row.pin_scope)) throw new Error("Set up your Access PIN before continuing.");
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) throw new Error("Access PIN is temporarily locked. Try again later.");
  const candidate = await pinVerifier(input.pin, row.salt, row.kdf_iterations);
  if (!equal(candidate, new Uint8Array(row.verifier))) {
    // This conditional increment is the concurrency boundary: the fifth failed
    // request locks the verifier before any concurrent request can reset it.
    await DB.prepare(`UPDATE vault_pin_verifiers SET
      failure_count=failure_count+1,
      failure_cycles=failure_cycles+CASE WHEN failure_count+1>=5 THEN 1 ELSE 0 END,
      locked_until=CASE WHEN failure_count+1>=5 THEN datetime('now','+' || (5*(failure_cycles+1)) || ' minutes') ELSE locked_until END,
      failure_count=CASE WHEN failure_count+1>=5 THEN 0 ELSE failure_count+1 END,
      updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND (locked_until IS NULL OR unixepoch(locked_until)<=unixepoch(CURRENT_TIMESTAMP))`).bind(row.id).run();
    throw new Error("Access PIN could not be verified.");
  }
  const sessionId = crypto.randomUUID();
  await DB.batch([
    DB.prepare("UPDATE vault_pin_verifiers SET failure_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id),
    DB.prepare(`INSERT INTO vault_step_up_sessions (id,identity_email,creator_id,actor_role,pin_scope,expires_at)
      VALUES (?,?,?,?,?,datetime('now','+5 minutes'))`).bind(sessionId, input.email, input.creatorId, input.role, row.pin_scope),
  ]);
  return { sessionId, scope: row.pin_scope };
}

export async function requireStepUpSession(input: { sessionId: string | undefined; email: string; creatorId: string; role: CreatorRole }) {
  if (!input.sessionId) throw new Error("Confirm your Access PIN before continuing.");
  const row = await cloudflareEnv().DB.prepare(`SELECT id,pin_scope FROM vault_step_up_sessions
    WHERE id=? AND lower(identity_email)=lower(?) AND creator_id=? AND actor_role=? AND revoked_at IS NULL AND unixepoch(expires_at)>unixepoch(CURRENT_TIMESTAMP)`)
    .bind(input.sessionId, input.email, input.creatorId, input.role).first<{ id: string; pin_scope: "creator" | "administrator" }>();
  if (!row) throw new Error("Confirm your Access PIN before continuing.");
  if (input.role === "creator" && row.pin_scope !== "creator") throw new Error("Confirm your Access PIN before continuing.");
  return row;
}

export async function revokeStepUpSessions(email: string) {
  await cloudflareEnv().DB.prepare("UPDATE vault_step_up_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE lower(identity_email)=lower(?) AND revoked_at IS NULL").bind(email).run();
}

export function noStoreJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private", Pragma: "no-cache", Vary: "Cookie" } });
}
