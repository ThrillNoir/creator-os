import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { isPublicCreatorSlug } from "../../shared/public-profile-slug.ts";

test("publication rejects a reserved slug before loading or writing a projection", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function loadApprovedProfile("), source.indexOf("async function loadCurrentPublicProfile("));
  const load = new Function("isPublicCreatorSlug", "validHttpsDestination", `return (${stripTypeScriptTypes(body)})`)(isPublicCreatorSlug, () => true);
  let reads = 0;
  const env = { DB: { prepare() {
    reads++;
    return { bind() { return this; }, first: async () => ({ slug: "messages", profile_status: "active", version_status: "approved", approved_by: "test-admin", approved_at: "test-date" }) };
  } } };
  await assert.rejects(load(env, { creatorId: "test", profileId: "test", versionId: "test" }), /non-reserved public URL/);
  assert.equal(reads, 1);
});

test("adult publication requires the active safe public profile slug", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function loadApprovedAdultProfile("), source.indexOf("async function copyAdultDisplayMedia("));
  const load = new Function("isPublicCreatorSlug", "configuredOrigin", "adultMediaDeliveryConfigured", "validHttpsDestination", "loadLibraryProfileMedia", `return (${stripTypeScriptTypes(body)})`)(isPublicCreatorSlug, () => "https://safe.example", () => true, () => true, async () => []);
  let reads = 0;
  const env = {
    ADULT_PROFILES: {},
    DB: { prepare() {
      reads++;
      return { bind() { return this; }, first: async () => ({ slug: "creator", safe_profile_slug: "messages", profile_status: "active", version_status: "approved", approved_by: "test-admin", approved_at: "test-date" }) };
    } },
  };
  await assert.rejects(load(env, { creatorId: "test", profileId: "test", versionId: "test" }), /active safe public profile/);
  assert.equal(reads, 1);
});

test("adult publication builds its safe link from the active public profile slug", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function loadApprovedAdultProfile("), source.indexOf("async function copyAdultDisplayMedia("));
  const load = new Function("isPublicCreatorSlug", "configuredOrigin", "adultMediaDeliveryConfigured", "validHttpsDestination", "loadLibraryProfileMedia", `return (${stripTypeScriptTypes(body)})`)(isPublicCreatorSlug, () => "https://safe.example", () => true, () => true, async () => []);
  let reads = 0;
  const profile = { slug: "canonical", safe_profile_slug: "thrill-noir", profile_status: "active", version_status: "approved", approved_by: "test-admin", approved_at: "test-date", inherit_sfw_theme: 0 };
  const env = {
    ADULT_PROFILES: {},
    DB: { prepare() {
      reads++;
      return { bind() { return this; }, first: async () => profile, all: async () => ({ results: [] }) };
    } },
  };
  const loaded = await load(env, { creatorId: "test", profileId: "test", versionId: "test" });
  assert.equal(loaded.profile.slug, "canonical");
  assert.equal(loaded.safeProfileUrl, "https://safe.example/thrill-noir");
  assert.equal(reads, 3);
});
