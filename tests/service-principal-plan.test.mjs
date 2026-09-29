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
    grants: ["thot-os-web-reddit:adelaide:reddit.status.read", "thot-os-web-public-links:adelaide:public.profile.publish"],
  });
  assert.equal(plan.mode, "plan-only");
  assert.equal(plan.principalCount, 4);
  assert.equal(plan.grants.length, 2);
  assert.ok(plan.requiredRemoteGates.some((gate) => gate.includes("0029")));
  assert.ok(plan.prohibited.includes("secret output"));
  assert.doesNotMatch(JSON.stringify(plan), /token_hash|Bearer|credential value/i);
  assert.throws(() => buildServicePrincipalPlan({ environment: "staging", contract, registry, grants: ["thot-os-web-reddit:adelaide:reddit.publish.execute:extra"] }), /grant/i);
  assert.throws(() => buildServicePrincipalPlan({ environment: "production", contract, registry, grants: [] }), /staging/i);
  const registryWithProductionWeb = structuredClone(registry);
  registryWithProductionWeb.environments.production.components.web = structuredClone(registry.environments.staging.components.web);
  assert.throws(() => buildServicePrincipalPlan({ environment: "staging", contract, registry: registryWithProductionWeb, grants: [] }), /operational target/i);
});

test("service-principal tooling refuses apply mode", () => {
  assert.throws(() => parseServicePrincipalPlanArguments(["--environment", "staging", "--apply"]), /plan-only/i);
});

test("service-principal plans assign each credential to its caller component and reject a foreign owner", async () => {
  const [contract, registry] = await Promise.all([readJson("config/service-principals.json"), readJson("config/deployments.json")]);
  const bookingContract = structuredClone(contract);
  bookingContract.principals.push({
    id: "booking-public-contact",
    principalName: "thot-os-booking-public-contact",
    secretName: "INTERNAL_BOOKING_CONTACT_TOKEN",
    callerComponent: "publicContact",
    receiver: "public-contact",
    capabilities: ["booking.contact.read"],
  });
  const bookingRegistry = structuredClone(registry);
  bookingRegistry.environments.staging.components.publicContact = {
    config: "cloudflare/public-contact/wrangler.jsonc",
    requiredSecrets: ["INTERNAL_BOOKING_CONTACT_TOKEN"],
  };
  const plan = buildServicePrincipalPlan({ environment: "staging", contract: bookingContract, registry: bookingRegistry });
  assert.deepEqual(plan.principalSecretRequirements.publicContact, ["INTERNAL_BOOKING_CONTACT_TOKEN"]);
  const foreignOwner = structuredClone(bookingRegistry);
  foreignOwner.environments.staging.components.web.requiredSecrets.push("INTERNAL_BOOKING_CONTACT_TOKEN");
  assert.throws(() => buildServicePrincipalPlan({ environment: "staging", contract: bookingContract, registry: foreignOwner }), /non-owner component web/i);
});
