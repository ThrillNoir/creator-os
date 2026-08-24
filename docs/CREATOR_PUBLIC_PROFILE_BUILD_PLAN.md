# Creator public profile and link-management build plan

**Status:** local implementation in progress and verified as of 2026-08-21. No
deployment, remote D1 migration, production configuration change, secret
creation, route attachment, or creator publication is authorised by this
document.

**Scope:** build a mobile-first safe public profile and a separately gated adult
profile, reusing THOT OS's canonical Cloudflare control plane and its isolated
public-link Worker pattern.

## Current local implementation

- `0040_creator_profile_interactions.sql` adds creator-scoped public-contact,
  stable-link, adult-profile, release-attestation, and protected-media records.
  The migration replay test proves cross-creator writes and adult media without
  a reviewed release/recorded paid-use consent fail closed.
- The existing safe Worker supports both its legacy snapshot and a V2 snapshot
  with strictly validated neutral actions. It does not receive adult/contact
  bindings or data.
- `thot-os-public-contact` is a source-only Worker package that renders one
  Turnstile-protected booking form and returns encoded SMS/mailto intents
  without rendering, logging, or analysing a phone number/email address.
- `thot-os-adult-gateway` is a source-only Worker package that provides the
  age gate, short-lived signed `HttpOnly` session, protected carousel media,
  and controlled redirects. It has no deployment configuration because the
  hostname, binding IDs, secrets, and launch approval have not been supplied.
- The private dashboard has safe-profile contact authoring and stable-link
  revisions, plus a separate `/adult-profile` draft/approval workspace. Adult
  publication remains deliberately unavailable pending the release gate.

## 1. Non-negotiable architecture decisions

1. `cloudflare/thot-os-next` remains the canonical, Access-protected authoring
   application. D1 remains the system of record.
2. The existing `thot-os-public-links` Worker remains SFW-only. Its initial
   response may never contain adult content, adult destinations, contact values,
   private media keys, hidden configuration, or draft data.
3. Public content is released only as immutable, approved KV projections by the
   private publication-control Worker. The public Worker never receives D1,
   private media, Dropbox, provider, or dashboard credentials.
4. Contact and adult interactions use separate public Workers/hostnames with
   purpose-limited bindings. They are not added to the safe public Worker.
5. Dropbox source media and existing private previews are never public output.
   Public/adult profile media are explicit reviewed derivatives.
6. Every creator-owned mutation is authorised from the Access identity and an
   active creator membership; client-supplied creator IDs and roles are never
   authoritative.
7. A self-attestation plus Turnstile reduces automated access; it is not legal
   age verification. Legal, platform-policy, and jurisdictional requirements
   must be approved before an adult launch.

## 2. Target components

| Component | Responsibility | Permitted bindings |
| --- | --- | --- |
| Canonical web/control plane | Creator authoring, draft previews, approval, audit, analytics reporting | D1, private R2, existing internal service binding |
| Public links Worker | `/{slug}` and existing `/go/{slug}/{linkId}` SFW profile/render/redirect | SFW profile KV, Analytics Engine, Static Assets, optionally a dedicated SFW derivative bucket only |
| Public links control Worker | Build approved projections, publish/withdraw through durable Workflows | D1, SFW/adult/contact KV namespaces, purpose-limited derivative-bucket bindings |
| Contact interaction Worker | Booking form, Turnstile validation, SMS/email launch | Contact-capability KV, Analytics Engine, Turnstile secret |
| Adult gateway Worker | Age gate, session validation, protected adult profile, media, and redirects | Adult-profile KV, adult derivative bucket, Analytics Engine, Turnstile and session-signing secrets |

The public profile should use `thathuboverthere.com/{slug}` exclusively. Choose
and document separate exact hostnames for contact and adult flows before any
route is attached. The private dashboard must remain on a wholly separate
Access-protected hostname.

## 3. Data model work

### 3.1 Preserve and extend the existing public-version model

Retain `creator_public_profiles`, `creator_public_profile_versions`,
`creator_public_profile_publications`, and their approval/immutability rules.
Add version-bound child tables rather than modifying approved historical data:

- `creator_public_profile_details`: optional display name, public bio, profile
  image derivative, and banner derivative.
