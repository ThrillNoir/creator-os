import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getLocalBridgeUrl, isLocalBridgePlatform, localBridgeProfilePath, normalisePlatformUsername } from "../src/lib/local-bridge/config.ts";

test("recognises only supported premium bridge platforms", () => {
  assert.equal(isLocalBridgePlatform("onlyfans"), true);
  assert.equal(isLocalBridgePlatform("fansly"), true);
  assert.equal(isLocalBridgePlatform("instagram"), false);
});

test("uses isolated profile paths beneath the approved root", () => {
  const root = path.resolve(".creator-os", "browser-profiles");
  assert.equal(localBridgeProfilePath(root, "adelaide", "adelaide-onlyfans-main"), path.join(root, "adelaide", "adelaide-onlyfans-main"));
  assert.throws(() => localBridgeProfilePath(root, "../adelaide", "account"));
});

test("normalises handles and uses HTTPS native destinations", () => {
  assert.equal(normalisePlatformUsername(" @Adelaide "), "adelaide");
  assert.match(getLocalBridgeUrl("onlyfans", "inbox"), /^https:\/\/onlyfans\.com\//);
  assert.match(getLocalBridgeUrl("fansly", "earnings"), /^https:\/\/fansly\.com\//);
});
