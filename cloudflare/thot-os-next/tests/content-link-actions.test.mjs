import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const code = ts.transpileModule(await readFile(new URL("../src/app/content-link-actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load({ host = "127.0.0.1:3000", localEnabled = "1", stagingEnabled, denied = false } = {}) {
  const calls = [];
  const exports = {};
  class ContentDownloadLinkError extends Error { constructor(code) { super("private diagnostic"); this.code = code; } }
  const behavior = { create: "success", revoke: true };
  const modules = {
    "next/headers": { headers: async () => new Headers({ host }) },
    "@/lib/cloudflare": { cloudflareEnv: () => ({ DB: "db", CONTENT_DOWNLOAD_LINKS_ENABLED: stagingEnabled }) },
    "@/lib/identity": { requireCreatorContext: async (permission) => {
      calls.push(permission);
      if (denied) throw new Error("denied");
      return { email: "verified@example.test", creator: { creator_id: "own" } };
    } },
    "@/lib/content-download-links": {
      ContentDownloadLinkError,
      createContentDownloadLink: async (_db, input) => { calls.push(input); if (behavior.create === "unknown") throw new Error("secret database details"); if (behavior.create !== "success") throw new ContentDownloadLinkError(behavior.create); return { id: "id", token: "secret", expiresAt: 100 }; },
      revokeContentDownloadLink: async (_db, input) => { calls.push(input); return behavior.revoke; },
      listContentDownloadLinks: async (_db, input) => { calls.push(input); return []; },
    },
  };
  new Function("require", "exports", "process", code)((name) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  }, exports, { env: { CONTENT_DOWNLOAD_LINKS_LOCAL: localEnabled } });
  return { actions: exports, calls, behavior };
}

test("content link actions use verified actor scope and explicit consent", async () => {
  const { actions, calls } = load();
  const form = new FormData();
  form.set("assetId", "asset"); form.set("title", "Approved title");
  form.set("creatorId", "forged"); form.set("email", "forged@example.test");
  form.set("sharingConfirmed", "yes");
  assert.equal((await actions.generateContentLinkAction(form)).link.url, "http://127.0.0.1:8791/d/secret");
  assert.equal(calls[0], "mutate");
  assert.deepEqual(calls[1], { actor: { creatorId: "own", email: "verified@example.test" }, assetId: "asset", title: "Approved title", sharingConfirmed: true });
  await actions.revokeContentLinkAction("link");
  assert.deepEqual(calls[3], { actor: { creatorId: "own", email: "verified@example.test" }, linkId: "link" });
  form.delete("sharingConfirmed");
  await actions.generateContentLinkAction(form);
  assert.equal(calls[5].sharingConfirmed, false);
});

test("disabled, non-local and unauthorized actions do not issue or revoke links", async () => {
  for (const options of [{ localEnabled: "0" }, { host: "thot-os-staging.thot-os.workers.dev" }, { host: "thot-os-staging.thot-os.workers.dev", stagingEnabled: "true" }, { host: "thot-os-staging.thot-os.workers.dev", stagingEnabled: "1", localEnabled: "1", denied: true }, { host: "localhost.attacker.test" }]) {
    const { actions, calls } = load(options);
    await assert.rejects(() => actions.generateContentLinkAction(new FormData()));
    await assert.rejects(() => actions.revokeContentLinkAction("link"));
    await assert.rejects(() => actions.listContentLinksAction("asset"));
    assert.equal(calls.some((call) => typeof call === "object"), false);
  }
});

test("staging issuance uses only the dedicated staging download origin", async () => {
  const { actions } = load({ host: "thot-os-staging.thot-os.workers.dev", stagingEnabled: "1", localEnabled: "0" });
  const form = new FormData(); form.set("assetId", "asset"); form.set("title", "Approved title"); form.set("sharingConfirmed", "yes");
  assert.equal((await actions.generateContentLinkAction(form)).link.url, "https://thot-os-downloads-staging.thot-os.workers.dev/d/secret");
});

test("expected domain errors return safe results while unknown and authorization errors stay generic", async () => {
  const { actions, behavior } = load();
  const form = new FormData(); form.set("assetId", "asset"); form.set("title", "Title"); form.set("sharingConfirmed", "yes");
  behavior.create = "not_eligible";
  assert.deepEqual(await actions.generateContentLinkAction(form), { ok: false, code: "not_eligible" });
  behavior.create = "unknown";
  await assert.rejects(() => actions.generateContentLinkAction(form));
  const denied = load({ denied: true });
  await assert.rejects(() => denied.actions.generateContentLinkAction(form));
  behavior.revoke = false;
  assert.deepEqual(await actions.revokeContentLinkAction("link"), { ok: false });
});
