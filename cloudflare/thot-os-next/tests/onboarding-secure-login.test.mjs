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
  assert.match(component, /Recovery or MFA notes/);
  assert.match(component, /setDraft\(\{ platform: "instagram", label: "", username: "", loginEmail: "", profileUrl: "", purpose: "", password: "", notes: "" \}\)/);
  assert.match(route, /context\.creator\.role === "creator" \? 1/);
  assert.match(route, /notes: text\(body\.notes, 2000\)/);
  assert.match(route, /Only agency administrators can revoke credentials/);
  assert.match(action, /return \{ ok: true, id \}/);
  assert.match(vault, /JSON\.stringify\(\{ password: input\.password, notes: input\.notes/);
  assert.doesNotMatch(route, /JSON\.stringify\([^)]*password/);
});
