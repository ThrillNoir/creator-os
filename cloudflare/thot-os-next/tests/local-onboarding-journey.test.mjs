import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as authorization from "../src/lib/authorization.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const ADMIN = "agency@example.test";
const RECIPIENT = "creator@example.test";
const CREATOR = "synthetic-creator";

function compile(sourceText) {
  return ts.transpileModule(sourceText, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  } }).outputText;
}

function loadModule(js, requireFixture) {
  const exports = {};
  new Function("require", "exports", js)(requireFixture, exports);
  return exports;
}

function sqliteD1(db) {
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        first() { return db.prepare(sql).get(...args) ?? null; },
        all() { return { results: db.prepare(sql).all(...args) }; },
        run() {
          const result = db.prepare(sql).run(...args);
          return { meta: { changes: result.changes } };
        },
      };
    },
    async batch(statements) {
      return db.transaction(() => statements.map((statement) => statement.run()))();
    },
  };
}

async function localJourney() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE creators (id TEXT PRIMARY KEY, name TEXT, slug TEXT, initials TEXT, accent TEXT, status TEXT NOT NULL);
    CREATE TABLE users (email TEXT PRIMARY KEY COLLATE NOCASE, display_name TEXT, status TEXT NOT NULL);
    CREATE TABLE creator_memberships (
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
      role TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (creator_id,user_email)
    );
    CREATE TABLE identity_audit_events (
      id TEXT PRIMARY KEY, creator_id TEXT REFERENCES creators(id), actor_email TEXT,
      actor_role TEXT, event_type TEXT, subject TEXT, detail TEXT
    );
    CREATE TABLE creator_onboarding_profiles (
      creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
      stage_name TEXT NOT NULL DEFAULT '', workflow_state TEXT NOT NULL DEFAULT 'draft'
    );
  `);
  db.prepare("INSERT INTO creators VALUES (?,?,?,?,?,?)").run("adelaide", "Migration fixture", "adelaide", "MF", "#6f4df6", "active");
  db.exec(await source("../../thot-os-app/migrations/0030_canonical_control_plane.sql"));
  db.exec(await source("../../thot-os-app/migrations/0056_creator_invitations.sql"));
  db.prepare("INSERT INTO creators VALUES (?,?,?,?,?,?)").run("agency", "Agency", "agency", "AG", "#6f4df6", "active");
  db.prepare("INSERT INTO users VALUES (?,?,?)").run(ADMIN, "Agency Admin", "active");
  db.prepare("INSERT INTO creator_memberships VALUES (?,?,?,?)").run("agency", ADMIN, "agency_admin", "active");
  const DB = sqliteD1(db);

  let signedInEmail = ADMIN;
  let redirectedTo = null;
  const redirect = (path) => { redirectedTo = path; throw new Error(`redirect:${path}`); };
  const notFound = () => { throw new Error("NOT_FOUND"); };
  const cookies = async () => ({ get: () => undefined });
  const env = {
    DB,
    APP_BASE_URL: "https://local.example.test",
    EMAIL: { send: async (message) => { sentEmail = message; } },
  };
  let sentEmail = null;
  const identityJs = compile(await source("../src/lib/identity.ts"));
  const identity = loadModule(identityJs, (name) => {
    if (name === "server-only") return {};
    if (name === "next/headers") return { cookies };
    if (name === "next/navigation") return { notFound };
    if (name === "./access") return { requireAccessIdentity: async () => ({ email: signedInEmail.toLowerCase() }) };
    if (name === "./authorization") return authorization;
    if (name === "./cloudflare") return { cloudflareEnv: () => env };
    throw new Error(`Unexpected identity import: ${name}`);
  });

  const onboarding = loadModule(compile(await source("../src/lib/creator-onboarding.ts")), (name) => {
    if (name === "server-only") return {};
    throw new Error(`Unexpected onboarding import: ${name}`);
  });
  const actionJs = compile(await source("../src/app/identity-actions.ts"));
  const action = loadModule(actionJs, (name) => {
    if (name === "next/headers") return { cookies };
    if (name === "next/cache") return { revalidatePath() {} };
    if (name === "next/navigation") return { redirect };
    if (name === "@/lib/cloudflare") return { cloudflareEnv: () => env };
    if (name === "@/lib/audit-identity") return {
      humanAuditActor: (context) => ({ identity: context.email.toLowerCase(), role: context.creator.role, creatorId: context.creator.creator_id }),
      identityAuditStatement: (targetDb, actor, event, subject, detail = {}) => targetDb.prepare(
        "INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,?,?,?,?)",
      ).bind(crypto.randomUUID(), actor.creatorId, actor.identity, actor.role, event, subject, JSON.stringify(detail)),
    };
    if (name === "@/lib/identity") return identity;
    if (name === "@/lib/access") return { verifyAccessIdentity: async () => ({ email: signedInEmail.toLowerCase() }) };
    if (name === "@/lib/creator-onboarding") return onboarding;
    if (name === "@/lib/authorization") return authorization;
    if (name === "@/lib/access-vault") return { revokeStepUpSessions: async () => {}, STEP_UP_COOKIE: "step-up" };
    throw new Error(`Unexpected identity action import: ${name}`);
  });

  const pageModule = loadModule(compile(await source("../src/app/invite/[token]/page.tsx")), (name) => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "@/lib/cloudflare") return { cloudflareEnv: () => env };
    if (name === "@/lib/access") return { verifyAccessIdentity: async () => ({ email: signedInEmail.toLowerCase() }) };
    if (name === "@/app/identity-actions") return { claimCreatorInvitationAction: "/claim" };
    throw new Error(`Unexpected invitation page import: ${name}`);
  });

  return {
    db, env, identity, action, pageModule,
    get signedInEmail() { return signedInEmail; },
    set signedInEmail(value) { signedInEmail = value; },
    get sentEmail() { return sentEmail; },
    get redirectedTo() { return redirectedTo; },
    resetRedirect() { redirectedTo = null; },
    close() { db.close(); },
  };
}

test("agency onboarding, identity-bound invite claim, and creator isolation work end to end locally", async () => {
  const journey = await localJourney();
  try {
    const form = new FormData();
    form.set("creatorId", CREATOR);
    form.set("slug", CREATOR);
    form.set("name", "Synthetic Creator");
    form.set("initials", "SC");
    form.set("accent", "#6f4df6");
    form.set("invitationEmail", RECIPIENT);
    await journey.action.onboardCreatorWorkspaceAction(form);

    assert.deepEqual(journey.db.prepare("SELECT id,name,status FROM creators WHERE id=?").get(CREATOR), {
      id: CREATOR, name: "Synthetic Creator", status: "active",
    });
    assert.equal(journey.db.prepare("SELECT status FROM creator_memberships WHERE creator_id=? AND lower(user_email)=lower(?)").pluck().get(CREATOR, ADMIN), "active");
    const createdInvite = journey.db.prepare("SELECT id,invited_email,status,sent_at,token_hash FROM creator_invitations WHERE creator_id=?").get(CREATOR);
    assert.equal(createdInvite.invited_email, RECIPIENT);
    assert.equal(createdInvite.status, "pending");
    assert.ok(createdInvite.sent_at);
    assert.equal(createdInvite.token_hash.length, 64);
    assert.equal(journey.db.prepare("SELECT status FROM creator_onboarding_receipts WHERE creator_id=?").pluck().get(CREATOR), "completed");
    assert.equal(journey.db.prepare("SELECT COUNT(*) FROM identity_audit_events WHERE creator_id=? AND event_type='creator_workspace_onboarded'").pluck().get(CREATOR), 1);
    assert.equal(journey.sentEmail.to, RECIPIENT);
    assert.match(journey.sentEmail.text, /Sign in with Cloudflare Access and claim it here/);
    const token = new URL(journey.sentEmail.text.match(/https:\/\/local\.example\.test\/invite\/([^\s]+)/)[0]).pathname.split("/").at(-1);
    assert.match(token, /^[a-f0-9]{64}$/);

    journey.signedInEmail = "wrong@example.test";
    const concealedPage = renderToStaticMarkup(await journey.pageModule.default({ params: Promise.resolve({ token }) }));
    assert.match(concealedPage, /unavailable for the signed-in identity/);
    assert.doesNotMatch(concealedPage, new RegExp(RECIPIENT));
    assert.doesNotMatch(concealedPage, /<form/);
    assert.equal(journey.db.prepare("SELECT status FROM creator_invitations WHERE creator_id=?").pluck().get(CREATOR), "pending");

    journey.signedInEmail = RECIPIENT;
    const matchingPage = renderToStaticMarkup(await journey.pageModule.default({ params: Promise.resolve({ token }) }));
    assert.match(matchingPage, new RegExp(RECIPIENT));
    assert.match(matchingPage, /Claim workspace/);

    const claimForm = new FormData();
    claimForm.set("token", token);
    try { await journey.action.claimCreatorInvitationAction(claimForm); }
    catch (error) { assert.equal(error.message, "redirect:/onboarding"); }
    assert.equal(journey.db.prepare("SELECT status FROM users WHERE lower(email)=lower(?)").pluck().get(RECIPIENT), "active");
    assert.equal(journey.db.prepare("SELECT status FROM creator_invitations WHERE creator_id=?").pluck().get(CREATOR), "accepted");
    assert.deepEqual(journey.db.prepare("SELECT role,status FROM creator_memberships WHERE creator_id=? AND lower(user_email)=lower(?)").get(CREATOR, RECIPIENT), { role: "creator", status: "active" });
    assert.equal(journey.db.prepare("SELECT COUNT(*) FROM identity_audit_events WHERE creator_id=? AND event_type='creator_invitation_accepted'").pluck().get(CREATOR), 1);

    const context = await journey.identity.getCreatorContext(CREATOR);
    assert.equal(context.creator.creator_id, CREATOR);
    assert.equal(await journey.identity.getCreatorContext("agency"), null, "creator identity cannot request a foreign agency workspace");
    assert.equal(journey.db.prepare("SELECT status FROM creator_invitations WHERE creator_id=?").pluck().get(CREATOR), "accepted", "claim replay does not reopen invitation");
    journey.resetRedirect();
    const replay = await (async () => {
      try { await journey.action.claimCreatorInvitationAction(claimForm); return null; }
      catch (error) { return error; }
    })();
    assert.match(replay?.message ?? "", /not for the signed-in Access identity/i);
    assert.equal(journey.db.prepare("SELECT COUNT(*) FROM creator_memberships WHERE creator_id=? AND lower(user_email)=lower(?)").pluck().get(CREATOR, RECIPIENT), 1);
    assert.equal(journey.db.prepare("SELECT COUNT(*) FROM identity_audit_events WHERE creator_id=? AND event_type='creator_invitation_accepted'").pluck().get(CREATOR), 1);

    journey.db.prepare("INSERT INTO users VALUES (?,?,?)").run("viewer@example.test", "Viewer", "active");
    journey.db.prepare("INSERT INTO creator_memberships VALUES (?,?,?,?)").run(CREATOR, "viewer@example.test", "viewer", "active");
    journey.signedInEmail = "viewer@example.test";
    assert.equal((await journey.identity.getCreatorContext(CREATOR)).creator.role, "viewer");
    await assert.rejects(journey.identity.requireCreatorContext("mutate", CREATOR), /NOT_FOUND/);

    journey.db.prepare("INSERT INTO users VALUES (?,?,?)").run("operator@example.test", "Operator", "active");
    journey.db.prepare("INSERT INTO creator_memberships VALUES (?,?,?,?)").run(CREATOR, "operator@example.test", "operator", "active");
    journey.signedInEmail = "operator@example.test";
    assert.equal((await journey.identity.getCreatorContext(CREATOR)).creator.role, "operator");
    assert.equal((await journey.identity.requireCreatorContext("mutate", CREATOR)).creator.creator_id, CREATOR);
    await assert.rejects(journey.identity.requireCreatorContext("manage_identity", CREATOR), /NOT_FOUND/);
    assert.equal(await journey.identity.getCreatorContext("agency"), null, "operator membership does not grant the agency workspace");
    await assert.rejects(journey.identity.requireCreatorContext("mutate", "agency"), /NOT_FOUND/);
  } finally {
    journey.close();
  }
});
