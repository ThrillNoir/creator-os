# Apex game release

`thot-os-public-links-staging` serves both live `thathuboverthere.com` and `www.thathuboverthere.com`. The game is restricted to the apex `GET /`, `HEAD /`, `/assets/game/*`, and `GET`/`POST /api/leaderboard`. Existing `www` creator pages use the same published KV snapshots and are unchanged. Unpublished creator links in the game may return 404 until those profiles are published.

The standalone source is `/home/dandy/Projects/Landing page game`. Build it there with `npm run build`; the built `dist/assets/game/` tree is packaged at `cloudflare/thot-os-public-links/assets/assets/game/` because the Worker's `./assets` directory maps directly to the URL root. The bundled `index.html` has an absolute apex canonical URL. `music-credits.html` travels with the game assets. The local Node preview server and its score file are not deployed.

The leaderboard is one SQLite-backed Durable Object, `GameLeaderboard`, accessed only through the apex API. Each submitted run is replayed on the server using the game's deterministic simulation, writes are capped at 120 attempts per minute globally, and storage retains the top ten. No IP or visitor identifier is stored. A missing service returns an unavailable response; the client labels its local fallback as device-only.

Release through the repository's `publicLinks` artifact, plan, and apply runner. The Worker deployment creates the Durable Object namespace. This is live traffic on both apex and `www`, even though the Worker name ends in `-staging`. Keep the prior Worker deployment receipt for rollback; reverting the Worker does not remove the new namespace or scores. Do not delete that storage during rollback.

Verify after deployment: apex `/` and `/?play=adelaide` return the game and absolute canonical, game PNG/CSS/JS/audio return 200, `GET /api/leaderboard` returns a global board, `www` published profiles still render, and unknown `www` handles still return HTML 404. A caught-run submission is covered by a local Durable Object fixture. Avoid posting a synthetic score to the live public board.
