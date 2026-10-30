import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/handler.ts";

function gameEnv() {
  const paths = [];
  const calls = [];
  const env = {
    LIVE_PUBLIC_CREATOR_SLUGS: "adelaide",
    ASSETS: { fetch: async (request) => {
      paths.push(new URL(request.url).pathname);
      return new Response("<!doctype html><title>OVER THERE</title>", { headers: { "content-type": "text/html" } });
    } },
    GAME_LEADERBOARD: { getByName: (name) => {
      assert.equal(name, "over-there-global-v1");
      return {
        getEntries: async () => ({ scope: "global", entries: [] }),
        submit: async (value) => { calls.push(value); return { ok: true, scope: "global", entry: { name: "Fixture" }, entries: [] }; },
      };
    } },
  };
  return { env, paths, calls };
}

test("apex game and its assets load without changing the www profile boundary", async () => {
  const { env, paths } = gameEnv();
  const root = await worker.fetch(new Request("https://thathuboverthere.com/?play=adelaide"), env);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /OVER THERE/);
  assert.match(root.headers.get("content-security-policy"), /script-src 'self'/);
  assert.deepEqual(paths, ["/assets/game/index.html"]);
  const head = await worker.fetch(new Request("https://thathuboverthere.com/", { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await worker.fetch(new Request("https://thathuboverthere.com/assets/game/src/main.js"), env)).status, 200);
  for (const method of ["GET", "HEAD"]) {
    const www = await worker.fetch(new Request("https://www.thathuboverthere.com/?play=adelaide&source=a%20b", { method }), env);
    assert.equal(www.status, 301);
    assert.equal(www.headers.get("location"), "https://thathuboverthere.com/?play=adelaide&source=a%20b");
    assert.equal(await www.text(), "");
  }
  const wwwRoot = await worker.fetch(new Request("https://www.thathuboverthere.com/"), env);
  assert.equal(wwwRoot.status, 301);
  assert.equal(wwwRoot.headers.get("location"), "https://thathuboverthere.com/");
  assert.equal((await worker.fetch(new Request("https://thathuboverthere.com/private"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/api/leaderboard"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/media/adelaide/version/avatar"), env)).status, 404);
});

test("leaderboard routes accept bounded JSON on apex only", async () => {
  const { env, calls } = gameEnv();
  const get = await worker.fetch(new Request("https://thathuboverthere.com/api/leaderboard"), env);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { scope: "global", entries: [] });
  const post = await worker.fetch(new Request("https://thathuboverthere.com/api/leaderboard", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Fixture", handle: "adelaide", moves: [] }),
  }), env);
  assert.equal(post.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "Fixture");
  assert.equal((await worker.fetch(new Request("https://thathuboverthere.com/api/leaderboard", {
    method: "POST", headers: { "content-type": "text/plain" }, body: "x",
  }), env)).status, 415);
  assert.equal((await worker.fetch(new Request("https://thathuboverthere.com/api/leaderboard", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{" + "x".repeat(262_144),
  }), env)).status, 400);
  assert.equal(calls.length, 1);
});
