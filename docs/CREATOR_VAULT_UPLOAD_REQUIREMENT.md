# Creator vault upload requirement

Ben's product requirement, recorded 2026-10-18: a signed-in **creator-role** user must be able to initiate and complete uploads to **their own creator vault** without signing in as an agency administrator. The workflow must not expose another creator's account, assets, upload jobs, receipts, or browser pairing.

Acceptance criteria for a later feature change:

- Derive creator scope from the authenticated creator membership, never from a client-supplied creator ID or a workspace-selector cookie. Resolve the target Fansly account and its assigned bridge profile inside that scope.
- A creator can choose eligible content from their own library, initiate one own-vault upload, and see its status and receipt under their creator login. Keep the existing paid-destination, source availability, and recorded multi-creator consent checks and audit trail.
- Reject attempts to select another creator's asset, account, job, profile, or receipt. Test this with two creator fixtures, including direct action requests that bypass the UI.
- Keep agency-wide identity management, pairing, credential revocation, and other elevated powers separate from this creator upload permission.

Current code does **not** meet this requirement: `roleCan("creator", "approve")` is false, and `createFanslyVaultJobsAction` requires `approve`; the Operations form is also hidden without that permission. The isolated 1.1.3 vault-test extension candidate changes only local bridge mode behavior and does not broaden server authorization. This requirement is not approval to change live roles, credentials, or the current Adelaide pairing.
