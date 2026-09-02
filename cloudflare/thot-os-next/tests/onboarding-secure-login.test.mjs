import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("onboarding secure login uses the existing Access vault contract", async () => {
  const [component, route, action, vault] = await Promise.all([
    source("../src/app/onboarding/secure-login-capture.tsx"),
    source("../src/app/api/access/credentials/route.ts"),
    source("../src/app/onboarding/actions.ts"),
    source("../src/lib/access-vault.ts"),
  ]);
  assert.match(component, /\/api\/access\/credentials/);
  assert.match(component, /credentials: "same-origin"/);
  assert.match(component, /Login details saved securely\./);
  assert.match(component, /Sign in with Google/);
  assert.match(component, /Sign in with Apple/);
  assert.match(component, /method === "password"/);
  assert.match(component, /action: "step_up"/);
  assert.match(component, /This is your Account PIN/);
  assert.match(component, /aria-pressed=\{showPassword\}/);
  assert.match(component, /showPassword \? "Hide" : "Show"/);
  assert.match(component, /profilePlaceholders/);
  assert.match(component, /\+ Add account/);
  assert.doesNotMatch(component, /Account label/);
  assert.match(component, /saveLoginMethod\(account\)/);
  assert.match(component, /password needed/);
  assert.match(component, /has_credential/);
  assert.match(component, /password: ""/);
  assert.match(component, /setPin\(""\)/);
  assert.doesNotMatch(component, /password of at least 12|draft\.password\.length < 12/);
  assert.doesNotMatch(component, /Recovery or MFA notes/);
  assert.match(component, /onlyfans.*fansly.*manyvids.*patreon.*myroomz/);
  assert.match(route, /context\.creator\.role === "creator" \? 1/);
  assert.match(route, /Choose an account in your workspace/);
  assert.match(route, /context\.creator\.role === "creator" \? "" : text\(body\.notes, 2000\)/);
  assert.match(route, /action === "step_up"/);
  assert.match(route, /cookieStore\.set\(STEP_UP_COOKIE/);
  assert.match(route, /encryptCredentialPassword\(\{ creatorId, credentialId: id, accountId, password: password\(body\.password\) \}\)/);
  assert.doesNotMatch(route, /result\.length < 12|between 12 and 512/);
  assert.match(route, /Only agency administrators can revoke credentials/);
  assert.match(action, /createCreatorOperationalProfileAction/);
  assert.match(action, /createOperationalProfile\(form, true\)/);
  assert.match(action, /creatorLoginMethods = new Set\(\["password", "google", "apple"\]\)/);
  assert.match(action, /saveCreatorAccountLoginMethodAction/);
  assert.match(action, /requireCreatorPin\(identity\)/);
  assert.match(action, /Profile URLs must use https/);
  assert.match(action, /isCreator \? "draft" : "admin_review"/);
  assert.match(action, /WHERE id=\? AND creator_id=\? AND creator_visible=1/);
  assert.match(action, /creator \? 0 : \(form\.has\("isActive"\)/);
  assert.match(action, /return \{ ok: true, id: await createOperationalProfile\(form, true\) \}/);
  assert.match(vault, /encoder\.encode\(input\.password\)/);
  assert.doesNotMatch(vault, /JSON\.stringify\([^)]*password/);
  assert.doesNotMatch(route, /JSON\.stringify\([^)]*password/);
});

test("Access PIN lookup scopes the verifier to the authenticated role, email, and workspace", async () => {
  const [vault, page] = await Promise.all([source("../src/lib/access-vault.ts"), source("../src/app/access/page.tsx")]);
  const query = vault.match(/DB\.prepare\(`(SELECT id,pin_scope,salt,verifier,kdf_iterations,locked_until[\s\S]*?LIMIT 1)`\)\.bind\(input\.email, input\.role, input\.creatorId, input\.role\)/)?.[1];
  const availabilityQuery = page.match(/DB\.prepare\(`(SELECT id FROM vault_pin_verifiers[\s\S]*?LIMIT 1)`\)\.bind\(context\.email, context\.creator\.role, context\.creator\.creator_id, context\.creator\.role\)/)?.[1];
  assert.ok(query);
  assert.ok(availabilityQuery);
  assert.match(query, /pin_scope='administrator' AND creator_id IS NULL AND \?='agency_admin'/);
  assert.match(query, /pin_scope='creator' AND creator_id=\? AND \? IN \('agency_admin','creator'\)/);

  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE vault_pin_verifiers (
      id TEXT PRIMARY KEY, identity_email TEXT, creator_id TEXT, pin_scope TEXT,
      salt BLOB, verifier BLOB, kdf_iterations INTEGER, locked_until TEXT
    )`);
    const insert = db.prepare("INSERT INTO vault_pin_verifiers (id,identity_email,creator_id,pin_scope,salt,verifier,kdf_iterations,locked_until) VALUES (?,?,?,?,?,?,?,NULL)");
    insert.run("primary-admin", "connect@example.com", null, "administrator", Buffer.from("a"), Buffer.from("a"), 100000);
    insert.run("primary-creator", "connect@example.com", "thrill-noir", "creator", Buffer.from("c"), Buffer.from("c"), 100000);
    insert.run("foreign-workspace", "connect@example.com", "other-workspace", "creator", Buffer.from("f"), Buffer.from("f"), 100000);
    insert.run("creator-only", "creator-only@example.com", "thrill-noir", "creator", Buffer.from("c"), Buffer.from("c"), 100000);
    insert.run("admin-only", "admin-only@example.com", null, "administrator", Buffer.from("a"), Buffer.from("a"), 100000);

    const select = (email, role, creatorId) => db.prepare(query).get(email, role, creatorId, role);
    const available = (email, role, creatorId) => Boolean(db.prepare(availabilityQuery).get(email, role, creatorId, role));
    assert.equal(select("connect@example.com", "creator", "thrill-noir").id, "primary-creator");
    assert.equal(select("connect@example.com", "agency_admin", "thrill-noir").id, "primary-admin");
    assert.equal(select("connect@example.com", "creator", "missing-workspace"), undefined);
    assert.equal(select("other@example.com", "creator", "thrill-noir"), undefined);
    assert.equal(select("creator-only@example.com", "creator", "thrill-noir").id, "creator-only");
    assert.equal(select("admin-only@example.com", "creator", "thrill-noir"), undefined);
    assert.equal(select("admin-only@example.com", "agency_admin", "thrill-noir").id, "admin-only");
    assert.equal(select("creator-only@example.com", "agency_admin", "thrill-noir").id, "creator-only");
    assert.equal(select("connect@example.com", "operator", "thrill-noir"), undefined);
    assert.equal(select("connect@example.com", "viewer", "thrill-noir"), undefined);
    assert.equal(available("connect@example.com", "creator", "thrill-noir"), true);
    assert.equal(available("connect@example.com", "agency_admin", "thrill-noir"), true);
    assert.equal(available("connect@example.com", "creator", "missing-workspace"), false);
    assert.equal(available("other@example.com", "creator", "thrill-noir"), false);
    assert.equal(available("creator-only@example.com", "creator", "thrill-noir"), true);
    assert.equal(available("admin-only@example.com", "creator", "thrill-noir"), false);
    assert.equal(available("admin-only@example.com", "agency_admin", "thrill-noir"), true);
    assert.equal(available("creator-only@example.com", "agency_admin", "thrill-noir"), true);
    assert.equal(available("connect@example.com", "operator", "thrill-noir"), false);
    assert.equal(available("connect@example.com", "viewer", "thrill-noir"), false);
  } finally { db.close(); }
});

test("creator onboarding is a role-specific four-part flow", async () => {
  const [page, creator] = await Promise.all([
    source("../src/app/onboarding/page.tsx"),
    source("../src/components/creator-onboarding.tsx"),
  ]);
  assert.match(page, /if \(!admin\) return <AppShell/);
  assert.match(creator, /WHO IS THE REAL YOU\?/);
  assert.match(creator, /WHO IS THE ONLINE YOU\?/);
  assert.match(creator, /YOUR ACCOUNTS AND LOGINS/);
  assert.match(creator, /REVIEW AND HANDOFF/);
  assert.match(creator, /does not publish content or send messages/);
  assert.match(creator, /Finish these chapters before sending/);
  assert.match(creator, /SecureLoginCapture/);
  for (const adminOnly of ["retireOperationalAccountAction", "activateOnboardingAction", "saveComplianceAction", "administratorNotes", "connectionMethod"]) {
    assert.doesNotMatch(creator, new RegExp(adminOnly));
  }
});
