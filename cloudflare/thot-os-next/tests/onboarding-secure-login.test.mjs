import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

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
  assert.match(component, /saveLoginMethod\(form\)/);
  assert.match(component, /password: ""/);
  assert.match(component, /setPin\(""\)/);
  assert.doesNotMatch(component, /Recovery or MFA notes/);
  assert.match(component, /onlyfans.*fansly.*manyvids.*patreon.*myroomz/);
  assert.match(route, /context\.creator\.role === "creator" \? 1/);
  assert.match(route, /Choose an account in your workspace/);
  assert.match(route, /context\.creator\.role === "creator" \? "" : text\(body\.notes, 2000\)/);
  assert.match(route, /encryptCredentialPassword\(\{ creatorId, credentialId: id, accountId, password: password\(body\.password\) \}\)/);
  assert.match(route, /Only agency administrators can revoke credentials/);
  assert.match(action, /createCreatorOperationalProfileAction/);
  assert.match(action, /createOperationalProfile\(form, true\)/);
  assert.match(action, /creatorLoginMethods = new Set\(\["password", "google", "apple"\]\)/);
  assert.match(action, /saveCreatorAccountLoginMethodAction/);
  assert.match(action, /WHERE id=\? AND creator_id=\? AND creator_visible=1/);
  assert.match(action, /creator \? 0 : \(form\.has\("isActive"\)/);
  assert.match(action, /return \{ ok: true, id: await createOperationalProfile\(form, true\) \}/);
  assert.match(vault, /encoder\.encode\(input\.password\)/);
  assert.doesNotMatch(vault, /JSON\.stringify\([^)]*password/);
  assert.doesNotMatch(route, /JSON\.stringify\([^)]*password/);
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
  assert.match(creator, /REVIEW AND SUBMIT/);
  assert.match(creator, /SecureLoginCapture/);
  for (const adminOnly of ["retireOperationalAccountAction", "activateOnboardingAction", "saveComplianceAction", "administratorNotes", "connectionMethod"]) {
    assert.doesNotMatch(creator, new RegExp(adminOnly));
  }
});
