import assert from "node:assert/strict";
import test from "node:test";
import { issueLocalPreviewToken, readLocalPreviewToken } from "../src/lib/local-preview-tokens.ts";

const secret = "local-preview-test-signing-key-which-is-never-a-deployment-secret";
const now = Math.floor(Date.now() / 1000);
const gate = { purpose: "local_adult_age_gate", creatorId: "creator-a", versionId: "version-a", nonce: "long-random-nonce-value", expiresAt: now + 60 };

function checkGate(value, creatorId, versionId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid";
  if (value.purpose !== "local_adult_age_gate" || typeof value.creatorId !== "string" || typeof value.versionId !== "string" || typeof value.nonce !== "string" || typeof value.expiresAt !== "number") return "invalid";
  if (value.expiresAt <= now) return "expired";
  if (value.creatorId !== creatorId) return "creator_mismatch";
  if (value.versionId !== versionId) return "version_mismatch";
  return "valid";
}

test("a local age-gate CSRF token is signed, short-lived, and bound to creator and version", async () => {
  const token = await issueLocalPreviewToken(gate, secret);
  const decoded = await readLocalPreviewToken(token, secret);
  assert.equal(checkGate(decoded, "creator-a", "version-a"), "valid");
  assert.equal(checkGate(decoded, "creator-b", "version-a"), "creator_mismatch");
  assert.equal(checkGate(decoded, "creator-a", "version-b"), "version_mismatch");
});

test("missing, expired, and tampered local age-gate CSRF tokens fail closed", async () => {
  assert.equal(await readLocalPreviewToken(undefined, secret), null);
  const token = await issueLocalPreviewToken({ ...gate, expiresAt: now - 1 }, secret);
  assert.equal(checkGate(await readLocalPreviewToken(token, secret), "creator-a", "version-a"), "expired");
  assert.equal(await readLocalPreviewToken(`${token}x`, secret), null);
  assert.equal(await readLocalPreviewToken(token, `${secret}-other`), null);
});
