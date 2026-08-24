import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the canonical app owns the approved Tailwind v4 BoldKit theme", async () => {
  const [configSource, theme] = await Promise.all([
    source("../components.json"),
    source("../src/app/boldkit-theme.css"),
  ]);
  const config = JSON.parse(configSource);

  assert.equal(config.style, "new-york");
  assert.equal(config.tailwind.css, "src/app/globals.css");
  assert.equal(config.registries["@boldkit"], "https://boldkit.dev/r/{name}.json");
  assert.match(theme, /--primary: hsl\(344 100% 82%\)/);
  assert.match(theme, /--secondary: hsl\(154 56% 78%\)/);
  assert.match(theme, /--accent: hsl\(260 53% 80%\)/);
  assert.match(theme, /--radius-lg: 0px/);
  assert.match(theme, /html\.dark/);
});

test("the BoldKit shell stays visual while creator profile geometry stays data-driven", async () => {
  const [shell, navigation, cloudCss] = await Promise.all([
    source("../src/components/app-shell.tsx"),
    source("../src/components/app-navigation.tsx"),
    source("../src/app/boldkit-cloud.css"),
  ]);

  assert.match(shell, /requireCreatorContext\("view", creatorId\)/);
  assert.match(shell, /switchCreatorAction/);
  assert.match(navigation, /SheetContent/);
  assert.match(navigation, /ThemeToggle/);
  assert.match(cloudCss, /\.os-cloud-shell \* \{ border-radius: 0 !important; \}/);
  assert.match(cloudCss, /\.profile-preview-button \{ border-radius: var\(--profile-radius\) !important; \}/);
  assert.doesNotMatch(cloudCss, /^\s*\*\s*\{\s*border-radius:\s*0\s*!important/m);
});
