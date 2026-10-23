import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { normalizeSocialHandle } from "../src/lib/social-profile-handles.ts";

test("creator social usernames normalize without treating a URL as an account", () => {
  assert.equal(normalizeSocialHandle("instagram", " @Adelaide.Main "), "adelaide.main");
  assert.equal(normalizeSocialHandle("tiktok", "@Adelaide_Clips"), "adelaide_clips");
  assert.equal(normalizeSocialHandle("reddit", "u/Adelaide_AMA"), "adelaide_ama");
  assert.throws(() => normalizeSocialHandle("instagram", "https://instagram.com/adelaide"), /username/);
  assert.throws(() => normalizeSocialHandle("reddit", "a name with spaces"), /username/);
});

test("several profiles per platform remain separate and inactive across creators", async () => {
  const source = await readFile(new URL("../src/app/onboarding/actions.ts", import.meta.url), "utf8");
  const insert = source.match(/DB\.prepare\(`(INSERT INTO operational_accounts[\s\S]*?)`\)\.bind\(id, creatorId, platform/)?.[1];
  assert.ok(insert);
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE operational_accounts (id TEXT PRIMARY KEY,creator_id TEXT,platform TEXT,label TEXT,handle TEXT,connection_status TEXT,publishing_mode TEXT,publishing_authority TEXT,account_kind TEXT,login_email TEXT,profile_url TEXT,account_purpose TEXT,is_active INTEGER,connection_method TEXT,creator_visible INTEGER,administrator_notes TEXT,capabilities_json TEXT,private_upload_destination TEXT,UNIQUE(creator_id,platform,label))`);
    const save = (id, creatorId, platform, rawHandle) => {
      const handle = normalizeSocialHandle(platform, rawHandle);
      db.prepare(insert).run(id, creatorId, platform, handle, handle, "social", "", "", "Main", 0, "not_configured", 1, "", "[]", "");
    };
    save("a-main", "amber", "instagram", "@Amber.Main");
    save("a-backup", "amber", "instagram", "@Amber.Backup");
    save("a-reddit", "amber", "reddit", "u/AmberAMA");
    save("b-main", "birch", "instagram", "@Amber.Main");
    assert.deepEqual(db.prepare("SELECT platform,handle FROM operational_accounts WHERE creator_id='amber' ORDER BY platform,handle").all(), [
      { platform: "instagram", handle: "amber.backup" },
      { platform: "instagram", handle: "amber.main" },
      { platform: "reddit", handle: "amberama" },
    ]);
    assert.equal(db.prepare("SELECT COUNT(*) FROM operational_accounts WHERE is_active=1 OR publishing_authority='confirmed' OR connection_status='connected'").pluck().get(), 0);
    db.prepare("UPDATE operational_accounts SET handle='@Amber.Main' WHERE id='a-main'").run();
    db.prepare("UPDATE operational_accounts SET handle='u/AmberAMA' WHERE id='a-reddit'").run();
    const findExisting = db.prepare("SELECT id FROM operational_accounts WHERE creator_id=? AND platform=? AND lower(CASE WHEN platform='reddit' AND lower(substr(handle,1,2))='u/' THEN substr(handle,3) ELSE ltrim(handle,'@') END)=? LIMIT 1");
    assert.equal(findExisting.get("amber", "instagram", "amber.main").id, "a-main");
    assert.equal(findExisting.get("amber", "reddit", "amberama").id, "a-reddit");
    assert.equal(findExisting.get("coral", "instagram", "amber.main"), undefined);
  } finally { db.close(); }
});

test("a connected profile cannot be relabelled as another provider identity", async () => {
  const source = await readFile(new URL("../src/app/onboarding/actions.ts", import.meta.url), "utf8");
  const edit = source.slice(source.indexOf("export async function saveCreatorAccountLoginMethodAction"));
  assert.match(edit, /account\.connection_status === "connected"[\s\S]*normalizeSocialHandle\(platform, account\.handle\) !== normalizeSocialHandle\(platform, username\)/);
  assert.equal(normalizeSocialHandle("instagram", "@Amber.Main"), normalizeSocialHandle("instagram", "amber.main"));
  assert.notEqual(normalizeSocialHandle("instagram", "@Amber.Main"), normalizeSocialHandle("instagram", "@Amber.Backup"));
});
