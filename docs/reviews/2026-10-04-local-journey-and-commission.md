# Local journey and commission checkpoint — 2026-10-04

This follows the [first local readiness milestone](2026-10-04-local-launch-readiness.md). Changes are local only. No production/staging deployment, remote migration, credentials/access grants, private media upload, financial transfer or invoice was performed.

## Observable acceptance

- Real synthetic local photo: intent and part accepted; finalize and replay return `finalized`; catalogue entry persists; classification saves SFW/notes with audit history and survives browser reload; retry reaches a private JPEG preview served by the authenticated preview route with HTTP 200.
- Preview retry remains reachable from the asset review page after the temporary upload row is gone. Viewers see no mutation control, and recovery lookup requires the current creator's verified canonical original, matching revision/key and finalized session.
- The real local R2/Images regression runs with no remote bindings, outbound providers disabled and disposable generated PNG bytes. It decodes the resulting JPEG and proves original bytes unchanged and conditional ETag rejection.
- The SQLite handler journey invokes actual image/video intents, part handlers, finalizers and catalogue queries. It simulates lost D1 persistence after successful R2 completion, then proves reconciliation/replay and cross-creator denial. Images use a valid generated 64×64 PNG; MP4 bytes exercise bounded container/metadata validation rather than a full codec decoder.
- Local onboarding invokes the actual admin action, invitation page, claim action and identity-context functions. Creator/operator/viewer and foreign-workspace behavior is covered. Access identity and email delivery are mocked; external OTP policy and delivery remain release dependencies.

## Native preview defect and recovery

The local binding diagnostic reproduced `Body has already been used` when checking for the R2 body before invoking `arrayBuffer()`. The same conditional R2 read without that property check succeeded. The preview reader now obtains and consumes the body stream once, preserving the ETag precondition, creator-scoped private derivative key and private cache metadata. The original is not modified.

## Commission scope and unresolved decisions

Ben proposed 50% of earnings THOT OS generates through sales on creators' paid sites, adjustable per creator. The 50% figure is an unsaved form default for an unset creator; existing saved percentages and overrides are preserved. New proposals record immutable version IDs and effective dates in the existing finance audit store. They do not replace old agreement settings or rewrite earlier proposal events.

The proposal records THOT-generated paid-site sales scope. Eligible-sale evidence, gross/net treatment after third-party fees/refunds and cadence remain unresolved. Current THOT OS software/subscription fees are zero; future software fees are undecided. This does not assert that OnlyFans or Fansly deductions are zero. No commission is automatically applied to all imported, historical or organic earnings, and allocations/amounts due remain unavailable until the scope/base can be agreed and supported.

Agency administrators can record manual reported-payment evidence with date, exact decimal amount, currency, reference and server-derived actor/creator. The bounded history is human-reported audit evidence, not bank verification, settlement balancing or an issued invoice. Identical retries are idempotent; conflicting or cross-creator request IDs are denied.

## Separate OnlyFans bridge artifact

Read-only source discovery found `/Users/thotos/thotos/creatoros-onlyfans-batch-vault-delivery/public/local-bridge-extension/manifest.json`, Manifest V3 version 0.24.2, branch `codex/onlyfans-batch-vault-delivery`, commit `6a7bebe8653c2472b642446a461e3e5c40548521` (2026-08-26). The manifest targets OnlyFans chats and pairing on OnlyFans/Fansly, with OnlyFans/Fansly/Reddit/staging Vault/local development hosts. The source declares `onlyfans-upload-v4` and contains supervised human-send and automatic batch code capped at five messages per run with a nine-second delay.

No matching packaged extension was found in the scanned Chrome Default installed-extension manifests, and no ZIP/CRX package was found in the project search. Unpacked extension loaded state and deployed Worker version remain unknown. Preferences, Local State, authentication and session files were not inspected. The current canonical THOT OS extension remains a separate Fansly-only v1.1.0 artifact. No old authentication/session capture was restored.

## Verification commands

Focused local journey checks:

```sh
cd cloudflare/thot-os-next
node --experimental-strip-types --test tests/local-onboarding-journey.test.mjs tests/local-media-journey.test.mjs tests/native-preview-reload-recovery.test.mjs tests/native-preview-stream.test.mjs tests/native-preview-local-binding.test.mjs tests/commission-payment-evidence.test.mjs tests/commission-terms-version.test.mjs
```

The Miniflare case needs local loopback permission; it does not use external provider credentials. Required integration checks remain `npm run lint`, `npm test`, `npm run build`, `npm run verify:cloudflare`, the frozen production baseline check and diff checks. Final combined verification passed 111 root tests, 306 canonical app tests and 59 Worker tests (476 total), lint, Next production build, all Worker compilation, OpenNext build, all ten staging static preflights, the frozen production baseline check and diff checks. The actual local R2/Images test is included in the passing app suite. The incremental bundle is reconciled with preimage/postimage hashes and backed-up originals; the task workspace retains `journey-reconciliation-receipt.json`, `journey-change-manifest.json` and `journey-improvements.patch`. External policy/deployment/provider state remains unverified.
