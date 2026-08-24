import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("the purchased public domain is exclusive to the isolated link hub", async () => {
  const registry = JSON.parse(await readFile(path.join(root, "config/deployments.json"), "utf8"));
  const production = registry.environments.production;
  const publicDomain = production.publicLinkDomain;
  const publicLinks = production.components.publicLinks;

  assert.deepEqual(publicDomain, {
    hostname: "thathuboverthere.com",
    profilePath: "/<creator-slug>",
    exclusiveComponent: "publicLinks",
    state: "reserved-unattached",
    privateDashboard: "must use a separately selected hostname, a separately deployed private Worker and a dedicated Cloudflare Access policy; it must never attach to this public link domain",
  });
  assert.equal(publicDomain.exclusiveComponent, "publicLinks");
  assert.deepEqual(publicLinks.resources.d1, []);
  assert.deepEqual(publicLinks.resources.r2, []);
  assert.deepEqual(publicLinks.resources.queues, []);
  assert.deepEqual(publicLinks.resources.services, {});
  assert.deepEqual(publicLinks.requiredSecrets, []);
});
