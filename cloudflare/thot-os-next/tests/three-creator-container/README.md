# Disposable three-creator Portfolio fixtures

## Browser app

Run `bash cloudflare/thot-os-next/tests/three-creator-container/local-app/run.sh start` from the repository root. The three real Next.js local app instances appear at:

- Amber: `http://127.0.0.1:8793/portfolio`
- Birch: `http://127.0.0.1:8794/portfolio`
- Coral: `http://127.0.0.1:8795/portfolio`

Use the same script with `status` to list processes, `stop` to remove the three containers and their local data, or `reset` to remove the containers, network, and image. Each account is a separate synthetic creator identity with a sole `creator` membership. Every container has its own migrated local D1 and local R2 copy seeded with the three invented creators and one generated JPEG per creator. The localhost-only Access bypass selects that container's invented email. An isolated browser can check the actual `/library` and `/portfolio` pages; the app also serves `/api/preview` and `/health`. Browser interaction is a manual check, not an automated step in this script. Publication is disabled because the public More Worker and publication control are not part of this local app.

The build context is allowlisted source, shared modules, config, migrations, and fixture scripts. It contains no host secrets, browser profiles, databases, or media. The copied Wrangler config replaces the account and database IDs with invalid fixture IDs, uses local bucket names, and disables Portfolio publishing. The disposable image substitutes local system font variables for Next's Google Fonts loader so page compilation makes no font-provider request. Runtime containers receive no secrets or host mounts. Their dedicated bridge network has Docker outbound masquerading disabled; only ports 8793–8795 are bound to host loopback. Build-time `npm ci` downloads pinned dependencies. `stop` discards every local edit.

These are three independent local databases, so browser changes on one port do not appear on another. The shared-D1, cross-creator isolation proof is in the one-shot tests below. The browser app does not exercise Cloudflare Access, remote D1/R2, email, Stream, provider calls, or the public More Worker.

## One-shot action and isolation tests

Run `bash cloudflare/thot-os-next/tests/three-creator-container/run.sh start` from anywhere. `stop` stops a running check; `reset` removes its dedicated image. The container is one-shot, has no network or exposed ports at runtime, has a read-only filesystem, and receives no host secrets, browser profiles, databases, or media. Its build context contains only source code, selected tests, and SQL migrations. Build-time npm access downloads pinned test dependencies.

This runs actual onboarding, upload intent/part/finalize, Library, Portfolio authoring and publish action modules against synthetic D1/R2 fixtures for three invented creators. The publication control response and some image transformations are stubbed; a separate Miniflare test exercises a real local R2/Images binding. It does not run a signed-in Next.js browser session, Cloudflare Access, email, Stream, or public More Workers. Passing checks therefore establish local action and isolation behavior, not end-to-end staging availability.
