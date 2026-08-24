import assert from "node:assert/strict";
import test from "node:test";
import { publicationIsAllowed, publicationPolicy } from "../src/publication-policy.ts";
import { markProjectionDeliveredFailClosed, writeProjectionFailClosed } from "../src/projection-delivery.ts";

test("publication policy fails closed and synthetic-only never trusts caller input", () => {
  assert.equal(publicationIsAllowed(publicationPolicy(undefined, undefined), "creator-a"), false);
  assert.equal(publicationIsAllowed(publicationPolicy("unexpected", "creator-a"), "creator-a"), false);
  const syntheticOnly = publicationPolicy("synthetic-only", "staging-synthetic-creator, bad creator id");
  assert.equal(publicationIsAllowed(syntheticOnly, "staging-synthetic-creator"), true);
  assert.equal(publicationIsAllowed(syntheticOnly, "real-creator"), false);
  assert.equal(publicationIsAllowed(publicationPolicy("enabled", ""), "real-creator"), true);
});

test("a projection write failure records a safe reason and never records delivery", async () => {
  const events = [];
  await assert.rejects(
    writeProjectionFailClosed({
      write: async () => { events.push("write"); throw new Error("provider detail must not be logged"); },
      recordFailure: async (reason) => { events.push(reason); },
    }),
    /projection_write_failed/,
  );
  assert.deepEqual(events, ["write", "projection_write_failed"]);
});

test("a receipt failure leaves a retryable delivery record after the projection", async () => {
  const events = [];
  await assert.rejects(
    markProjectionDeliveredFailClosed({
      markDelivered: async () => { events.push("receipt"); throw new Error("d1 unavailable"); },
      recordFailure: async (reason) => { events.push(reason); },
    }),
    /projection_receipt_failed/,
  );
  assert.deepEqual(events, ["receipt", "projection_receipt_failed"]);
});

test("retrying a pending intent is idempotent at the external projection boundary", async () => {
  let writes = 0;
  let delivered = 0;
  const recordFailure = async () => { throw new Error("unexpected failure"); };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await writeProjectionFailClosed({ write: async () => { writes += 1; }, recordFailure });
  }
  await markProjectionDeliveredFailClosed({ markDelivered: async () => { delivered += 1; }, recordFailure });
  assert.equal(writes, 2);
  assert.equal(delivered, 1);
});
