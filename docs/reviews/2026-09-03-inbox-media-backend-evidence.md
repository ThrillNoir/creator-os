# Inbox media backend evidence — 2026-09-03

Scope: isolated `codex/inbox-media` branch. This is source and local-contract evidence only; no provider credentials, live sends, uploads, or remote mutations were used.

## Verified boundary

- Instagram photo/video replies use Meta’s documented Send API shape: `recipient.id` plus `message.attachment.type` (`image` or `video`) and `message.attachment.payload.url`. References: [Meta Send API collection](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api), [Meta media request](https://www.postman.com/meta/instagram/request/23987686-8365d531-b49f-4e07-8e76-19f8608947a3).
- The URL is a short-lived signature for the creator-owned, verified canonical R2 object. The web action and scheduler both re-check creator ownership, Instagram destination, SFW classification, canonical authority, SHA-256, byte count, MIME, R2 version/ETag, and object identity. No arbitrary client URL is accepted.
- Composio’s v3.1 proxy accepts a JSON `body` object and returns upstream `data`/`status`; the provider error path preserves numeric HTTP status, code, and subcode without persisting raw response data. Reference: [Composio proxy request](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy).
- Local outbound caps are deliberately conservative implementation limits (8 MiB image, 25 MiB MP4 video). They are not asserted here as Meta-published limits and should be rechecked against the selected account/API version before rollout.

## Explicit capability ceiling

- Telegram media remains unsupported in this change. The repository has only the text tool and its migration records a durable handoff ledger without enabled Telegram media transport; no broken media control should be exposed.
- Fansly remains native-extension-only. No private endpoint or guessed upload contract was added.
- A media-only reply is one explicit provider send. Text plus media is rejected, so the system cannot silently split one user intent into two sends. Upload/select alone never sends.

## Local checks

`node --test cloudflare/thot-os-next/tests/instagram-reply-media.test.mjs` — 2 passing source-contract checks. These checks cover SQL field/index intent, creator/destination/safety gates, MIME/size allowlist, immutable R2 checks, Meta attachment shape, structured proxy errors, private attachment retrieval, and unsupported-provider visibility. They do not prove a live provider acceptance.

The branch environment did not have the workspace TypeScript/Wrangler binaries installed, so `npm run lint` and scheduler `npm run check` could not start (`tsc`/`wrangler` not found). No dependency was added.
