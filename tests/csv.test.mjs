import assert from "node:assert/strict";
import test from "node:test";
import { normaliseAnalyticsRows, parseCsv } from "../src/lib/csv.ts";

test("parses quoted CSV values and normalises metrics", () => {
  const rows = parseCsv('date,account,views,revenue,currency\n2026-07-01,"@thrill,noir",1200,"$45.50",aud\n');
  const metrics = normaliseAnalyticsRows(rows);
  assert.equal(metrics[0].accountHandle, "@thrill,noir");
  assert.equal(metrics[0].views, 1200);
  assert.equal(metrics[0].revenue, 45.5);
  assert.equal(metrics[0].currency, "AUD");
});

test("rejects rows without a valid date", () => {
  assert.throws(() => normaliseAnalyticsRows([{ views: "3" }]), /valid date/);
});
