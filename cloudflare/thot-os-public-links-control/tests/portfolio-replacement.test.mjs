import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../src/portfolio-release.ts", import.meta.url), "utf8");
const start = source.indexOf("export class PortfolioPublishWorkflow");
const end = source.indexOf("\nexport class PortfolioWithdrawWorkflow", start);
const code = stripTypeScriptTypes(source.slice(start, end).replace("export class", "class"));

function fixture(mode) {
  const old = { creatorSlug: "adelaide", publishedProfileVersionId: "profile-a", portfolioVersionId: "old-release" };
  const third = { ...old, portfolioVersionId: "third-release" };
  const state = { projection: old, release: "approved", deletedMedia: 0, calls: [], events: [] };
  const manifest = { schemaVersion: 2, contact: {}, cards: [{ id: "card-a", assetId: "preview-a", fullLengthAssetId: null,
    kind: "image", title: "Preview", description: "", section: "Clips", previewKey: "private.jpg", posterKey: null }] };
  const row = { id: "new-release", creator_id: "adelaide", slug: "adelaide", adult_profile_version_id: mode.startsWith("profile-updated") ? "profile-b" : "profile-a" };
  const env = {
    ADULT_PROFILES: {
      async get() { return state.projection; },
      async put(_key, value, options) {
        if (mode === "before-put") throw new Error("synthetic_put_failure");
        state.projection = JSON.parse(value); state.calls.push({ put: options?.metadata });
      },
      async delete(key) { if (key === "adult-portfolio:adelaide") state.projection = null; state.calls.push(`delete:${key}`); },
    },
    ADULT_MEDIA: { async delete() { state.deletedMedia++; } },
    DB: {
      prepare(sql) { return { bind() { return {
        async first() { return sql.includes("SELECT status") ? { status: state.release } : null; },
        async run() {
          if (sql.includes("SET status='publishing'") && mode === "withdraw-in-progress") return { meta: { changes: 0 } };
          if (sql.includes("SET status='publishing'")) state.release = "publishing";
          if (sql.includes("status='failed'")) state.release = "failed";
          return { meta: { changes: 1 } };
        },
      }; } }; },
      async batch() {
        if (mode === "committed") { state.release = "published"; throw new Error("synthetic_commit_reply_lost"); }
        if (mode === "reference-fail" || mode === "profile-updated") { state.release = "published"; return []; }
        if (mode === "concurrent") state.projection = third;
        throw new Error("synthetic_batch_failure");
      },
    },
  };
  class Base { constructor(environment) { this.env = environment; } }
  const Workflow = new Function("WorkflowEntrypoint", "releaseRow", "sourceForCard", "copySource", "validLivePortfolio", "validStoredPortfolio",
    "snapshotKey", "releaseEvent", "mediaKey", "SAFE_RELEASE_CAUSES", "writePortfolioContactReferences", "portfolioContactReferenceKey", `${code};return PortfolioPublishWorkflow;`)(
    Base,
    async (_env, params) => params.versionId === "old-release" ? { row: { ...row, id: "old-release", adult_profile_version_id: "profile-a" }, manifest } : { row, manifest },
    async () => {
      if (mode === "invalid-card") throw new Error("portfolio_short_preview_changed_or_too_large");
      return { preview: { key: "private.jpg" }, poster: null };
    },
    async () => ({ key: "adult-portfolio/adelaide/new-release/card-a/preview.jpg", checksum: "a".repeat(64) }),
    (value, slug, profile) => value?.creatorSlug === slug && value?.publishedProfileVersionId === profile,
    (value, slug) => value?.creatorSlug === slug && typeof value?.publishedProfileVersionId === "string",
    (slug) => `adult-portfolio:${slug}`, async (_env, _row, type, detail) => { state.events.push({ type, detail }); }, () => "new-media",
    new Set(["portfolio_short_preview_changed_or_too_large"]), async () => { if (mode === "reference-fail") throw new Error("synthetic_private_reference_write_failure"); },
    (slug, version) => `adult-portfolio-contact:${slug}:${version}`,
  );
  return { state, old, third, run: () => new Workflow(env).run({ payload: { creatorId: "adelaide", versionId: "new-release" } },
    { do: async (_name, callback) => callback() }) };
}

test("a failed write leaves the earlier public projection in place", async () => {
  const { state, old, run } = fixture("before-put");
  await assert.rejects(run(), /synthetic_put_failure/);
  assert.deepEqual(state.projection, old);
  assert.equal(state.deletedMedia, 1);
});

test("a failed card validation records only its private card ID and known cause", async () => {
  const { state, run } = fixture("invalid-card");
  await assert.rejects(run(), /portfolio_short_preview_changed_or_too_large/);
  assert.deepEqual(state.events.find((event) => event.type === "publish_failed")?.detail,
    { code: "projection_failed", cardId: "card-a", cause: "portfolio_short_preview_changed_or_too_large" });
  assert.equal(state.projection.portfolioVersionId, "old-release");
});

test("a failed delivery restores the still-published earlier release", async () => {
  const { state, old, run } = fixture("batch-fail");
  await assert.rejects(run(), /synthetic_batch_failure/);
  assert.deepEqual(state.projection, old);
  assert.equal(state.release, "failed");
  assert.equal(state.deletedMedia, 1);
});

test("a committed delivery keeps its public copy when the D1 response is lost", async () => {
  const { state, run } = fixture("committed");
  assert.equal((await run()).published, true);
  assert.equal(state.projection.portfolioVersionId, "new-release");
  assert.equal(state.deletedMedia, 0);
});

test("a new approved Portfolio replaces a projection from the prior 18+ profile version", async () => {
  const { state, run } = fixture("profile-updated");
  assert.equal((await run()).published, true);
  assert.equal(state.projection.publishedProfileVersionId, "profile-b");
  assert.equal(state.projection.portfolioVersionId, "new-release");
  assert.ok(state.calls.includes("delete:adult-portfolio-contact:adelaide:old-release"));
});

test("failed replacement restores the old projection with its own profile version metadata", async () => {
  const { state, old, run } = fixture("profile-updated-batch-fail");
  await assert.rejects(run(), /synthetic_batch_failure/);
  assert.deepEqual(state.projection, old);
  assert.deepEqual(state.calls.find((call) => call.put?.portfolioVersionId === "old-release")?.put,
    { creatorId: "adelaide", portfolioVersionId: "old-release", profileVersionId: "profile-a" });
});

test("publish waits while an older Portfolio is being withdrawn", async () => {
  const { state, run } = fixture("withdraw-in-progress");
  await assert.rejects(run(), /portfolio_withdrawal_in_progress/);
  assert.equal(state.release, "approved");
  assert.equal(state.projection.portfolioVersionId, "old-release");
  assert.equal(state.deletedMedia, 0);
});

test("private contact-reference failure cannot block an approved public media release", async () => {
  const { state, run } = fixture("reference-fail");
  assert.equal((await run()).published, true);
  assert.equal(state.projection.portfolioVersionId, "new-release");
  assert.equal(state.release, "published");
});

test("failed cleanup never overwrites a concurrently changed public projection", async () => {
  const { state, third, run } = fixture("concurrent");
  await assert.rejects(run(), /synthetic_batch_failure/);
  assert.deepEqual(state.projection, third);
  assert.equal(state.calls.includes("delete:adult-portfolio:adelaide"), false);
});
