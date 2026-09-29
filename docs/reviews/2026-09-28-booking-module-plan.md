# Creator booking-enquiry module — implementation plan

Date: 2026-09-28. Status: planning; no implementation, migration or deployment performed.
Repository inspected at `d8d6a8595ad1dab961a8b7532dea2a9b4f44655b` on `codex/thot-os-canonical`, with pre-existing unrelated changes preserved.
This dated plan records the agreed product scope and proposed engineering work. Root `AGENTS.md`, current code, tests and the deployment registry remain authoritative.

## Goal and agreed scope

Build an optional creator-scoped enquiry module for non-sexual event staffing and entertainment, integrated into the existing public-profile workflow. No sexual-service booking options, disguised equivalents, calendar, availability, payment, automatic booking confirmation, CRM or separate application.

- Creator editor: enable/disable, CTA label, private recipient email and WhatsApp/SMS number, rules, and two editable option groups: **What to wear** and **Extra spice**. Each group supports add, edit and remove; each option has a stable identifier, label and optional plain-text explanation. Visitors select an outfit and any applicable entertainment extras; empty optional groups are omitted.
- Approved explanations appear in expandable **What to expect** sections. Rules must be opened and explicitly acknowledged; record acknowledgement, never claim to prove reading.
- Enquiry fields: first/last name, phone, email, date, time/timezone, full street address, separately entered suburb, guest count, occasion including Other, configured selections and optional special requests. Proposed defaults: all core fields required; extras and special requests optional; validate only selections offered by the published version.
- Server validation, consent, current rules acknowledgement, Turnstile and rate limiting precede one transactional email from THOT OS to the creator's approved recipient.
- After provider acceptance, offer **Continue in WhatsApp** and **Continue by text message**. The visitor reviews and sends the draft from their own device. Draft: name, date/time/timezone, suburb, full-address Maps link, and a reminder to check email. No automatic WhatsApp/SMS sending.
- Full address before acceptance and disclosure through the Maps link are agreed requirements. Personal data is allowed only in the consented email and final device handoff links, never public profile projections, THOT OS page URLs, analytics or logs. Contact numbers become visible in the validated handoff; they cannot remain secret from its recipient.

## Existing foundation and remaining gaps

- `cloudflare/thot-os-public-contact/src/index.ts`: isolated `/book/{slug}`, private contact KV, Turnstile, no-store/no-referrer headers and SMS/mailto drafts. No transactional booking email, rules/version checks, full form, WhatsApp or rate limiter yet.
- `cloudflare/thot-os-public-links-control/src/index.ts`: creator CTA, private contact projection, publication and withdrawal. The published configuration must bind every booking setting to the approved profile version.
- `cloudflare/thot-os-next/src/app/actions.ts`: versioned drafts and approval/publication. Current Publish can approve a saved draft using existing creator-scoped `mutate` authority; do not silently introduce mandatory staff approval or broaden roles.
- `cloudflare/thot-os-next/src/app/identity-actions.ts`: existing THOT OS `EMAIL.send` pattern. Reuse the sending capability; do not route booking emails through invitation actions.
- Public-profile checksum currently excludes contact settings. Bind the new booking configuration and destinations to approval; preserve compatibility of existing published versions.
- Viewer denial must apply before private booking configuration is queried or serialized, including previews and server actions, not just by hiding form controls.
- Contact staging configuration is a deliberately non-runnable template. `config/deployments.json` has no contact-worker release target. Code presence is not live deployment evidence.

## Architecture proposal requiring a decision before affected implementation

Keep D1 unavailable to the public contact Worker. Prefer a narrowly authorized submission operation on the existing private public-links-control service, which already owns publication checks and D1 access. The public contact Worker performs visitor validation and calls that operation through a service binding and the existing service-auth model. The private service independently validates the request, resolves the current creator/version/recipient from authoritative data, rejects withdrawals, atomically claims the submission and sends through an EMAIL binding using the existing approved sender pattern. It returns only an opaque outcome and the minimum validated handoff data. Reuse existing publication authority rather than add a separate booking backend.

This is a proposed new internal capability and binding, not already approved architecture. Review exact caller grants, endpoint contract, additional EMAIL binding, D1 receipt schema, limiter and expiry mechanism before coding that boundary. Do not give the public Worker general D1 access, reuse a publish grant for submission, or accept a visitor-selected recipient. If current service-auth tooling cannot express this narrow operation, return a revised concrete proposal rather than bypass it.

