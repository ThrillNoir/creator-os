import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const actions = read("src/app/actions.ts");
const targetFields = read("src/components/reddit-flair-field.tsx");
const worker = read("../reddit-scheduler/src/index.ts");

test("Reddit Create exposes explicit profile and subreddit targets", () => {
  assert.match(targetFields, /name="targetType" value="profile"/);
  assert.match(targetFields, /name="targetType" value="subreddit"/);
  assert.match(actions, /targetTypeValue === "profile" \|\| targetTypeValue === "subreddit"/);
  assert.match(actions, /targetType === "profile" && \(communityId !== null \|\| flairId\)/);
});

test("profile posts bind the selected account and preserve the nullable target contract", () => {
  assert.match(actions, /external_identity_confirmed_at/);
  assert.match(actions, /targetType === "profile" && \(!account\.handle \|\| !account\.external_identity_confirmed_at\)/);
  assert.match(actions, /community\?\.id \?\? null/);
  assert.match(actions, /\[creatorId, account\.id, asset\.id, targetType, community\?\.id \?\? "profile"/);
});

test("the Worker derives profile submit and receipt targets from authenticated identity", () => {
  assert.match(worker, /redditProfileCommunityName\(identity\.name\)/);
  assert.match(worker, /sr: destinationCommunity/);
  assert.match(worker, /expectedProfileUsername: profileTarget \? identity\.name : null/);
  assert.match(worker, /accountId: post\.account_id/);
  assert.match(worker, /!profileTarget && post\.flair_required/);
  assert.match(worker, /!profileTarget && post\.content_rating === "nsfw"/);
  assert.match(worker, /LEFT JOIN reddit_communities/);
});

test("legacy NULL-community rows require explicit persisted profile evidence", () => {
  const profileGuard = worker.match(/\(p\.community_id IS NOT NULL OR EXISTS \(\s*SELECT 1 FROM social_post_events profile_event\s+WHERE profile_event\.post_id=p\.id AND profile_event\.creator_id=p\.creator_id\s+AND json_extract\(profile_event\.detail,'\$\.targetType'\)='profile'\s*\)\)/s)?.[0];
  assert.ok(profileGuard, "Worker queries must guard NULL-community rows with a profile target event");
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE social_posts (id TEXT, creator_id TEXT, community_id INTEGER); CREATE TABLE social_post_events (post_id TEXT, creator_id TEXT, detail TEXT);");
    db.prepare("INSERT INTO social_posts (id,creator_id,community_id) VALUES (?,?,?)").run("legacy", "creator", null);
    db.prepare("INSERT INTO social_posts (id,creator_id,community_id) VALUES (?,?,?)").run("profile", "creator", null);
    db.prepare("INSERT INTO social_posts (id,creator_id,community_id) VALUES (?,?,?)").run("subreddit", "creator", 42);
    db.prepare("INSERT INTO social_post_events (post_id,creator_id,detail) VALUES (?,?,?)").run("profile", "creator", JSON.stringify({ targetType: "profile" }));
    const rows = db.prepare(`SELECT p.id FROM social_posts p WHERE ${profileGuard} ORDER BY p.id`).all();
    assert.deepEqual(rows.map(({ id }) => id), ["profile", "subreddit"]);
  } finally {
    db.close();
  }
});
