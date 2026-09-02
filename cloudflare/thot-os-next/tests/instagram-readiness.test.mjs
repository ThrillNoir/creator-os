import assert from "node:assert/strict";
import test from "node:test";
import { instagramSendingBlocker } from "../src/lib/instagram-readiness.ts";

const connected = { status: "connected", write_enabled: 1, outbound_validated: 1, last_error: null };

test("Instagram readiness reports the selected account's first real blocker", () => {
  assert.equal(instagramSendingBlocker(connected, true, false), null);
  assert.match(instagramSendingBlocker(undefined, true, false), /selected Instagram account.*not connected/);
  assert.match(instagramSendingBlocker({ ...connected, status: "restricted", last_error: "Instagram messaging is restricted for this account." }, true, false), /restricted/);
  assert.match(instagramSendingBlocker({ ...connected, write_enabled: 0 }, true, false), /sending authority is disabled/);
  assert.match(instagramSendingBlocker({ ...connected, outbound_validated: 0 }, true, false), /Validate the recipient/);
  assert.match(instagramSendingBlocker(connected, false, false), /reply window is closed/);
  assert.match(instagramSendingBlocker(connected, true, true), /paused/);
});
