import assert from "node:assert/strict";
import test from "node:test";
import { PROFILE_BUTTON_STYLES, PROFILE_THEMES, appearanceForTheme, parseProfileAppearance } from "../src/lib/profile-appearance-contract.ts";

test("the profile editor exposes exactly ten bounded themes and five button layouts", () => {
  assert.equal(PROFILE_THEMES.length, 10);
  assert.equal(PROFILE_BUTTON_STYLES.length, 5);
  assert.equal(new Set(PROFILE_THEMES.map((theme) => theme.themeKey)).size, 10);
});

test("appearance accepts only the fixed design contract and keeps adult inheritance explicit", () => {
  const theme = appearanceForTheme("ocean");
  assert.equal(parseProfileAppearance({ themeKey: "ocean" }).themeKey, "ocean");
  assert.throws(() => parseProfileAppearance({ themeKey: "ocean", buttonStyle: "arbitrary-class" }), /not supported/);
  assert.throws(() => parseProfileAppearance({ themeKey: "ocean", backgroundColor: "url(https://example.com)" }), /six-digit hex/);
  assert.equal(parseProfileAppearance({ ...theme, inheritSfwTheme: true }).inheritSfwTheme, false);
  assert.equal(parseProfileAppearance({ ...theme, inheritSfwTheme: true }, { adult: true }).inheritSfwTheme, true);
});
