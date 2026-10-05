import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const financeSource = await readFile(new URL("../src/lib/finance.ts", import.meta.url), "utf8");
const helperSource = financeSource.match(/export function calculateProvisionalCommission\([\s\S]*?\n}/)?.[0];
assert.ok(helperSource, "commission allocation helper exists");
const compiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function("exports", compiled)(moduleExports);
const calculateProvisionalCommission = moduleExports.calculateProvisionalCommission;

test("commission allocation stays unavailable while revenue base and eligible-sale evidence are unresolved", () => {
  assert.equal(calculateProvisionalCommission(12345, null), null);
  assert.equal(calculateProvisionalCommission(12345, { agency_split_bps: 5000 }), null);
  assert.equal(calculateProvisionalCommission(12345, { agency_split_bps: 0 }), null);
});

test("50% is an unsaved proposal default; saved values including zero are retained", async () => {
  const page = await readFile(new URL("../src/app/money/page.tsx", import.meta.url), "utf8");
  assert.match(page, /savedPercentage === null \? "50\.00" : \(savedPercentage \/ 100\)\.toFixed\(2\)/);
  assert.match(page, /Split rules not set\. The 50% starting proposal is only a form default and has not been saved/);
  assert.match(page, /type="number"[^>]*required/);
  assert.match(page, /Effective date<input name="effectiveOn" type="date" required/);
  assert.match(page, /agencySplitPercent/);
  assert.match(page, /Platforms pay creators directly/);
  assert.match(page, /only paid-site sales generated through THOT OS/);
  assert.match(page, /platform deductions are unknown/);
  assert.match(page, /currently charges no software or subscription fee/);
  assert.match(page, /future fees are undecided/);
  assert.match(page, /calculation base and cadence still need agreement/);
  assert.match(page, /do not establish eligibility evidence, a calculation base, cadence, invoice, or amount due/);
  assert.match(page, /<span>—<\/span><span>—<\/span>/);
  assert.match(page, /does not connect to platform earnings APIs/);
  assert.match(page, /roleCan\(context\.creator\.role, "manage_identity"\)/);
  assert.match(page, /dashboard\.agencySplitProposals/);
});
