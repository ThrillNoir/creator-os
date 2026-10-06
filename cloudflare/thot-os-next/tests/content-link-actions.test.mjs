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
  class DownloadSaleError extends Error { constructor() { super("private diagnostic"); this.code = "invalid_request"; } }
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
    "@/lib/content-download-sales": {
      DownloadSaleError,
      SALE_CURRENCIES: ["AUD", "USD", "EUR", "GBP", "CAD", "NZD", "JPY", "KWD"],
      getDownloadSales: async (_db, input) => { calls.push(input); return { rows: [], totals: [], nextOffset: null }; },
      updateDownloadSale: async (_db, input) => { calls.push(input); return true; },
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
  assert.deepEqual(calls[1], { actor: { creatorId: "own", email: "verified@example.test" }, assetId: "asset", title: "Approved title", customMessage: undefined, recipientReference: undefined, saleAmount: undefined, saleCurrency: undefined, sharingConfirmed: true });
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


test("custom message passes through as text and uploaded files are rejected", async () => {
  const { actions, calls } = load();
  const form = new FormData();
  form.set("assetId", "asset"); form.set("title", "Title"); form.set("sharingConfirmed", "yes");
  form.set("customMessage", "A note\nfor you");
  form.set("recipientReference", "private reference"); form.set("saleAmount", "12.50"); form.set("saleCurrency", "AUD");
  assert.equal((await actions.generateContentLinkAction(form)).ok, true);
  assert.equal(calls[1].customMessage, "A note\nfor you");
  assert.equal(calls[1].recipientReference, "private reference");
  assert.equal(calls[1].saleAmount, "12.50");
  assert.equal(calls[1].saleCurrency, "AUD");
  form.set("customMessage", new Blob(["not a message"]), "message.txt");
  assert.deepEqual(await actions.generateContentLinkAction(form), { ok: false, code: "invalid_request" });
  assert.equal(calls.filter((value) => typeof value === "object").length, 1);
});

test("sales history and edits use the verified actor and protected host gate", async () => {
  const { actions, calls } = load();
  assert.deepEqual(await actions.listDownloadSalesAction("asset", 50), { rows: [], totals: [], nextOffset: null });
  assert.equal(calls[0], "mutate");
  assert.deepEqual(calls[1], { actor: { creatorId: "own", email: "verified@example.test" }, assetId: "asset", offset: 50 });
  const form = new FormData();
  form.set("linkId", "link"); form.set("expectedRevision", "4"); form.set("operation", "clear_recipient");
  form.set("recipientReference", "ignored forged field"); form.set("creatorId", "forged");
  assert.deepEqual(await actions.updateDownloadSaleAction(form), { ok: true });
  assert.equal(calls[2], "mutate");
  assert.deepEqual(calls[3], { actor: { creatorId: "own", email: "verified@example.test" }, linkId: "link", recipientReference: undefined, saleAmount: undefined, saleCurrency: undefined, expectedRevision: 4, operation: "clear_recipient" });
  const denied = load({ host: "evil.test" });
  await assert.rejects(() => denied.actions.listDownloadSalesAction("asset"));
  await assert.rejects(() => denied.actions.updateDownloadSaleAction(form));
  assert.deepEqual(denied.calls, []);
});

test("sales actions reject malformed operation and uploaded private references", async () => {
  const { actions, calls } = load();
  const form = new FormData(); form.set("linkId", "link"); form.set("expectedRevision", "2"); form.set("operation", "restore");
  assert.deepEqual(await actions.updateDownloadSaleAction(form), { ok: false, code: "invalid_request" });
  form.set("operation", "save"); form.set("recipientReference", new Blob(["private"]), "private.txt");
  assert.deepEqual(await actions.updateDownloadSaleAction(form), { ok: false, code: "invalid_request" });
  assert.deepEqual(calls, ["mutate", "mutate"]); // authorization happened; no domain update ran
});
