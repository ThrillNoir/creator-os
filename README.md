# THOT OS

Local-first, human-approved content operations for a small creator agency.

## Run it

```bash
npm install
npm run index:library
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The standard development and production commands bind to `127.0.0.1` only. Do not expose Creator OS directly to the LAN or internet; use an authenticated private tunnel when remote access is added.

## Current prototype

- Responsive operations dashboard
- Isolated, switchable dashboards for Thrill Noir, Adelaide, and future managed creators
- Creator setup and public destination-account forms with no password storage
- SQLite-backed platform accounts, indexed assets, post packages, approvals, and agent-task schema
- Real read-only Dropbox content library with search and previews
- Manual content preparation and durable human approval workflow
- Post Builder v2 with multi-image carousels and multiple platform variants
- Reusable people, consent, tagging preferences, and per-platform social handles
- Versioned Thrill Noir voice settings and approved caption examples
- Source-backed research inbox with confidence and recheck dates
- Grounded caption briefs combining creator notes, approved voice, people/tags, and current research
- Approval-gated Codex or Claude caption tasks with durable status and output records
- Caption checks that block empty, over-limit, or unapproved-tag copy before approval
- Scheduling timeline, rescheduling audit events, and human-confirmed publication
- Per-creator operational reporting for preparation, approvals, publication, and library use
- Secure, creator-scoped API connection control with the Instagram/Meta OAuth foundation
- Google/YouTube OAuth with encrypted refresh tokens and verified channel identity
- Separately approved, idempotent API publishing jobs with execution locked until provider testing
- Optional XQuik adapter for verified X accounts: local scheduling, separate final approval, account-health checks, validation mode, and durable publication receipts
- Manual bounded CSV analytics/revenue imports feeding creator-scoped reporting
- Currency-safe OnlyFans and Fansly earnings summaries with configurable agency splits and exact-import deduplication
- Creator-scoped OnlyFans and Fansly local bridge for visible message collection, approval-gated replies, and audited delivery
- Approval-gated vault staging with retry and explicit native-platform verification states
- Non-destructive source availability tracking so removed Dropbox files retain history without appearing as selectable media
- Read-only Instagram API analytics sync with post-level reach, engagement and media timestamps
- Explainable best-time recommendations surfaced in analytics and the publishing schedule
- One-click recommended scheduling with four-hour Instagram spacing safeguards
- Explicit package-to-live-post matching and milestone outcome snapshots
- Private, creator-scoped Telegram pairing and approval-gated original-media mobile handoff
- Approval-gated creator reminder drafts and a unified operations activity timeline
- Mobile destination-account confirmation before opening or sharing to a platform
- Five-step creator onboarding readiness for new managed creators
- Rule-aware Reddit operations with community eligibility, cooldowns, target approvals and assisted composer handoff
- Reddit OAuth identity/submit foundation gated on Reddit app approval
- Versioned database migrations, integrity/isolation checks, and rotating local backups
- Live account dashboard for all seven Thrill Noir destinations
- Typed domain model in `src/lib/domain.ts`
- Thrill Noir pilot account registry in `src/lib/pilot-config.ts`
- Read-only Dropbox library indexer in `scripts/index-library.mjs`
- Creator voice and caption rules in `docs/CAPTION-PRINCIPLES.md`
- Approval-gated Codex and Claude control-plane design in `docs/AGENT-CONTROL.md`
- Architecture and staged delivery plan in `docs/ARCHITECTURE.md`
- API connection security and staged rollout in `docs/API-CONNECTIONS.md`

Seven Thrill Noir account destinations are stored locally from user-supplied URLs. Instagram, Dropbox, Reddit, YouTube and Telegram identities are connected through creator-scoped service records; capabilities remain separately locked and human-approved. OnlyFans and Fansly use a local, profile-bound Chrome bridge rather than credentials or browser sessions stored in Creator OS. Cloudflare resources, payment systems and autonomous engagement are not connected.

The bridge is an assisted workflow, not an official platform API. Open Creator OS inside the intended creator's dedicated Chrome profile before using an OnlyFans or Fansly button; the button continues in that same profile and never launches a guest session. Reload the unpacked extension after bridge code changes, and verify staged vault uploads in the native platform before marking them complete. Creator OS does not treat a file-picker action as proof that a platform accepted or stored the media.

## Verify and back up

```bash
npm run verify
npm run db:backup
```

## Next integration slice

Validate the current Fansly vault flow with a fresh asset and verify OnlyFans/Fansly reply receipts in each creator profile. Then add a bridge health panel, manual retry controls for failed conversation collection, and source-backed platform-specific earnings definitions before expanding the unified inbox to Telegram, Instagram, Reddit, and Signal.

For Meta or Google setup, open `/connections` and follow `docs/API-CONNECTIONS.md`. Connection does not authorize automatic publishing; the first API publication remains a separately approved private or validation-only test.
