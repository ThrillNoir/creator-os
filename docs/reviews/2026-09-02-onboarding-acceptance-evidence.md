# Onboarding acceptance evidence — 2026-09-02

Scope: local synthetic acceptance only, run from `codex/onboarding-acceptance-closeout` at `1c0e7a4f717a5ae476c9e7f00c036d4b6a735957`. No live membership, invitation email, compliance record, credential, provider send, browser mutation, or secret was created.

## Matrix

| Case | Result | Evidence |
| --- | --- | --- |
| New creator invitation stores only a hash; wrong Access identity is rejected | PASS | `onboarding-acceptance.test.mjs`; production invitation lookup/claim SQL on a real in-memory SQLite database; raw token lookup returns zero rows |
| Correct invited identity becomes creator membership and accepted invitation | PASS | Same test executes production claim inserts/updates and audit SQL; membership is `creator`, audit detail is metadata-only |
| Required onboarding sections block activation until agency review completes them | PASS | Same test executes production section-review and guarded activation SQL; incomplete sections leave `draft`, reviewed sections reach `admin_review` |
| Activation enables only the creator's pending visible account and records activation | PASS | Same test executes production profile/account/compliance activation SQL; foreign creator account remains inactive and authority remains `not_configured` |
| A creator change reopens the affected section/workflow for review | PASS | Same test executes production `changedSection` SQL after activation; `paid_platforms` and the profile return to `draft` |
| Creator/viewer permissions and creator isolation | PASS | Same test plus existing `creator-portal.test.mjs` and `identity-isolation.test.mjs`; viewer mutate and cross-creator scope return 404 |
| Creator credential visibility | PASS | Same test executes production Access listing query; creator sees only own shared credential metadata, administrator sees own active credentials, foreign credential is excluded, ciphertext is not selected |
| PIN verifier visibility is role/email/workspace scoped | PASS | Existing `onboarding-secure-login.test.mjs` executes the production verifier and availability queries against synthetic rows; disallowed roles and foreign workspaces return no verifier |
| Live fresh-person invitation/onboarding and live operator/viewer mutation matrix | PENDING | Requires an authorised new person's Access identity or an existing authorised staging account; not safe to fabricate or perform here |
| Native provider login validity, extension pairing/recovery, and authenticated browser health | PENDING | Requires the authorised provider/extension account and a client that permits the response; no live send or credential reveal is part of this brief |

## Safe staging QA controls for lead

On an already-authorised staging session, `/staging-qa` exposes these bounded controls. They write only an authorization audit probe and never publish, message, upload, retrieve media, or reveal credentials:

1. **Write own-creator audit probe** — expect the response/audit actor to be the server-derived effective creator and role.
2. **Attempt role spoof** — submit the built-in hidden `actor_role=agency_admin`; expect `400 actor_role_is_server_derived` and no audit probe.
3. **Attempt scoped mutation** — request a creator ID outside the signed-in identity's effective membership; expect a not-found denial and no audit probe.

The existing creator-session own probe was accepted in staging at `2026-09-02 12:05:36`; the browser response was blocked by the client, so this is audit evidence rather than a completed browser response check. Do not use the QA page to create memberships, invitations, compliance records, provider connections, or credentials.

## Run

`node --experimental-strip-types --test cloudflare/thot-os-next/tests/onboarding-acceptance.test.mjs` — PASS (1 test).

The full web suite remains separately gated by the existing worktree dependency/tooling issue: this branch links the root `node_modules` to the integration checkout, which has `better-sqlite3` but not the optional Wrangler/Sharp packages used by unrelated migration/media tests. No dependency was added.
