import assert from "node:assert/strict";
import test from "node:test";
import { calculateDeliveryScorecard, normaliseFinanceCsv } from "../src/lib/finance-metrics.ts";

test("finance CSV normalization stores exact minor units and derives net revenue", () => {
  const rows = normaliseFinanceCsv(`\uFEFFdate,gross_revenue,refunds,currency,subscribers
2026-08-12,"1,234.50",34.25,aud,101
2026-08-13,200.00,,USD,102`);
  assert.deepEqual(rows, [
    { periodDate: "2026-08-12", currency: "AUD", grossRevenueMinor: 123450, refundsMinor: 3425, netRevenueMinor: 120025, subscribers: 101 },
    { periodDate: "2026-08-13", currency: "USD", grossRevenueMinor: 20000, refundsMinor: null, netRevenueMinor: 20000, subscribers: 102 },
  ]);
});

test("finance CSV accepts explicit net earnings and rejects ambiguous duplicate periods", () => {
  assert.deepEqual(normaliseFinanceCsv(`period_date,earnings,currency
2026-08-14,(12.34),AUD`)[0].netRevenueMinor, -1234);
  assert.throws(() => normaliseFinanceCsv(`date,revenue,currency
2026-08-14,10,AUD
2026-08-14,20,AUD`), /duplicates 2026-08-14 AUD/);
  assert.throws(() => normaliseFinanceCsv(`date,revenue,currency
14\/08\/2026,10,AUD`), /YYYY-MM-DD/);
  assert.throws(() => normaliseFinanceCsv(`date,revenue,currency
2026-02-31,10,AUD`), /YYYY-MM-DD/);
  assert.throws(() => normaliseFinanceCsv(`date,revenue,currency
2026-08-14,10.999,AUD`), /two decimal places/);
});

test("delivery scorecard counts only verified receipts and exposes guardrails", () => {
  assert.deepEqual(calculateDeliveryScorecard({
    verifiedSocial: 8,
    failedSocial: 2,
    unreviewedSocial: 1,
    stalledSocial: 1,
    approvalRequired: 12,
    approvalGaps: 0,
    verifiedVault: 2,
    failedVault: 0,
    awaitingDevice: 3,
    stalledVault: 1,
    unreadConversations: 7,
  }), {
    verifiedDeliveries: 10,
    failedDeliveries: 2,
    deliverySuccessPercent: 83,
    approvalCoveragePercent: 100,
    needsReview: 3,
    awaitingDevice: 3,
    unreadConversations: 7,
  });
});

test("empty delivery history is unavailable rather than a fabricated 100 percent", () => {
  const result = calculateDeliveryScorecard({
    verifiedSocial: 0, failedSocial: 0, unreviewedSocial: 0, stalledSocial: 0,
    approvalRequired: 0, approvalGaps: 0, verifiedVault: 0, failedVault: 0,
    awaitingDevice: 0, stalledVault: 0, unreadConversations: 0,
  });
  assert.equal(result.deliverySuccessPercent, null);
  assert.equal(result.approvalCoveragePercent, null);
});
