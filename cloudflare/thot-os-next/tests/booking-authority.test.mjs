import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { authorizeCreatorScope, roleCan } from "../src/lib/authorization.ts";

test("real booking authoring entry actions stop viewer and foreign-workspace requests before any data access", async () => {
  const source = await readFile(new URL("../src/app/actions.ts", import.meta.url), "utf8");
  for (const name of ["savePublicProfileDraftAction", "approvePublicProfileVersionAction", "publishPublicProfileAction"]) {
    const start = source.indexOf(`export async function ${name}(`);
    const next = source.indexOf("\nexport ", start + 1);
    const code = stripTypeScriptTypes(source.slice(start, next < 0 ? undefined : next).replace("export async", "async"));
    for (const [role, requested] of [["viewer", "own"], ["creator", "foreign"], ["operator", "foreign"]]) {
      let calls = 0;
      const guard = async (permission) => {
        calls++;
        const result = authorizeCreatorScope([{ creator_id: "own", creator_name: "Own", creator_initials: "O", role }], permission, requested);
        if (!result.ok) throw new Error("denied");
        throw new Error("unexpectedly allowed");
      };
      const action = new Function("requireCreatorContext", `${code}; return ${name};`)(guard);
      await assert.rejects(action(new FormData(), new FormData()), /^Error: denied$/);
      assert.equal(calls, 1);
    }
  }
});

test("viewer profile page executes no contact or booking-config query", async () => {
  const source = await readFile(new URL("../src/app/public-profile/page.tsx", import.meta.url), "utf8");
  const code = stripTypeScriptTypes(source.slice(source.indexOf("  const canEdit ="), source.indexOf("  const canPublish =")));
  const load = new Function("roleCan", `return async function(context,env) { const creatorId=context.creator.creator_id, DB=env.DB; ${code}; return {contacts,bookingConfigs}; };`)(roleCan);
  const queries = [];
  const env = { DB: { prepare(sql) { queries.push(sql); return { bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; } }; } } };
  const result = await load({ creator: { creator_id: "own", role: "viewer" } }, env);
  assert.equal(queries.some(sql => /creator_public_contact_methods|creator_booking_configs/.test(sql)), false);
  assert.deepEqual(result, { contacts: { results: [] }, bookingConfigs: { results: [] } });
});
