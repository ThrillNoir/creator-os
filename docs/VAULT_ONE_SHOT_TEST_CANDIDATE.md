# One-shot private vault test candidate

This local 1.1.3 extension candidate permits one **manual** private Fansly vault upload attempt while message sends and automatic conversation collection remain disabled. It is an offline-tested candidate only. It has not been installed, paired, or used against Fansly. The installed 1.1.2 inspection build and its pairing remain unchanged. The creator-role server/UI requirement is tracked separately in `CREATOR_VAULT_UPLOAD_REQUIREMENT.md`; this candidate does not grant creator-role upload access.

## Scope and preflight for a later approved test

1. Obtain Ben's choice of the exact creator-owned asset and authorization for **one private vault upload**. Check its source, paid destination, and recorded tagging/consent. Do not queue a job until ready to run the test.
2. Inspect the current account assignment, profile, installation ID, bridge mode, and vault queue through approved read-only means. The test profile must explicitly report **Inspection mode**. An older paired profile with no saved mode defaults to **Active bridge**, which can run sends and collection; stop if it shows Active or the mode is unavailable. The target queue must have exactly one claimable approved job, for the chosen asset, and no uncertain prior claim. The extension claims the first approved job, not a selected job ID.
3. Have the authorized operator review the exact candidate package and a rollback copy of the working 1.1.2 package. An extension upgrade must preserve the existing Chrome extension identity and local storage, including its installation ID and pairing. Verify those values after installation; stop if they change or if the mode is not Inspection. Do not create a new profile, reveal a bridge token, or change credentials as a workaround.
4. In the extension popup, arm **one manual vault upload**. The arm expires after ten minutes and can be cancelled from the popup before the attempt. Confirm sends and collection remain disabled. On the native Fansly vault page, click **Attempt one private vault upload** once. Do not click again or retry if the outcome is uncertain.
5. Reconcile the native saved media with the THOT OS job receipt. Confirm that the popup returns to Inspection mode. If the receipt is uncertain, stop and inspect both sides before any further action. The external side effect, if successful, is one new private vault media item; this procedure does not authorize a post or message.

## Local evidence and limits

- `node --experimental-sqlite tests/fansly-bridge-inspection-mode.test.mjs`: six offline cases, including one-shot message gates, one empty attempt, expiry, restart, and claim race.
- `node --experimental-sqlite tests/vault-upload-claim-recovery.test.mjs`: three offline cases, including receipt uncertainty and one-shot reset after a mocked verified receipt.
- `npm run lint` under `cloudflare/thot-os-next` passed. A candidate web build was attempted but this sandbox could not resolve `fonts.googleapis.com`; it did not establish a product build failure. The unchanged release checkout had previously built successfully.
- Independent read-only review found the one-shot gate coherent for sends, collection, and automatic upload. It identified the legacy Active profile behavior above and requested clearer one-shot UI wording, now reflected here and in the extension UI. Browser installation, popup/overlay synchronization, and real native attachment remain unverified.

Rollback is to restore the previously working 1.1.2 extension package and confirm the same extension identity, pairing, and Inspection mode. Stop rather than replay an uncertain job. No live test, extension installation, job creation, deployment, or credential change is part of this candidate.
