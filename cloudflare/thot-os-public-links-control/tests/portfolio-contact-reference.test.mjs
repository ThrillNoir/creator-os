import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { portfolioContactName, portfolioContactReferenceKey, validPortfolioContactName } from "../../shared/portfolio-contact-reference.ts";

const source = readFileSync(new URL("../src/portfolio-release.ts", import.meta.url), "utf8");
const start = source.indexOf("async function writePortfolioContactReferences(");
const end = source.indexOf("\n/** Make a creator-initiated withdrawal", start);
const writePortfolioContactReferences = new Function("portfolioContactReferenceKey", "validPortfolioContactName",
  `${stripTypeScriptTypes(source.slice(start, end))}; return writePortfolioContactReferences;`)(portfolioContactReferenceKey, validPortfolioContactName);

test("release stores only the linked full video's renamed display name in a private version-bound reference", async () => {
  const writes = [];
  const queries = [];
  const env = {
    ADULT_PROFILES: { async put(key, value) { writes.push({ key, value: JSON.parse(value) }); } },
    DB: { prepare(sql) { assert.match(sql, /creator_id=\? AND id=\? AND source_available=1/);
      return { bind(creatorId, assetId) { queries.push({ creatorId, assetId });
        return { async first() { return { display_name: "Renamed full video.mp4" }; } }; } }; } },
  };
  const release = { id: "release-one", slug: "adelaide", creator_id: "creator-one", adult_profile_version_id: "profile-one" };
  const manifest = { schemaVersion: 2, cards: [
    { id: "public-card", fullLengthAssetId: "private-full-asset" },
    { id: "preview-only", fullLengthAssetId: null },
  ] };
  await writePortfolioContactReferences(env, release, manifest);
  assert.deepEqual(queries, [{ creatorId: "creator-one", assetId: "private-full-asset" }]);
  assert.equal(writes[0].key, "adult-portfolio-contact:adelaide:release-one");
  assert.equal(writes[0].value.names["public-card"], "Renamed full video.mp4");
  assert.equal(writes[0].value.names["preview-only"], undefined);
  assert.doesNotMatch(JSON.stringify(writes[0].value), /private-full-asset/);
  assert.equal(portfolioContactName(writes[0].value, "adelaide", "profile-one", "release-one", "public-card"), "Renamed full video.mp4");
  assert.equal(portfolioContactName(writes[0].value, "other-creator", "profile-one", "release-one", "public-card"), null);
  assert.equal(portfolioContactName(writes[0].value, "adelaide", "profile-one", "older-release", "public-card"), null);
  assert.equal(portfolioContactName(writes[0].value, "adelaide", "profile-one", "release-one", "preview-only"), null);
  assert.equal(portfolioContactName(writes[0].value, "adelaide", "profile-one", "release-one", "constructor"), null);
});

test("unsafe source names are omitted from the private contact reference", async () => {
  let reference;
  const env = { ADULT_PROFILES: { async put(_key, value) { reference = JSON.parse(value); } },
    DB: { prepare() { return { bind() { return { async first() { return { display_name: "bad\nname.mp4" }; } }; } }; } } };
  await writePortfolioContactReferences(env,
    { id: "release-one", slug: "adelaide", creator_id: "creator-one", adult_profile_version_id: "profile-one" },
    { schemaVersion: 2, cards: [{ id: "public-card", fullLengthAssetId: "private-full-asset" }] });
  assert.deepEqual(reference.names, {});
  assert.equal(portfolioContactName(reference, "adelaide", "profile-one", "release-one", "public-card"), null);
});
