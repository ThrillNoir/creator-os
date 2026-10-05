import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(mode) {
  const exports = {};
  const calls = [];
  let ready = false;
  new Function("require", "exports", "process", compiled)(
    (name) => {
      assert.equal(name, "@opennextjs/cloudflare");
      return { async initOpenNextCloudflareForDev(options) {
        calls.push(options);
        await Promise.resolve();
        ready = true;
      } };
    },
    exports,
    { env: { NODE_ENV: mode }, cwd: () => "/synthetic/canonical-app" },
  );
  return { configure: exports.default, state: () => ({ calls, ready }) };
}

test("development waits for local bindings and explicitly disables remote resource proxies", async () => {
  const { configure, state } = fixture("development");
  const config = await configure();
  assert.equal(config.poweredByHeader, false);
  assert.deepEqual(state(), { calls: [{ remoteBindings: false }], ready: true });
});

test("production configuration never initializes development bindings", async () => {
  const { configure, state } = fixture("production");
  await configure();
  assert.deepEqual(state(), { calls: [], ready: false });
});