- `creator_public_contact_methods`: `id`, `creator_id`, `profile_version_id`,
  `channel` (`sms` or `email`), encrypted/capability-projected value, enabled
  state, timestamps.
- `creator_public_link_entities`: stable `id`, `creator_id`, surface, lifecycle
  timestamps. This is the permanent redirect identity.
- `creator_public_link_revisions`: link entity, profile version, label, HTTPS
  destination, normalised host, icon key, category, display order, enabled
  state, timestamps.

The existing `creator_public_links` rows are version-scoped and are recreated
on draft save. Migrate them to stable entity/revision records before relying on
permanent redirect URLs.

### 3.2 Add an independent adult-profile model

Create a parallel *domain* using the same immutable-version and publication
rules, not an unscoped collection of links:

- `creator_adult_profiles`
- `creator_adult_profile_versions`
- `creator_adult_link_entities`
- `creator_adult_link_revisions`
- `creator_adult_profile_media`
- `creator_adult_profile_publications`

Adult links are generic. `label`, `url`, `icon_key`, `category`, `sort_order`,
and `enabled` are data; Fansly and OnlyFans are preset labels/icons, not schema
columns or hard-coded allowed platforms.

### 3.3 Add media release safeguards

Create `creator_media_release_attestations` (or an equivalently named existing
domain extension) for public-SFW and adult-profile use. A media derivative can
be selected only when all of the following hold:

1. The asset belongs to the same creator and is still source-available.
2. Its safety classification matches the requested surface.
3. The requested derivative has explicit reviewer approval.
4. Every attached person has recorded consent for the required scope; absent or
   revoked consent blocks selection.
5. The original is copied to a purpose-limited derivative object, with metadata
   stripped and no Dropbox path exposed.

Current asset classification is not enough to infer public adult-media consent.

### 3.4 Constraints and audit

Every new creator table must have a non-null `creator_id`, composite foreign
keys/triggers enforcing same-creator relationships, creator-scoped indexes, and
immutable approved/published versions. Reuse `creatorPrepare`, Access identity,
membership-derived roles, `identity_audit_events`, service-principal grants, and
the existing one-draft/explicit-approval patterns.

No raw contact value, adult destination, private media key, or booking data is
written into analytics or audit `detail` JSON.

## 4. Dashboard implementation

### Public Profile workspace

- Optional display name, SFW bio, profile image, banner, phone, email, and
  generic social/custom links.
- Each blank or disabled field is omitted from preview and release projection.
- Contact is stored only for the interaction capability; it is never a client
  prop or part of the safe profile snapshot.
- Link rows support add, remove, keyboard-accessible reordering, enable/disable,
  icon selection from a fixed safe icon set, and destination validation.

### 18+ Profile workspace

- Optional adult bio, generic external links, and ordered carousel media.
- Media selection shows safety/release state and blocks unapproved candidates.
- Reordering has accessible up/down controls as well as pointer interaction.
- Preview is Access-protected and renders the draft without writing it to public
  KV.

### Approval and publishing

- Creator role: create/edit own drafts and submit for review.
- Operator/agency admin: approve, publish, withdraw, and revoke links/media.
- Viewer: inspect only.
- Approval screen displays the exact render, final destination hosts, selected
  derivatives, consent state, and immutable checksum.

A future platform super-admin role is out of scope: it does not exist in the
current membership model and must not be inferred from agency-admin status.

## 5. Public and interaction routes

| Route | Rule |
| --- | --- |
| `GET /{slug}` | Safe SFW profile only; no adult/contact values in HTML, metadata, structured data, preload, or configuration. |
| `GET /go/{slug}/{linkId}` | Existing path retained; resolve only enabled approved public link entity; ignore every query parameter. |
| `GET /book/{slug}` | Contact Worker renders one booking form with SMS/email choice. |
| `POST /book/{slug}/sms` | Validates booking fields + Turnstile; opens an encoded SMS intent. |
| `POST /book/{slug}/email` | Validates booking fields + Turnstile; opens an encoded `mailto:` intent. |
| `GET /age/{slug}` | Adult Worker renders only the age-confirmation page. |
| `POST /age/{slug}/confirm` | Validates Turnstile and sets short-lived `Secure`, `HttpOnly`, `SameSite=Lax` age-session cookie. |
| `GET /{slug}` on adult hostname | Requires a valid age session before retrieving the adult projection. |
| `GET /media/{slug}/{mediaId}` | Requires an age session and resolves only approved adult derivative media. |
| `GET /r/{slug}/{linkId}` | Requires an age session and resolves only an enabled approved adult link entity. |

