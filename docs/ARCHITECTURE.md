# Creator OS — technical direction

## Product boundary

Creator OS is an internal operations system. It organises finished media, prepares platform-specific copy, collects human approval, and guides or schedules publishing. It does not edit the media and it does not automate fake engagement.

## Recommended stack

- **App:** Next.js, TypeScript, React, Tailwind CSS.
- **Local development:** files remain on this Mac; the first prototype uses typed demo data.
- **Database:** SQLite for the local pilot, then PostgreSQL when remote access or multiple operators are needed.
- **Media:** watch/import a chosen local export folder. Keep originals outside the database; store paths, checksums, previews, and metadata. Add direct Cloudflare uploads later.
- **Jobs:** a durable background queue for thumbnail creation, metadata extraction, caption generation, reminders, and approved publishing.
- **AI:** separate creator-managing and research agents. The managing agent drafts in the creator's learned voice; the research agent supplies evidence and platform context. All publishing decisions remain approval-gated.
- **Publishing adapters:** one adapter per platform. Prefer official APIs; otherwise generate a handoff package (media, caption, tags, destination, checklist) for the creator to finish on device or desktop.
- **Browser profiles:** Multilogin can be an optional launch target for separate Reddit identities. It should hold browser sessions, not become the source of truth for content or schedules.
- **Secrets:** OS keychain or encrypted environment storage; never store platform passwords in application tables.
- **Analytics:** manual/CSV imports first for OF, Fansly, and MyRoomz; official integrations where available; Stripe webhooks only for custom payments routed through Stripe.

## Core modules

1. **Library** — assets, creator notes, checksums, previews, people, consent, and reusable tags.
2. **Destinations** — platform accounts and their publishing method.
3. **Variants** — caption, title, hashtags, crop guidance, and safety classification per destination.
4. **Approval** — immutable record of who approved the exact asset/copy/destination combination.
5. **Schedule** — planned time, status, retries, and handoff state.
6. **Research** — source-backed findings, subreddit rules, verification date, confidence, and expiry.
7. **Reporting** — published posts, reach, subscriptions, revenue imports, and attributable custom payments.

## Metadata and caption separation

PhotoTag.ai is the current upstream SEO metadata tool. Creator OS reads its filenames and embedded XMP/IPTC/EXIF fields but does not overwrite them during social publishing.

SEO metadata describes and helps catalogue the image. A social caption speaks as the creator. They are different records with different purposes:

- **SEO layer:** filename, title, description, keywords, copyright, and technical metadata.
- **Creator layer:** who is speaking, what happened, how they naturally phrase things, relevant people/tags, audience context, and the intended action.
- **Research layer:** current formats, hooks, conversations, subreddit rules, platform constraints, and supporting sources.
- **Platform layer:** character limits, link behaviour, hashtag conventions, content classification, and account role.

The managing agent may use the SEO description as factual context, but must not simply rewrite it as a caption.

## Organic caption system

Each creator gets a versioned voice profile built from captions they actually wrote or explicitly approved. It records perspective, typical length, vocabulary, humour, punctuation, emoji use, calls to action, phrases to avoid, and examples.

For every draft, the managing agent receives:

1. Creator notes supplied with the upload.
2. The people present and approved social tags.
3. The destination account and platform.
4. A small set of relevant, current research findings with sources.
5. Recent published captions so it avoids repetitive hooks and phrases.
6. The creator voice profile and explicit banned phrases.

The output is one strong draft, not a menu of generic alternatives. Human edits are captured as voice-training feedback only after approval. Research influences subject and timing; it does not override the creator's voice.

Quality checks should flag generic AI language, invented personal experiences, repetitive openings, excessive hashtags, irrelevant trend references, and claims unsupported by creator notes.

## Publishing modes

| Mode | Use |
|---|---|
| Direct API | Supported professional/business accounts after permissions are tested |
| Finish on device | Instagram/TikTok handoff: send the approved media and copy, open the platform, creator completes final choices |
| Desktop assisted | Reddit and paid platforms: open the correct browser profile/destination and copy the approved package |

Deep links cannot reliably pre-fill every field on Instagram or Reddit. The safe baseline is a one-tap handoff page with download/copy/open actions. Platform share extensions can improve the mobile flow later.

## Delivery phases

1. **Built locally:** multi-creator workspaces, Thrill Noir library ingestion, destinations, people/tags, voice, approval, schedule, handoff, research inbox, agent-task control, database recovery, and operational reporting.
2. **Next:** approved caption corpus, first source-backed research set, durable background worker controls, and a mobile-first handoff/PWA.
3. **After account access:** measured official Meta publishing adapter and analytics imports; keep manual handoff for unsupported destinations.
4. **Later:** Cloudflare direct uploads, PostgreSQL for remote/multi-operator use, and revenue imports/Stripe reconciliation.

## Guardrails

- Approval is scoped to an asset version, copy version, account, and scheduled time.
- Record age/identity and release status for every person where required; never infer consent from a social tag.
- Research stores citations and review dates. Reddit rules are treated as changing data, not permanent knowledge.
- Respect platform terms, rate limits, community rules, and account security controls.
- Browser automation must stop for challenges, 2FA, captchas, policy warnings, and unexpected UI.
