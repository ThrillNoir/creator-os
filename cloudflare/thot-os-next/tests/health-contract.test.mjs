import assert from "node:assert/strict";
import test from "node:test";
import { assertUnauthenticatedHealthDenied, healthSummary, validateAuthenticatedHealth } from "../scripts/health-contract.mjs";

const expected = { component: "web", environment: "staging", gitSha: "abc123", gitBranch: "codex/staging-readiness-maintenance", buildTime: "2026-08-24T00:00:00.000Z" };
const result = {
  ok: true,
  service: "web",
  environment: "staging",
  runtime: "nextjs-opennext",
  deployment: { gitSha: "abc123", gitBranch: "codex/staging-readiness-maintenance", buildTime: "2026-08-24T00:00:00.000Z" },
  creatorId: "staging-synthetic-creator",
  database: { connected: true, migration: "0043" },
  bindings: { d1: true },
};

test("the smoke contract requires Access denial and the approved artifact identity", () => {
  for (const status of [302, 401, 403]) assert.equal(assertUnauthenticatedHealthDenied(status), true);
  assert.throws(() => assertUnauthenticatedHealthDenied(200), /must be denied/);
  assert.equal(validateAuthenticatedHealth({ status: 200, result, expected }), true);
  assert.deepEqual(healthSummary(result), { ok: true, service: "web", environment: "staging", runtime: "nextjs-opennext", migration: "0043", gitSha: "abc123" });
});

test("the smoke contract fails closed for stale code, wrong environment, or missing D1 proof", () => {
  assert.throws(() => validateAuthenticatedHealth({ status: 200, result: { ...result, deployment: { ...result.deployment, gitSha: "stale" } }, expected }), /artifact identity/);
  assert.throws(() => validateAuthenticatedHealth({ status: 200, result: { ...result, environment: "production" }, expected }), /component or environment/);
  assert.throws(() => validateAuthenticatedHealth({ status: 200, result: { ...result, bindings: { d1: false } }, expected }), /D1-backed creator contract/);
});
