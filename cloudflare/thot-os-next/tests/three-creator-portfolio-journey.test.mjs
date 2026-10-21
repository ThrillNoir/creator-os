import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";
import ts from "typescript";
import { portfolioAddFields } from "../src/lib/portfolio-add-fields.ts";
import { portfolioLibraryEligible } from "../src/lib/portfolio-library-eligibility.ts";
import { portfolioInitialTitle } from "../src/lib/asset-display-name.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const creators = ["synthetic-amber", "synthetic-birch", "synthetic-coral"];
const compile = (code) => ts.transpileModule(code, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
function load(code, imports) {
  const exports = {};
  new Function("require", "exports", compile(code))((name) => {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected fixture import ${name}`);
  }, exports);
  return exports;
}
const { creatorPrepare } = load(await source("../src/lib/creator-db.ts"), { "server-only": {} });
function localD1(db) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...input) { values = input; return this; },
        first() { return db.prepare(sql).get(...values) ?? null; },
        all() { return { results: db.prepare(sql).all(...values) }; },
        run() { const result = db.prepare(sql).run(...values); return { meta: { changes: result.changes } }; },
        batchRead() { return /^SELECT\b/i.test(sql.trim()) ? this.all() : this.run(); },
      };
    },
    batch(statements) { return db.transaction(() => statements.map((statement) => statement.batchRead()))(); },
  };
}
async function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE creators (id TEXT PRIMARY KEY,slug TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE users (email TEXT PRIMARY KEY COLLATE NOCASE,status TEXT NOT NULL);
    CREATE TABLE assets (id TEXT PRIMARY KEY,creator_id TEXT NOT NULL REFERENCES creators(id),basename TEXT NOT NULL,display_stem TEXT,
      extension TEXT NOT NULL,source_available INTEGER NOT NULL,preview_r2_key TEXT,UNIQUE(id,creator_id));
    CREATE TABLE asset_classifications (asset_id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,safety TEXT,is_teaser INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE asset_media_authorities (asset_id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,authority_kind TEXT NOT NULL,state TEXT NOT NULL);
    CREATE TABLE asset_video_playback_states (asset_id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,state TEXT,source_codec TEXT);
    CREATE TABLE creator_adult_profile_versions (id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(id,creator_id));
    CREATE TABLE creator_adult_profiles (creator_id TEXT PRIMARY KEY,published_version_id TEXT,status TEXT NOT NULL);`);
  for (const id of creators) {
    db.prepare("INSERT INTO creators VALUES (?,?,'active')").run(id, id);
    db.prepare("INSERT INTO users VALUES (?,'active')").run(`${id}@example.invalid`);
    db.prepare("INSERT INTO creator_adult_profile_versions VALUES (?,?,'published')").run(`profile-${id}`, id);
    db.prepare("INSERT INTO creator_adult_profiles VALUES (?,?,'active')").run(id, `profile-${id}`);
    for (const [kind, codec] of [["preview", "h264"], ["full", "h265"], ["unsupported", "h265"]]) {
      const assetId = `${kind}-${id}`;
      db.prepare("INSERT INTO assets (id,creator_id,basename,extension,source_available,preview_r2_key) VALUES (?,?,?,'mp4',1,?)").run(assetId, id, `${kind} synthetic clip.mp4`, `fixture/${id}/${kind}.jpg`);
      db.prepare("INSERT INTO asset_classifications VALUES (?,?,'nsfw',?)").run(assetId, id, kind === "preview" ? 1 : 0);
      db.prepare("INSERT INTO asset_media_authorities VALUES (?,?,'r2_native','canonical_verified')").run(assetId, id);
      db.prepare("INSERT INTO asset_video_playback_states VALUES (?,?,'canonical_verified',?)").run(assetId, id, codec);
    }
  }
  for (const migration of ["0066_creator_portfolio_drafts.sql", "0067_creator_portfolio_releases.sql", "0068_portfolio_preview_first.sql", "0069_portfolio_draft_visibility.sql"]) {
    db.exec(await source(`../../thot-os-app/migrations/${migration}`));
  }
  const DB = localD1(db);
  let activeCreator = creators[0];
  let role = "creator";
  let controlStatus = 202;
  const controlCalls = [];
  const env = { DB, PORTFOLIO_AUTHORING_ENABLED: "1", PORTFOLIO_PUBLISHING_ENABLED: "1", PUBLIC_LINKS_CONTROL: {} };
  const cloudflareEnv = () => env;
  const authoring = load(await source("../src/lib/portfolio-authoring.ts"), {
    "server-only": {}, "./cloudflare": { cloudflareEnv }, "./creator-db": { creatorPrepare },
  });
  const redirect = (path) => { throw new Error(`redirect:${path}`); };
  const actions = load(await source("../src/app/portfolio/actions.ts"), {
    "next/cache": { revalidatePath() {} }, "next/navigation": { redirect },
    "@/lib/cloudflare": { cloudflareEnv }, "@/lib/creator-db": { creatorPrepare },
    "@/lib/identity": { requireCreatorContext: async (permission) => {
      if (permission === "mutate" && role === "viewer") throw new Error("NOT_FOUND");
      return { creator: { creator_id: activeCreator, role }, email: `${activeCreator}@example.invalid` };
    } },
    "@/lib/portfolio-authoring": authoring,
    "@/lib/internal-service": { fetchInternalService: async (_env, _name, capability, _binding, _url, request) => {
      controlCalls.push({ creatorId: activeCreator, capability, body: JSON.parse(request.body) });
      return { status: controlStatus };
    } },
    "@/lib/portfolio-add-fields": { portfolioAddFields },
    "@/lib/asset-display-name": { portfolioInitialTitle },
  });
  return { db, actions, authoring, controlCalls,
    setCreator(value) { activeCreator = value; }, setRole(value) { role = value; }, setControlStatus(value) { controlStatus = value; },
    close() { db.close(); } };
}
async function redirected(work, destination) {
  await assert.rejects(work, (error) => error.message === `redirect:${destination}`);
}
test("three invented creators keep private drafts, publication and withdrawal isolated", async () => {
  const app = await fixture();
  try {
    for (const id of creators) {
      app.setCreator(id);
      if (id === creators[0]) app.db.prepare("UPDATE assets SET display_stem='Renamed synthetic preview' WHERE id=? AND creator_id=?").run(`preview-${id}`, id);
      const category = new FormData(); category.set("name", "Synthetic clips");
      await redirected(app.actions.createPortfolioCategoryAction(category), "/portfolio");
      const categoryId = app.db.prepare("SELECT id FROM creator_portfolio_categories WHERE creator_id=?").pluck().get(id);
      const add = new FormData();
      add.set("assetId", `preview-${id}`); add.set("intent", "add"); add.set("confirmAdd", "yes");
      add.set("categoryChoice", categoryId); add.set("fullLengthAssetId", `full-${id}`);
      await redirected(app.actions.togglePortfolioItemAction(add), `/library/preview-${id}`);
      if (id === creators[0]) assert.equal((await app.authoring.getPortfolioDraft(id)).items[0].title, "Renamed synthetic preview");
      assert.equal((await app.authoring.getPortfolioDraft(id)).items[0].full_length_asset_id, `full-${id}`);
      assert.equal(app.db.prepare("SELECT COUNT(*) FROM creator_portfolio_release_versions WHERE creator_id=?").pluck().get(id), 0,
        "adding to draft never publishes");
      const draft = await app.authoring.getPortfolioDraft(id);
      const edit = new FormData();
      edit.set("composition", JSON.stringify({ revision: draft.revision, contact: { telegramUsername: "", email: `${id}@example.invalid`, message: "Please ask about this preview." }, cards: draft.items.map((item) => ({
        assetId: item.asset_id, title: "Synthetic short clip", description: "Synthetic non-explicit test card",
        categoryId: item.category_id, fullLengthAssetId: item.full_length_asset_id, previewKey: item.preview_r2_key, visible: true,
      })) }));
      await redirected(app.actions.savePortfolioDraftAction(edit), "/portfolio?notice=draft_saved");
      assert.equal((await app.authoring.getPortfolioDraft(id)).items[0].title, "Synthetic short clip");
      assert.equal((await app.authoring.getPortfolioDraft(id)).contact.message, "Please ask about this preview.");
      await assert.rejects(app.actions.savePortfolioDraftAction(edit), /draft changed elsewhere/i, "stale revision cannot overwrite");
      let fresh = await app.authoring.getPortfolioDraft(id);
      if (id === creators[0]) {
        const hide = new FormData();
        hide.set("composition", JSON.stringify({ revision: fresh.revision, contact: fresh.contact, cards: fresh.items.map((item) => ({
          assetId: item.asset_id, title: item.title, description: item.description, categoryId: item.category_id,
          fullLengthAssetId: item.full_length_asset_id, previewKey: item.preview_r2_key, visible: false,
        })) }));
        await redirected(app.actions.savePortfolioDraftAction(hide), "/portfolio?notice=draft_saved");
        fresh = await app.authoring.getPortfolioDraft(id);
        assert.equal(fresh.items[0].is_visible, 0, "hiding preserves the private draft card");
        const hiddenPublish = new FormData();
        hiddenPublish.set("composition", JSON.stringify({ revision: fresh.revision, contact: fresh.contact, cards: fresh.items.map((item) => ({
          assetId: item.asset_id, title: item.title, description: item.description, categoryId: item.category_id,
          fullLengthAssetId: item.full_length_asset_id, previewKey: item.preview_r2_key, visible: false,
        })) }));
        hiddenPublish.set("publicRightsApproved", "yes");
        await assert.rejects(app.actions.publishPortfolioAction(hiddenPublish), /Show at least one card/);
        assert.equal(app.db.prepare("SELECT COUNT(*) FROM creator_portfolio_release_versions WHERE creator_id=?").pluck().get(id), 0);
        fresh = await app.authoring.getPortfolioDraft(id);
      }
      const publish = new FormData();
      publish.set("composition", JSON.stringify({ revision: fresh.revision, contact: fresh.contact, cards: fresh.items.map((item) => ({
        assetId: item.asset_id, title: item.title, description: item.description, categoryId: item.category_id,
        fullLengthAssetId: item.full_length_asset_id, previewKey: item.preview_r2_key, visible: true,
      })) }));
      await assert.rejects(app.actions.publishPortfolioAction(publish), /rights and consent/i);
      assert.equal(app.db.prepare("SELECT COUNT(*) FROM creator_portfolio_release_versions WHERE creator_id=?").pluck().get(id), 0);
      publish.set("publicRightsApproved", "yes");
      if (id === creators[2]) app.setControlStatus(503);
      if (id === creators[2]) {
        await assert.rejects(app.actions.publishPortfolioAction(publish), /did not accept this request/);
        assert.equal(app.db.prepare("SELECT status FROM creator_portfolio_release_versions WHERE creator_id=?").pluck().get(id), "approved",
          "uncertain control result keeps approved version private for reconciliation");
      } else {
        await redirected(app.actions.publishPortfolioAction(publish), "/portfolio?notice=publication_started");
        const releaseId = app.db.prepare("SELECT id FROM creator_portfolio_release_versions WHERE creator_id=?").pluck().get(id);
        const manifest = JSON.parse(app.db.prepare("SELECT manifest_json FROM creator_portfolio_release_versions WHERE id=?").pluck().get(releaseId));
        assert.equal(manifest.contact.message, "Please ask about this preview.");
        assert.equal(manifest.cards.length, 1);
        app.db.prepare("UPDATE creator_portfolio_release_versions SET status='published' WHERE id=?").run(releaseId); // synthetic control receipt
        const withdraw = new FormData(); withdraw.set("versionId", releaseId);
        await redirected(app.actions.withdrawPortfolioAction(withdraw), "/portfolio?notice=withdrawal_started");
      }
      app.setControlStatus(202);
    }
    assert.deepEqual(app.controlCalls.map((call) => call.creatorId), [creators[0], creators[0], creators[1], creators[1], creators[2]],
      "one publish call per creator, then withdrawal only for accepted synthetic releases");
    app.setCreator(creators[0]);
    const foreign = new FormData(); foreign.set("assetId", `preview-${creators[1]}`);
    foreign.set("intent", "add"); foreign.set("confirmAdd", "yes");
    foreign.set("categoryChoice", app.db.prepare("SELECT id FROM creator_portfolio_categories WHERE creator_id=?").pluck().get(creators[0]));
    await assert.rejects(app.actions.togglePortfolioItemAction(foreign), /verified Library item is unavailable/);
    app.setRole("viewer");
    await assert.rejects(app.actions.togglePortfolioItemAction(foreign), /NOT_FOUND/);
    assert.equal(app.db.prepare("SELECT COUNT(*) FROM creator_portfolio_items").pluck().get(), 3);
    assert.equal(portfolioLibraryEligible({ safety: "nsfw", media_authority_state: "canonical_verified", extension: "mp4", video_codec: "h265" }), true);
  } finally { app.close(); }
});

test("a verified H.265 clip with an SFW filter tag can become a private draft and approved release", async () => {
  const app = await fixture();
  try {
    const creatorId = creators[0];
    app.db.prepare("UPDATE asset_classifications SET safety='sfw' WHERE asset_id=?").run(`unsupported-${creatorId}`);
    const category = new FormData(); category.set("name", "Clips");
    await redirected(app.actions.createPortfolioCategoryAction(category), "/portfolio");
    const categoryId = app.db.prepare("SELECT id FROM creator_portfolio_categories WHERE creator_id=?").pluck().get(creatorId);
    const add = new FormData(); add.set("assetId", `unsupported-${creatorId}`); add.set("intent", "add");
    add.set("confirmAdd", "yes"); add.set("categoryChoice", categoryId);
    await redirected(app.actions.togglePortfolioItemAction(add), `/library/unsupported-${creatorId}`);
    const draft = await app.authoring.getPortfolioDraft(creatorId);
    const publish = new FormData(); publish.set("publicRightsApproved", "yes");
    publish.set("composition", JSON.stringify({ revision: draft.revision, contact: draft.contact, cards: draft.items.map((item) => ({
      assetId: item.asset_id, title: item.title, description: item.description, categoryId: item.category_id,
      fullLengthAssetId: null, previewKey: item.preview_r2_key, visible: true,
    })) }));
    await redirected(app.actions.publishPortfolioAction(publish), "/portfolio?notice=publication_started");
    assert.equal(app.db.prepare("SELECT COUNT(*) FROM creator_portfolio_release_versions WHERE creator_id=?").pluck().get(creatorId), 1);
  } finally { app.close(); }
});

test("a hidden card remains in the private draft and is absent from the approved release", async () => {
  const app = await fixture();
  const creatorId = creators[0];
  try {
    const category = new FormData(); category.set("name", "Clips");
    await redirected(app.actions.createPortfolioCategoryAction(category), "/portfolio");
    const categoryId = app.db.prepare("SELECT id FROM creator_portfolio_categories WHERE creator_id=?").pluck().get(creatorId);
    const add = new FormData(); add.set("assetId", `preview-${creatorId}`); add.set("intent", "add");
    add.set("confirmAdd", "yes"); add.set("categoryChoice", categoryId);
    await redirected(app.actions.togglePortfolioItemAction(add), `/library/preview-${creatorId}`);
    app.db.prepare("INSERT INTO assets (id,creator_id,basename,extension,source_available,preview_r2_key) VALUES (?,?,?,'jpg',1,?)").run("hidden-photo", creatorId, "Hidden synthetic photo.jpg", "fixture/hidden-photo.jpg");
    app.db.prepare("INSERT INTO asset_classifications VALUES (?,?,'nsfw',0)").run("hidden-photo", creatorId);
    app.db.prepare("INSERT INTO creator_portfolio_items(asset_id,creator_id,title,category_id,preview_confirmed,is_visible,updated_by) VALUES (?,?,?,?,1,0,?)")
      .run("hidden-photo", creatorId, "Hidden synthetic photo", categoryId, `${creatorId}@example.invalid`);
    const draft = await app.authoring.getPortfolioDraft(creatorId);
    const publish = new FormData();
    publish.set("composition", JSON.stringify({ revision: draft.revision, contact: draft.contact, cards: draft.items.map((item) => ({
      assetId: item.asset_id, title: item.title, description: item.description, categoryId: item.category_id,
      fullLengthAssetId: item.full_length_asset_id, previewKey: item.preview_r2_key, visible: item.asset_id !== "hidden-photo",
    })) }));
    publish.set("publicRightsApproved", "yes");
    await redirected(app.actions.publishPortfolioAction(publish), "/portfolio?notice=publication_started");
    const manifest = JSON.parse(app.db.prepare("SELECT manifest_json FROM creator_portfolio_release_versions WHERE creator_id=?").pluck().get(creatorId));
    assert.deepEqual(manifest.cards.map((card) => card.assetId), [`preview-${creatorId}`]);
    assert.equal(app.db.prepare("SELECT is_visible FROM creator_portfolio_items WHERE asset_id='hidden-photo'").pluck().get(), 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) FROM creator_portfolio_items WHERE creator_id=?").pluck().get(creatorId), 2);
  } finally { app.close(); }
});