The booking form is shared between contact channels. Its output uses the
creator's configured display name and validates/encodes visitor input without
storing it. Test SMS behaviour on iOS Safari and Android Chrome devices before
release; do not assume a server redirect alone is portable across both systems.

## 6. Public projections and media delivery

Publish three separate projections:

1. **Safe profile KV projection:** SFW text, safe media references, generic
   action availability, and public redirect link revisions only.
2. **Contact-capability KV projection:** contact values/capabilities available
   only to the contact Worker after form submission and anti-automation checks.
3. **Adult KV projection:** adult text, carousel metadata, and adult redirect
   entities available only to the adult Worker after age-session verification.

Do not include one projection inside another. The safe Worker must not have a
binding capable of reading the contact or adult projection.

For SFW images, use a dedicated bucket containing only approved SFW derivatives
if the public Worker needs direct delivery. For adult images, use a separate
private derivative bucket bound only to the adult gateway. Do not bind the
existing `MEDIA` or `PREVIEWS` buckets to public-facing Workers. Revisit
Cloudflare Images with signed delivery URLs only if measured performance makes
the extra service worthwhile.

## 7. Validation and security implementation

- Parse every creator URL with `new URL`; allow only HTTPS; reject credentials,
  control characters, local/private hosts, malformed ports, and unsafe schemes.
- Persist the normalised hostname and validate it again when publishing and
  redirecting. The redirect uses a stored entity ID, never a caller-provided
  destination.
- Use strict output escaping and allowlisted icon/media metadata. Treat all
  creator text as untrusted.
- Public Worker: script-free CSP; no inline data/configuration blobs; no
  `form-action` outside self.
- Interaction/adult Workers: narrowly allow Turnstile; use `frame-ancestors
  'none'`, `base-uri 'none'`, `form-action 'self'`, HSTS, `nosniff`, restrictive
  Permissions Policy, and `Referrer-Policy: no-referrer`.
- All booking, gate, and redirect responses use `Cache-Control: no-store` where
  a sensitive URI or session state can be present.
- Validate dashboard mutations server-side with Access identity, creator scope,
  explicit confirmations, and same-origin/CSRF protections.
- Avoid request-body, contact-value, and destination logging. Review Worker
  observability and exception handling for accidental serialization.

## 8. Cloudflare security configuration plan

Before launch, perform a read-only audit of the zone's live settings; these are
not currently represented in repository configuration.

1. Enable Cloudflare Managed WAF rules in log/staged mode, then enforce after
   false-positive review.
2. Rate-limit age confirmation, contact submission, adult media, and adult
   redirects. Calibrate staging thresholds before enforcement.
3. Select the available bot product by plan. Do not enable domain-wide Bot Fight
   Mode blindly because it cannot be tailored per endpoint and may disrupt
   legitimate social previews.
4. Monitor AI Crawl Control first, then block unwanted training/archiving bots
   on contact/adult hosts. Treat `robots.txt` as a crawl preference, not access
   control.
5. Add `noindex, nofollow, noarchive` on interaction/adult routes; update
   `robots.txt` to disallow those paths while retaining the safe public profile.
6. Use Managed Turnstile on age confirmation and booking submission. Validate
   every token at Siteverify on the server and bind validation to the expected
   hostname/action.

References, observed 2026-08-21, high confidence; recheck immediately before
implementation because Cloudflare plan capabilities can change:

- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Bot Fight Mode limitations](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
- [AI Crawl Control](https://developers.cloudflare.com/ai-crawl-control/)
- [Workers Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)

## 9. Analytics plan

Use the existing dedicated Analytics Engine dataset. Every event uses an opaque
creator analytics key, a bounded event name, a surface, and non-sensitive
dimensions only.

Initial events:

- `profile_view`
- `contact_open`
- `sms_booking_started`
- `email_booking_started`
- `age_gate_view`
- `age_gate_completed`
- `adult_profile_view`
- `carousel_previous`, `carousel_next`, `carousel_swipe`
- `link_click`

Derive country, device category, referrer class, and allowlisted bounded UTM
source/medium/campaign values at the edge. Discard raw user-agent, IP,
referrer, contact form values, full UTM payloads, and destinations.

Do not add a persistent visitor ID in the first release. Approximate unique
visitor measurement is a later privacy-policy decision. Create a private daily
rollup process into D1 before Analytics Engine's retention window expires.

## 10. Delivery phases and approval gates

### Phase 0 — baseline and decisions

- Repair the current unrelated creator-portal test expectation.
- Confirm public/adult/contact hostnames, written social-platform compatibility,
  adult-content policy, and consent/release requirements.
- Complete a read-only Cloudflare WAF/Bot/AI Crawl Control/Turnstile audit.

**Exit:** approved domain, policy, consent, role-separation, and production
release decisions. No Cloudflare changes.

### Phase 1 — schema and private authoring

- Add additive D1 schema, constraints, release attestations, stable link IDs,
  audit events, and migration replay tests.
- Implement public/adult draft UI, previews, approval, and withdrawal states.
- Update existing public-link authoring to preserve stable link entity IDs.

**Exit:** all migration/isolation tests pass; no public projection or deployment.

### Phase 2 — safe public profile

- Extend the safe profile snapshot/rendering, SFW media delivery, public redirect
  resolution, headers, and aggregate analytics.
- Prove via tests that safe HTML cannot contain protected data.

**Exit:** synthetic staging-only creator can publish and withdraw an SFW profile
through the existing private control Worker.

### Phase 3 — contact booking

- Build the isolated contact Worker, one shared booking form, Turnstile,
  redaction, and SMS/email encoding.
- Conduct iOS/Android manual device verification.

**Exit:** booking starts work without raw contact values appearing in profile
HTML, logs, or analytics.

### Phase 4 — adult gateway and carousel

- Build adult publication projections, age-session validation, Turnstile,
  session-checked controlled redirects, protected media, and accessible carousel.
- Verify revocation and withdrawal immediately block content and destinations.

**Exit:** no protected data is obtainable before deliberate interaction and a
successful server-side gate check.

### Phase 5 — analytics and security hardening

- Add events, reports, daily rollups, WAF/rate-limit/Bot/AI Crawl Control rules,
  managed robots directives, and operational monitoring.
- Run abuse, load, accessibility, and privacy test suites against staging.

**Exit:** security controls are measured and approved; false-positive runbook
and incident/withdrawal procedures exist.

### Phase 6 — controlled production release

- Follow the existing separate production migration, deployment, Access, secret,
  domain, smoke-test, and receipt process.
- Recheck every Worker binding inventory and zone control immediately before
  attachment.
- Publish one explicitly approved creator/version only after all evidence is
  recorded.

**Exit:** verified release receipt and rollback reference. No automatic bulk
creator rollout.

## 11. Required verification

- D1 replay, foreign-key, trigger, immutability, audit, and cross-creator tests.
- Snapshot tests proving safe HTML contains no adult/contact/private content.
- Contact encoding, special-character, empty-field, response-cache, and
  redaction tests.
- Age-gate tests for no/invalid/expired session, failed/replayed Turnstile,
  successful confirmation, and withdrawal/revocation.
- Redirect tests for disabled/deleted links, cross-creator IDs, malformed IDs,
  changed destinations, and open-redirect query attempts.
- Media tests for unapproved assets, absent/revoked consent, cross-creator keys,
  no shared protected cache, and carousel accessibility.
- Staging WAF/rate-limit/Bot tests that confirm normal safe-profile access and
  social preview compatibility.
- Dashboard role, preview, CSRF, secret-redaction, and analytics privacy tests.

## 12. Explicitly out of scope until later approval

- Production D1 migrations or data imports.
- Production Worker deployment, custom-domain attachment, DNS changes, secrets,
  Turnstile site creation, WAF/rate-limit activation, or Cloudflare Images.
- Publishing a real creator or copying Dropbox source media.
- A platform super-admin or cross-agency administration model.
- Claims that the proposed age gate satisfies a particular legal age-verification
  regime.
