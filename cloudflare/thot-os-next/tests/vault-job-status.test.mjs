import assert from "node:assert/strict";
import test from "node:test";
import { canRetryVaultJob, vaultJobStatusCopy } from "../src/lib/vault-job-status.ts";

const uncertainCopy = "Upload outcome uncertain — check Fansly’s vault before retrying. This job is held for reconciliation.";

test("claimed or legacy failed jobs with uncertain reconciliation receipts get the held warning", () => {
  assert.equal(vaultJobStatusCopy("claimed", '{"outcome":"uncertain"}'), uncertainCopy);
  assert.equal(vaultJobStatusCopy("claimed", '{"reconciliationRequired":true}'), uncertainCopy);
  assert.equal(vaultJobStatusCopy("claimed", { outcome: "uncertain" }), uncertainCopy);
  assert.equal(vaultJobStatusCopy("claimed", '{"outcome":"staged"}'), "Transfer is in progress");
  assert.equal(vaultJobStatusCopy("claimed", "not-json"), "Transfer is in progress");
  assert.equal(vaultJobStatusCopy("claimed", null), "Transfer is in progress");
  assert.equal(vaultJobStatusCopy("failed", '{"outcome":"uncertain","uploadStarted":true}'), uncertainCopy);
  assert.equal(vaultJobStatusCopy("approved", '{"outcome":"uncertain"}'), "Waiting for the signed Fansly browser");
});

test("status copy does not imply completed or manually confirmed proof", () => {
  assert.equal(vaultJobStatusCopy("verified", '{"outcome":"uncertain"}'), "Paired browser receipt reports a saved vault record");
  assert.equal(vaultJobStatusCopy("staged", '{"outcome":"uncertain"}'), "Paired browser reported that Fansly accepted the transfer");
  assert.equal(vaultJobStatusCopy("failed", '{"reconciliationRequired":true}'), uncertainCopy);
});

test("retry eligibility fails closed for uncertain or malformed failed receipts", () => {
  assert.equal(canRetryVaultJob("failed", '{}'), true);
  assert.equal(canRetryVaultJob("failed", '{"outcome":"failed"}'), true);
  assert.equal(canRetryVaultJob("failed", '{"outcome":"uncertain"}'), false);
  assert.equal(canRetryVaultJob("failed", '{"reconciliationRequired":true}'), false);
  assert.equal(canRetryVaultJob("failed", '{"uploadStarted":true}'), false);
  assert.equal(canRetryVaultJob("failed", 'truncated'), false);
  assert.equal(canRetryVaultJob("failed", null), false);
  assert.equal(canRetryVaultJob("claimed", '{}'), false);
});
