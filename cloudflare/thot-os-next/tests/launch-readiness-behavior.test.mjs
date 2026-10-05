import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/launch-readiness.ts", import.meta.url), "utf8");
const modelSource = source.slice(source.indexOf("function hasQuality("), source.indexOf("export async function getCreatorLaunchReadiness("));
assert.ok(modelSource.startsWith("function hasQuality("), "readiness model helper should be present");
assert.ok(modelSource.length > 0, "readiness model boundary should be found");
const modelJavaScript = ts.transpileModule(modelSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { buildCreatorLaunchReadiness } = await import(`data:text/javascript;base64,${Buffer.from(modelJavaScript).toString("base64")}`);

const insights = (dataQuality = ["official"], latestObservedAt = "2026-10-03T12:00:00.000Z") => ({
  generatedAt: "2026-10-04T12:00:00.000Z",
  metricDefinition: "weighted",
  summary: {
    officialMedia: 8,
    completeMetricMedia: 7,
    metricCoveragePercent: 87.5,
    latestObservedAt,
    confidence: "early",
    dataQuality,
  },
  recommendations: [],
});

const collection = (status, overrides = {}) => ({
  status,
  started_at: "2026-10-04T11:00:00.000Z",
  completed_at: status === "running" ? null : "2026-10-04T11:01:00.000Z",
  error: null,
  ...overrides,
});

const readiness = ({
  unresolvedTenantExceptions = 0,
  uncertainProviderReceipts = 0,
  run = collection("completed"),
  evidence = insights(),
} = {}) => buildCreatorLaunchReadiness({
  generatedAt: "2026-10-04T12:00:00.000Z",
  unresolvedTenantExceptions,
  uncertainProviderReceipts,
  collection: run,
  profile: null,
  insights: evidence,
});

const check = (result, id) => result.checks.find((item) => item.id === id);

test("completed analytics is ready only when retained observations are fresh and available", () => {
  assert.equal(check(readiness(), "analytics_collection").status, "ready");
  for (const quality of [["official", "stale"], ["unavailable"]]) {
    const result = check(readiness({ evidence: insights(quality) }), "analytics_collection");
    assert.equal(result.status, "attention");
    assert.match(result.summary, /stale|unavailable/);
  }
});

test("a skipped collection stays attention and reports retained observation freshness", () => {
  const fresh = check(readiness({ run: collection("skipped") }), "analytics_collection");
  assert.equal(fresh.status, "attention");
  assert.match(fresh.summary, /collection was skipped/i);
  assert.match(fresh.summary, /retained official observations are current enough/i);
  assert.doesNotMatch(fresh.summary, /provider read completed/i);
  assert.equal(fresh.observedAt, "2026-10-03T12:00:00.000Z");

  const stale = check(readiness({ run: collection("skipped"), evidence: insights(["official", "stale"]) }), "analytics_collection");
  assert.equal(stale.status, "attention");
  assert.match(stale.summary, /retained official observation is stale/i);

  const unavailable = check(readiness({ run: collection("skipped"), evidence: insights(["unavailable"], null) }), "analytics_collection");
  assert.equal(unavailable.status, "attention");
  assert.match(unavailable.summary, /no usable official observation/i);
});

test("failed, running, and absent analytics receipts need attention", () => {
  assert.equal(check(readiness({ run: collection("failed") }), "analytics_collection").status, "attention");
  assert.equal(check(readiness({ run: collection("running", { completed_at: null }) }), "analytics_collection").status, "attention");
  assert.equal(check(readiness({ run: null }), "analytics_collection").status, "attention");
});

test("tenant and provider blockers remain blocked, and production cutover always remains blocked", () => {
  const result = readiness({ unresolvedTenantExceptions: 1, uncertainProviderReceipts: 2 });
  assert.equal(check(result, "tenant_integrity").status, "blocked");
  assert.equal(check(result, "provider_receipts").status, "blocked");
  assert.equal(check(result, "production_cutover").status, "blocked");
  assert.equal(result.scope, "staging");
});
