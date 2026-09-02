import assert from "node:assert/strict";
import test from "node:test";
import {
  ONBOARDING_SECTION_KEYS,
  OPTIONAL_ONBOARDING_SECTION_KEYS,
  REQUIRED_ONBOARDING_SECTION_KEYS,
  missingRequiredOnboardingSections,
} from "../src/lib/onboarding-sections.ts";

test("activation requires every required section while Chrome remains optional", () => {
  assert.deepEqual([...ONBOARDING_SECTION_KEYS], [
    "identity", "social_profiles", "paid_platforms", "brand_voice", "positioning", "about_me", "chrome_access",
  ]);
  assert.deepEqual([...OPTIONAL_ONBOARDING_SECTION_KEYS], ["chrome_access"]);
  assert.deepEqual(missingRequiredOnboardingSections([
    { section_key: "identity", status: "complete" },
    { section_key: "social_profiles", status: "complete" },
    { section_key: "paid_platforms", status: "complete" },
    { section_key: "brand_voice", status: "complete" },
    { section_key: "positioning", status: "complete" },
    { section_key: "about_me", status: "complete" },
  ]), []);
  assert.deepEqual(missingRequiredOnboardingSections([
    { section_key: "identity", status: "complete" },
    { section_key: "chrome_access", status: "draft" },
  ]), ["social_profiles", "paid_platforms", "brand_voice", "positioning", "about_me"]);
  assert.equal(REQUIRED_ONBOARDING_SECTION_KEYS.includes("chrome_access"), false);
});
