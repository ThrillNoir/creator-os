import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("catalogue refresh reconciles a moved Dropbox file by its tenant-scoped stable ID before path", async () => {
  const source = await readFile(new URL("../../vault-bridge/src/index.ts", import.meta.url), "utf8");
  assert.match(source, /ON CONFLICT\(id,creator_id\) DO UPDATE SET relative_path=excluded\.relative_path[\s\S]*ON CONFLICT\(id\) DO UPDATE SET relative_path=excluded\.relative_path[\s\S]*WHERE assets\.creator_id=excluded\.creator_id[\s\S]*ON CONFLICT\(creator_id,relative_path\) DO UPDATE/);
});

test("Dropbox reconnection stays behind a creator-scoped internal capability", async () => {
  const source = await readFile(new URL("../../vault-bridge/src/index.ts", import.meta.url), "utf8");
  assert.match(source, /requireInternalServiceForCreator\(request, env\.DB, creatorId, "thot-os-web-vault-catalogue", "vault\.catalogue\.connection\.manage"\)/);
  assert.match(source, /auth_configs\?toolkit_slug=dropbox&limit=10/);
  assert.match(source, /THOT OS Dropbox catalogue \(read-only\)/);
  assert.match(source, /Never fall back to the project default/);
  assert.match(source, /files\.metadata\.read,files\.content\.read/);
  assert.match(source, /restrict_to_following_tools: READ_ONLY_DROPBOX_TOOLS/);
  assert.match(source, /connected_accounts\/link/);
  assert.match(source, /user_id: `creator-os:\$\{creatorId\}:service:dropbox`/);
});
