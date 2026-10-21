import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../src/portfolio-release.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function reconcilePublishedPortfolios(");
const code = stripTypeScriptTypes(source.slice(start).replace("export async", "async"));

async function reconcile(profileStatus, publishedVersionId) {
  const calls = { checked: 0, withdrawn: 0 };
  let listed = false;
  const env = {
    PORTFOLIO_WITHDRAW: { async create() { calls.withdrawn++; } },
    DB: { prepare() { return { bind() { return { async all() {
      if (listed) return { results: [] };
      listed = true;
      return { results: [{ id: "release-a", creator_id: "creator-a", status: "published", approved_at: "2026-01-01" }] };
    } }; } }; } },
  };
  const run = new Function("releaseRow", "sourceForCard", "beginPortfolioWithdrawal", `${code};return reconcilePublishedPortfolios;`)(
    async () => ({ row: { profile_status: profileStatus, published_version_id: publishedVersionId,
      adult_profile_version_id: "older-profile" }, manifest: { schemaVersion: 2, cards: [{ id: "card-a" }] } }),
    async () => { calls.checked++; },
    async () => { calls.withdrawn++; },
  );
  await run(env);
  return calls;
}

test("an updated published 18+ profile keeps the approved Portfolio under consent rechecks", async () => {
  assert.deepEqual(await reconcile("active", "newer-profile"), { checked: 1, withdrawn: 0 });
});

test("withdrawing the 18+ profile still withdraws its Portfolio", async () => {
  assert.deepEqual(await reconcile("paused", null), { checked: 0, withdrawn: 2 });
});
