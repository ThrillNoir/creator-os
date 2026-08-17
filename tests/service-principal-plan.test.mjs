import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildServicePrincipalPlan, parseServicePrincipalPlanArguments } from "../scripts/service-principal-plan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (file) => readFile(path.join(root, file), "utf8").then(JSON.parse);

test("service-principal provisioning plans require explicit, allowed creator capabilities and contain no secret material", async () => {
  const [contract, registry] = await Promise.all([readJson("config/service-principals.json"), readJson("config/deployments.json")]);
  const plan = buildServicePrincipalPlan({
    environment: "staging",
    contract,
    registry,
    grants: ["thot-os-web-reddit:adelaide:reddit.status.read", "thot-os-web-vault-catalogue:adelaide:vault.catalogue.refresh"],
  });
  assert.equal(plan.mode, "plan-only");
  assert.equal(plan.principalCount, 5);
  assert.equal(plan.grants.length, 2);
  assert.ok(plan.requiredRemoteGates.some((gate) => gate.includes("0029")));
  assert.ok(plan.prohibited.includes("secret output"));
  assert.doesNotMatch(JSON.stringify(plan), /token_hash|Bearer|credential value/i);
  assert.throws(() => buildServicePrincipalPlan({ environment: "staging", contract, registry, grants: ["thot-os-web-reddit:adelaide:reddit.publish.execute:extra"] }), /grant/i);
  assert.throws(() => buildServicePrincipalPlan({ environment: "production", contract, registry, grants: [] }), /staging/i);
});

test("service-principal tooling refuses apply mode", () => {
  assert.throws(() => parseServicePrincipalPlanArguments(["--environment", "staging", "--apply"]), /plan-only/i);
});
