import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { vaultJobStatusCopy } from "../src/lib/vault-job-status.ts";

test("Fansly device receipts stay scoped to one claimed or uncertain vault job", async () => {
  const [bridge, operations] = await Promise.all([
    readFile(new URL("../../vault-bridge/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/operations/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(bridge, /WHERE id=\? AND creator_id=\? AND account_id=\? AND platform='fansly'\s+AND \(status='claimed' OR \(status='failed' AND json_valid\(receipt\) AND json_extract\(receipt,'\$\.outcome'\)='uncertain'\)\)/);
  assert.match(bridge, /json_valid\(receipt\) AND json_extract\(receipt,'\$\.externalMediaId'\)=\?/);
  assert.match(bridge, /AND asset_id=\? AND platform='fansly'\s+AND \(status='claimed' OR \(status='failed' AND json_valid\(receipt\) AND json_extract\(receipt,'\$\.outcome'\)='uncertain'\)\)/);
  assert.match(bridge, /JSON\.stringify\(\{ error, externalMediaId \}\)/);
  assert.match(operations, /vaultJobStatusCopy\(job.status, job.receipt\)/);
  assert.equal(vaultJobStatusCopy("verified"), "Paired browser receipt reports a saved vault record");
  assert.doesNotMatch(operations, /Confirmed in the native Fansly vault/);
});
