import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { roleCan } from "../src/lib/authorization.ts";

const source = await readFile(new URL("../src/app/actions.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function saveAssetAttributesAction(");
const end = source.indexOf("\nexport ", start + 1);
const code = stripTypeScriptTypes(source.slice(start, end).replace("export async", "async"));

function fixture({ role = "creator", foreign = false, released = false } = {}) {
  let reads = 0;
  let batches = 0;
  let writes = [];
  const action = new Function("requireCreatorContext", "values", "destinations", "cloudflareEnv", "creatorPrepare", "revalidatePath", "redirect", `${code}; return saveAssetAttributesAction;`)(
    async (permission) => {
      if (!roleCan(role, permission)) throw new Error("denied");
      return { email: "creator@example.test", creator: { creator_id: "own", role } };
    },
    (form, key) => form.getAll(key).map(String),
    ["instagram", "x", "subscription", "ppv"],
    () => ({ DB: { async batch(statements) { batches++; writes = statements; } } }),
    (_db, creatorId, sql) => {
      assert.equal(creatorId, "own");
      return { sql, bind(...args) {
        this.args = args;
        return this;
      }, async first() {
        reads++;
        assert.match(this.sql, /creator_portfolio_release_versions/);
        return released ? { id: "release-1" } : null;
      }, async all() {
        reads++;
        return { results: foreign ? [] : this.args.map((id) => ({ id })) };
      } };
    },
    () => {},
    (url) => { throw new Error(`redirect:${url}`); },
  );
  return { action, state: () => ({ reads, batches, writes }) };
}

function selection(count) {
  const form = new FormData();
  for (let index = 0; index < count; index++) form.append("assetId", `asset-${index}`);
  form.set("safety", "sfw");
  return form;
}

test("oversized batch is rejected completely instead of silently saving the first 50", async () => {
  const { action, state } = fixture();
  await assert.rejects(action(selection(51)), /no more than 50/);
  assert.deepEqual(state(), { reads: 0, batches: 0, writes: [] });
});

test("50 unique selected assets save together and a duplicate selector is counted once", async () => {
  const { action, state } = fixture();
  const form = selection(50);
  form.append("assetId", "asset-0");
  await assert.rejects(action(form), /redirect:\/library\?saved=50/);
  assert.equal(state().batches, 1);
  assert.equal(state().writes.filter((item) => item.sql.includes("INSERT INTO asset_classifications")).length, 50);
  assert.equal(state().writes.filter((item) => item.sql.includes("INSERT INTO asset_classification_events")).length, 50);
});

test("foreign assets and viewer requests cannot mutate catalogue metadata", async () => {
  const foreign = fixture({ foreign: true });
  await assert.rejects(foreign.action(selection(1)), /unavailable/);
  assert.equal(foreign.state().batches, 0);
  const viewer = fixture({ role: "viewer" });
  await assert.rejects(viewer.action(selection(1)), /denied/);
  assert.equal(viewer.state().reads, 0);
  assert.equal(viewer.state().batches, 0);
});

test("a released portfolio item cannot have its classification changed before withdrawal", async () => {
  const { action, state } = fixture({ released: true });
  await assert.rejects(action(selection(1)), /Withdraw the public Portfolio/);
  assert.equal(state().batches, 0);
});
