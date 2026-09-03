import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Access credential requirements remain visible and invalid saves are announced", async () => {
  const [controls, route] = await Promise.all([
    source("../src/app/access/access-controls.tsx"),
    source("../src/app/api/access/credentials/route.ts"),
  ]);
  assert.match(controls, /id="credential-requirements"/);
  assert.match(controls, /maxLength=\{512\}/);
  assert.doesNotMatch(controls, /minLength=\{12\}/);
  assert.match(controls, /role="alert"/);
  assert.doesNotMatch(controls, /disabled=\{!draft\.label/);
  assert.match(route, /if \(!label\) throw new Error\("Enter a credential label\."\)/);
});

test("retired accounts cannot become the presented publishing identity", async () => {
  const [accounts, operations] = await Promise.all([
    source("../src/app/accounts/page.tsx"),
    source("../src/lib/operations.ts"),
  ]);
  assert.match(accounts, /platform='fansly' AND oa\.is_active=1/);
  assert.match(accounts, /account\.is_active \? <>[\s\S]*startInstagramReconnectAction[\s\S]*: <Link href="\/onboarding">Review account/);
  assert.match(operations, /platform='fansly' AND is_active=1/);
});
