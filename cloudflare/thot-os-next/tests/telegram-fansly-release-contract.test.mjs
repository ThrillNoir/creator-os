import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Fansly sends require a native browser receipt before sent status", async () => {
  const bridge = await source("../vault-bridge/src/index.ts");
  assert.match(bridge, /proof\?\.sent === true/);
  assert.match(bridge, /proof\?\.composerCount === 1/);
  assert.match(bridge, /proof\?\.outgoingBubbleAdded === true/);
  assert.match(bridge, /const sent = input\.sent === true && receiptConfirmed/);
});

test("Telegram refuses ambiguous creator chat routing", async () => {
  const bridge = await source("../telegram-bridge/src/index.ts");
  assert.match(bridge, /Telegram chat identity is assigned to more than one creator/);
});

test("Telegram collector binds pending starts before advancing the shared cursor", async () => {
  const bridge = await source("../telegram-bridge/src/index.ts");
  assert.match(bridge, /status IN \('pending_validation','connected','failed'\)/);
  const bind = bridge.indexOf("await bindPairing(env, pendingState, message)");
  const advance = bridge.indexOf("UPDATE telegram_bot_state SET next_update_id=?", bind);
  assert.ok(bind > 0 && advance > bind);
  assert.match(bridge, /if \(state\.chat_id && state\.telegram_user_id\) return \{ ok: true/);
});
