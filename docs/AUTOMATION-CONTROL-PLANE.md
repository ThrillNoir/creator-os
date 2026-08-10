# Automation control plane

CreatorOS uses creator-scoped, idempotent events to coordinate local work with Cloudflare. Dropbox and other source libraries remain read-only.

## Event lifecycle

`created → dispatching → queued → running → completed`

Failures use `dispatch_failed` when Cloudflare did not acknowledge the request and `failed` after a worker accepted the event. Failed events can be retried with the same idempotency key.

## Current flow

1. A successful library sync creates a local `library.indexed` event.
2. CreatorOS sends metadata-only context to the Cloudflare intake queue.
3. The queue consumer writes a private R2 audit artifact.
4. The consumer emits `asset.intelligence.requested` to the AI queue.
5. The AI consumer calls the private CreatorOS callback to request local processing.
6. Callback status and receipts are written to the creator-scoped local database and shown in `/automation`.

No source media, creator credentials, fan messages, or publishing authority are placed in Cloudflare queue payloads.

## Required configuration

CreatorOS:

- `CLOUDFLARE_STAGING_GATEWAY_URL`
- `CLOUDFLARE_STAGING_GATEWAY_TOKEN`
- `CREATOR_OS_AUTOMATION_CALLBACK_TOKEN`

Cloudflare Worker:

- `STAGING_GATEWAY_TOKEN`
- `CREATOR_OS_CALLBACK_TOKEN`
- `CREATOR_OS_CALLBACK_URL`

The callback URL must be private HTTPS, normally exposed through a protected Cloudflare Tunnel. The callback tokens must match.

## Completion boundary

A queued Cloudflare message proves only that Cloudflare accepted the event. A completed intake receipt proves routing occurred. Asset intelligence is not complete until the local worker returns its own completed receipt. Publishing remains a separate approval-gated workflow and requires destination verification.
