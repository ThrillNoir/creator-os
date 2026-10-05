import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TOKEN = "a".repeat(64);
const EMAIL = "creator@example.test";
const CREATOR_ID = "new-creator";
const INVITATION_ID = "invite-1";

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadClaimAction() {
  const sourceText = await source("../src/app/identity-actions.ts");
  const start = sourceText.indexOf("export async function claimCreatorInvitationAction(");
  const end = sourceText.indexOf("\nexport async function registerBrowserProfileAction(", start);
  assert.ok(start >= 0 && end > start, "claim action source boundary should be present");
  const actionTs = sourceText.slice(start, end).replace("export async function", "async function");
  const actionJs = ts.transpileModule(actionTs, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return actionJs;
}

async function fixture({ identity = EMAIL, existingUserStatus, invitationStatus = "pending", expiresAt = "2099-01-01", creatorStatus = "active", batchHook } = {}) {
  const [migration, actionJs] = await Promise.all([
    source("../../thot-os-app/migrations/0056_creator_invitations.sql"),
    loadClaimAction(),
  ]);
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE creators (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (email TEXT PRIMARY KEY COLLATE NOCASE, display_name TEXT, status TEXT);
    CREATE TABLE creator_memberships (
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
      role TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (creator_id, user_email)
    );
    CREATE TABLE identity_audit_events (id TEXT PRIMARY KEY, creator_id TEXT, actor_email TEXT, actor_role TEXT, event_type TEXT, subject TEXT, detail TEXT);
  `);
  db.exec(migration);
  db.prepare("INSERT INTO creators (id,status) VALUES (?,?)").run(CREATOR_ID, creatorStatus);
  db.prepare("INSERT INTO users VALUES ('admin@example.test','Agency Admin','active')").run();
  if (existingUserStatus) db.prepare("INSERT INTO users VALUES (?,?,?)").run(identity, identity, existingUserStatus);
  const tokenHash = await digest(TOKEN);
  db.prepare("INSERT INTO creator_invitations (id,creator_id,invited_email,token_hash,expires_at,created_by,status) VALUES (?,?,?,?,?,?,?)")
    .run(INVITATION_ID, CREATOR_ID, EMAIL, tokenHash, expiresAt, "admin@example.test", invitationStatus);

  let batchCalls = 0;
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...boundValues) { values = boundValues; return this; },
        first() { return db.prepare(sql).get(...values) ?? null; },
        run() {
          const result = db.prepare(sql).run(...values);
          return { meta: { changes: result.changes } };
        },
      };
    },
    async batch(statements) {
      batchCalls++;
      await batchHook?.(db);
      return db.transaction(() => statements.map((statement) => statement.run()))();
    },
  };
  const redirectMarker = new Error("redirected");
  const claimAction = await new AsyncFunction(
    "verifyAccessIdentity", "cloudflareEnv", "sha256", "redirect",
    `${actionJs}\nreturn claimCreatorInvitationAction;`,
  )(
    async () => ({ email: identity.toLowerCase() }),
    () => ({ DB }),
    digest,
    (destination) => { redirectMarker.destination = destination; throw redirectMarker; },
  );
  return {
    db,
    claimAction,
    get batchCalls() { return batchCalls; },
    async claim(token = TOKEN) {
      const form = new FormData();
      form.set("token", token);
      try {
        await claimAction(form);
        assert.fail("claim should either redirect or reject");
      } catch (error) {
        if (error === redirectMarker) return { redirected: error.destination };
        return { error };
      }
    },
    close() { db.close(); },
  };
}

test("valid invitation executes the claim action and creates an active creator membership", async () => {
  const state = await fixture();
  try {
    assert.deepEqual(await state.claim(), { redirected: "/onboarding" });
    assert.equal(state.batchCalls, 1);
    assert.equal(state.db.prepare("SELECT status FROM creator_invitations WHERE id=?").pluck().get(INVITATION_ID), "accepted");
    assert.equal(state.db.prepare("SELECT status FROM users WHERE lower(email)=lower(?)").pluck().get(EMAIL), "active");
    assert.deepEqual(state.db.prepare("SELECT role,status FROM creator_memberships WHERE creator_id=? AND lower(user_email)=lower(?)").get(CREATOR_ID, EMAIL), { role: "creator", status: "active" });
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM identity_audit_events WHERE event_type='creator_invitation_accepted' AND lower(actor_email)=lower(?)").pluck().get(EMAIL), 1);
  } finally {
    state.close();
  }
});

test("suspended existing user is rejected before the claim batch and keeps the invitation pending", async () => {
  const state = await fixture({ existingUserStatus: "suspended" });
  try {
    const result = await state.claim();
    assert.match(result.error?.message ?? "", /account is suspended/i);
    assert.equal(state.batchCalls, 0, "pre-read denial must not start a write batch");
    assert.equal(state.db.prepare("SELECT status FROM users WHERE lower(email)=lower(?)").pluck().get(EMAIL), "suspended");
    assert.equal(state.db.prepare("SELECT status FROM creator_invitations WHERE id=?").pluck().get(INVITATION_ID), "pending");
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM creator_memberships WHERE lower(user_email)=lower(?)").pluck().get(EMAIL), 0);
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM identity_audit_events").pluck().get(), 0);
  } finally {
    state.close();
  }
});

test("suspended user detected inside the SQL batch remains unclaimed", async () => {
  const state = await fixture({ existingUserStatus: "active", batchHook: async (db) => {
    db.prepare("UPDATE users SET status='suspended' WHERE lower(email)=lower(?)").run(EMAIL);
  } });
  try {
    const result = await state.claim();
    assert.match(result.error?.message ?? "", /account is suspended/i);
    assert.equal(state.batchCalls, 1);
    assert.equal(state.db.prepare("SELECT status FROM users WHERE lower(email)=lower(?)").pluck().get(EMAIL), "suspended");
    assert.equal(state.db.prepare("SELECT status FROM creator_invitations WHERE id=?").pluck().get(INVITATION_ID), "pending");
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM creator_memberships WHERE lower(user_email)=lower(?)").pluck().get(EMAIL), 0);
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM identity_audit_events").pluck().get(), 0);
  } finally {
    state.close();
  }
});

test("inactive creator workspace is denied before any claim write", async () => {
  const state = await fixture({ creatorStatus: "suspended" });
  try {
    const result = await state.claim();
    assert.match(result.error?.message ?? "", /not for the signed-in Access identity/i);
    assert.equal(state.batchCalls, 0);
    assert.equal(state.db.prepare("SELECT status FROM creator_invitations WHERE id=?").pluck().get(INVITATION_ID), "pending");
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM users WHERE lower(email)=lower(?)").pluck().get(EMAIL), 0);
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM creator_memberships").pluck().get(), 0);
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM identity_audit_events").pluck().get(), 0);
  } finally {
    state.close();
  }
});

test("workspace suspended after lookup stays unclaimed by the SQL batch guard", async () => {
  const state = await fixture({ batchHook: async (db) => {
    db.prepare("UPDATE creators SET status='suspended' WHERE id=?").run(CREATOR_ID);
  } });
  try {
    const result = await state.claim();
    assert.match(result.error?.message ?? "", /invalid, expired, or already claimed/i);
    assert.equal(state.batchCalls, 1);
    assert.equal(state.db.prepare("SELECT status FROM creators WHERE id=?").pluck().get(CREATOR_ID), "suspended");
    assert.equal(state.db.prepare("SELECT status FROM creator_invitations WHERE id=?").pluck().get(INVITATION_ID), "pending");
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM users WHERE lower(email)=lower(?)").pluck().get(EMAIL), 0, "an inactive workspace does not create an orphan active user");
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM creator_memberships").pluck().get(), 0);
    assert.equal(state.db.prepare("SELECT COUNT(*) FROM identity_audit_events").pluck().get(), 0);
  } finally {
    state.close();
  }
});

test("wrong identity, expired invitation, and revoked invitation do not start a claim batch", async (context) => {
  for (const scenario of [
    { name: "wrong email", options: { identity: "other@example.test" }, expected: /not for the signed-in Access identity/i },
    { name: "expired", options: { expiresAt: "2000-01-01" }, expected: /not for the signed-in Access identity/i },
    { name: "revoked", options: { invitationStatus: "revoked" }, expected: /not for the signed-in Access identity/i },
  ]) {
    await context.test(scenario.name, async () => {
      const state = await fixture(scenario.options);
      try {
        const result = await state.claim();
        assert.match(result.error?.message ?? "", scenario.expected);
        assert.equal(state.batchCalls, 0);
        assert.equal(state.db.prepare("SELECT status FROM creator_invitations WHERE id=?").pluck().get(INVITATION_ID), scenario.options.invitationStatus ?? "pending");
        assert.equal(state.db.prepare("SELECT COUNT(*) FROM creator_memberships").pluck().get(), 0);
      } finally {
        state.close();
      }
    });
  }
});

async function invitationPage({ identity, invitedEmail = EMAIL, creatorActive = true }) {
  const pageSource = await source("../src/app/invite/[token]/page.tsx");
  const compiled = ts.transpileModule(pageSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  let verifiedIdentityCalls = 0;
  const db = { prepare(sql) {
    assert.match(sql, /JOIN creators c ON c\.id=i\.creator_id AND c\.status='active'/);
    return { bind() { return this; }, first: async () => creatorActive ? ({ invited_email: invitedEmail, expires_at: "2099-01-01" }) : null };
  } };
  const requireFixture = (name) => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "@/lib/cloudflare") return { cloudflareEnv: () => ({ DB: db }) };
    if (name === "@/lib/access") return { verifyAccessIdentity: async () => { verifiedIdentityCalls++; return { email: identity }; } };
    if (name === "@/app/identity-actions") return { claimCreatorInvitationAction: "/claim" };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function("require", "exports", compiled)(requireFixture, exports);
  const html = renderToStaticMarkup(await exports.default({ params: Promise.resolve({ token: TOKEN }) }));
  return { html, verifiedIdentityCalls };
}

test("invitation page verifies identity and conceals recipient details from a mismatched Access identity", async () => {
  const page = await invitationPage({ identity: "different@example.test" });
  assert.equal(page.verifiedIdentityCalls, 1);
  assert.match(page.html, /unavailable for the signed-in identity/);
  assert.doesNotMatch(page.html, new RegExp(EMAIL));
  assert.doesNotMatch(page.html, /name="token"/);
  assert.doesNotMatch(page.html, /<form/);
});

test("invitation page renders claim details only for the matching Access identity", async () => {
  const page = await invitationPage({ identity: EMAIL.toUpperCase() });
  assert.equal(page.verifiedIdentityCalls, 1);
  assert.match(page.html, new RegExp(EMAIL));
  assert.match(page.html, /name="token"/);
  assert.match(page.html, /Claim workspace/);
});

test("inactive creator workspace is not presented as claimable", async () => {
  const page = await invitationPage({ identity: EMAIL, creatorActive: false });
  assert.match(page.html, /unavailable for the signed-in identity/);
  assert.doesNotMatch(page.html, new RegExp(EMAIL));
  assert.doesNotMatch(page.html, /<form/);
});
