import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../src/portfolio-release.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function beginPortfolioWithdrawal(");
const end = source.indexOf("\nexport class PortfolioPublishWorkflow", start);
const code = stripTypeScriptTypes(source.slice(start, end).replace("export async", "async"));

function fixture(current, changed = 1) {
  const calls = { deleted: [], statuses: [], events: 0 };
  const env = {
    ADULT_PROFILES: {
      async get() { return current; },
      async delete(key) { calls.deleted.push(key); },
    },
    DB: { prepare(sql) { return { bind(...values) { calls.statuses.push({ sql, values }); return { async run() { return { meta: { changes: changed } }; } }; } }; } },
  };
  const begin = new Function("releaseRow", "snapshotKey", "validLivePortfolio", "releaseEvent", `${code}; return beginPortfolioWithdrawal;`)(
    async () => ({ row: { id: "old-release", creator_id: "adelaide", slug: "adelaide", adult_profile_version_id: "old-profile" } }),
    (slug) => `adult-portfolio:${slug}`,
    (value, slug, version) => value.creatorSlug === slug && value.publishedProfileVersionId === version,
    async () => { calls.events += 1; },
  );
  return { begin: () => begin(env, { creatorId: "adelaide", versionId: "old-release" }), calls };
}

test("withdrawal never removes a newer profile version's portfolio projection", async () => {
  const { begin, calls } = fixture({ creatorSlug: "adelaide", publishedProfileVersionId: "new-profile", portfolioVersionId: "new-release" });
  await assert.rejects(begin(), /portfolio_projection_version_mismatch/);
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(calls.statuses, []);
});

test("withdrawal removes its own projection before returning", async () => {
  const { begin, calls } = fixture({ creatorSlug: "adelaide", publishedProfileVersionId: "old-profile", portfolioVersionId: "old-release" });
  await begin();
  assert.deepEqual(calls.deleted, ["adult-portfolio:adelaide"]);
  assert.equal(calls.statuses.length, 1);
  assert.equal(calls.events, 1);
});

test("withdrawal does not delete a projection if a concurrent publish changed the release state", async () => {
  const { begin, calls } = fixture({ creatorSlug: "adelaide", publishedProfileVersionId: "old-profile", portfolioVersionId: "old-release" }, 0);
  await assert.rejects(begin(), /portfolio_release_changed_during_withdrawal/);
  assert.deepEqual(calls.deleted, []);
});