## Work sequence and bounded ownership

1. **Explore — Luna:** resolve remaining data/versioning, role, delivery and staging-target contracts. Read only; return evidence and gaps. Two independent assignments cover configuration/publication and delivery/release respectively. No recursive delegation.
2. **Contract decision — ATLAS:** settle additive D1 shape tied to existing creator/profile versions; private versus public projections; withdrawal enforcement; email execution boundary; rate limiter; duplicate-send state and evidence expiry. Review any new Worker binding or trust boundary before implementation of that boundary. No public visitor-supplied email destination or creator identity is authoritative.
3. **Implement A — Terra:** approved schema/local replay, validators, creator editor/actions and approval-bound configuration. Owned paths: assigned migration, app profile files and their focused tests. No remote changes.
4. **Implement B — Terra:** after A's contract is stable, implement contact rendering, validated submission, email and messaging drafts, publication projection changes and their focused tests. Owned paths: assigned contact/control files. ATLAS alone owns cross-cutting shared contract and release configuration edits; avoid concurrent overlapping writes.
5. **Verify — fresh Luna assignment:** inspect final diff and run focused denial, privacy, versioning and failure-path checks; report findings without repairing. ATLAS integrates fixes and runs required repository checks.
6. **Staging release — ATLAS:** prepare exact artifact, target, bindings, migration range, backup/recovery and rollback plan using existing guards. User has approved staging intent; obtain the required concrete target/plan approval for new infrastructure and remote migration before applying. Never bypass the registry or deploy the placeholder template. Production remains untouched.

Each assignment receives exact paths, exclusions, acceptance checks and a bounded work budget at dispatch. Stop on scope conflict, new trust boundary, missing authority or exhausted budget. No permanent specialist agents or custom orchestrator.

## Proposed delivery/evidence contract

- Keep full enquiry data only for request processing and the creator-directed email; do not persist it in THOT OS or put it in retry queues. Creator mailbox retention is separate from THOT OS retention.
- Proposed minimal evidence: random submission ID, creator/profile/rules version, consent/acknowledgement server time, send state, timestamps and provider receipt ID if supported. No visitor name, email, phone, address, selected options or special requests.
- Proposed expiry: 7 days for minimal evidence and duplicate-submit protection, with enforced cleanup; finalize before implementation. Historical published rules/configuration follow existing version retention. Rate-limit counters need a separate short expiry and no raw-IP logging.
- Claim submission atomically before sending. Repeated requests and switching messaging choices must not send another email. Provider acceptance is not proof of inbox delivery. Timeout/uncertain sends remain uncertain and are not blindly retried; do not promise exactly-once email delivery.
- Reject stale configuration/rules and withdrawn or disabled modules at submission. KV deletion alone must not be treated as proof of immediate global revocation. Decide an authoritative revocation check within existing service boundaries before implementation.
- Return generic public errors without private destinations or payloads. Escape email/HTML content, bound request size and option lengths, validate dates/timezones and constrain recipient routing server-side.

## Completion evidence

Behavioral tests cover cross-creator selectors, viewer denial, recipient tampering, invalid/disabled options, stale rules, missing consent, rejected Turnstile/origin, rate limits, HTML/header injection, duplicate/concurrent submissions, email failure/uncertainty, projection privacy, withdrawn open forms, and both draft channels without automatic sends. Replay additive migrations locally; do not rewrite applied migrations.

After implementation run `npm run lint`, `npm test`, `npm run build`, `npm run verify:cloudflare`, `npm run deployment:preflight -- --environment staging --all`, and `git diff --check`. Use existing Node tests and local fixtures; no new test framework or real customer email during local verification.

Local completion and staging release are separate. After an approved release, use an approved test recipient and synthetic enquiry to verify received email, iPhone/Android handoff behavior where available, role/isolation checks and withdrawal. Record untested devices or delivery failures explicitly, and validate the release receipt through existing tooling.

Rollback withdraws the affected module and restores the prior reviewed artifact/projections as appropriate. Preserve additive migration history; do not undo schema destructively. Already-sent emails and visitor-sent messages cannot be recalled by rolling back THOT OS.
