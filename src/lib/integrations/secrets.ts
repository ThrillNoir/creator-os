import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const configured = process.env.CREATOR_OS_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("Token encryption is not configured.");
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("Token encryption key must be a base64-encoded 32-byte value.");
  return key;
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string) {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Encrypted token has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
