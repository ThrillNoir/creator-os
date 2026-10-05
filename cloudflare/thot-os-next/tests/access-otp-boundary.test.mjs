import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/access.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "local-test-key" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(overrides = {}) {
  const input = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({ aud: "staging-test-audience", email: "unknown@example.test", exp: 2000000100, ...overrides })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}
function fixture(assertion, { active = false, bypass = undefined, host = "staging.example.test" } = {}) {
  let queries = 0;
  const env = { ACCESS_AUD: "staging-test-audience", ACCESS_JWKS_URL: "https://keys.example.test", LOCAL_ACCESS_BYPASS: bypass, ACCESS_ALLOWED_EMAIL: "local@example.test", DB: { prepare(sql) {
    assert.match(sql, /status='active'/);
    return { bind(email) { assert.equal(email, "unknown@example.test"); return { first() { queries++; return active ? { email } : null; } }; } };
  } } };
  const exports = {};
  new Function("require", "exports", "fetch", "Date", "process", compiled)((name) => {
    if (name === "next/headers") return { headers: async () => new Headers({ host, ...(assertion ? { "cf-access-jwt-assertion": assertion } : {}) }) };
    if (name === "./cloudflare") return { cloudflareEnv: () => env };
    throw new Error(`Unexpected import ${name}`);
  }, exports, async (url) => { assert.equal(url, env.ACCESS_JWKS_URL); return Response.json({ keys: [jwk] }); }, { now: () => 2000000000000 }, { env: {} });
  return { ...exports, queries: () => queries };
}

test("a valid OTP identity alone grants no active THOT OS user access", async () => {
  const signed = await token();
  const unknown = fixture(signed);
  assert.deepEqual(await unknown.verifyAccessIdentity(), { email: "unknown@example.test" });
  await assert.rejects(unknown.requireAccessIdentity(), /not an active THOT OS user/);
  assert.equal(unknown.queries(), 1);
  assert.deepEqual(await fixture(signed, { active: true }).requireAccessIdentity(), { email: "unknown@example.test" });
});

test("invalid Access assertions and remote local-bypass attempts fail before D1", async () => {
  const valid = await token();
  for (const assertion of [undefined, await token({ aud: "other-app" }), await token({ exp: 1999999999 }), await token({ nbf: 2000000200 }), valid.slice(0, valid.lastIndexOf(".") + 1) + "AAAA"]) {
    const app = fixture(assertion, { bypass: "1" });
    await assert.rejects(app.requireAccessIdentity(), /Access/);
    assert.equal(app.queries(), 0);
  }
});
