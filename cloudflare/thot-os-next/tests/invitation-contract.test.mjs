import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("invitation lifecycle is hash-only and Access-gated", async () => {
  const [migration, access, actions, layout, config] = await Promise.all([
    source("../../thot-os-app/migrations/0056_creator_invitations.sql"),
    source("../src/lib/access.ts"),
    source("../src/app/identity-actions.ts"),
    source("../src/app/layout.tsx"),
    source("../wrangler.jsonc"),
  ]);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(migration, /WHERE status='pending'/);
  assert.match(actions, /crypto\.getRandomValues/);
  assert.match(actions, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(actions, /invited_email\.toLowerCase\(\) !== identity\.email/);
  assert.match(actions, /status='accepted'/);
  assert.match(access, /export async function verifyAccessIdentity/);
  assert.match(layout, /verifyAccessIdentity/);
  assert.match(config, /"send_email"/);
  assert.match(config, /"name": "EMAIL"/);
  assert.match(config, /"allowed_sender_addresses": \["welcome@thathuboverthere\.com"\]/);
  assert.doesNotMatch(config, /destination_address/);
  assert.doesNotMatch(actions, /console\.(log|info|debug).*token/);
});
