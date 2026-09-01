# Key page dependency trees

## /

Entry: `cloudflare/thot-os-next/src/app/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/page.tsx
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/library.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
  - cloudflare/thot-os-next/src/lib/control-plane.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/integration-health.ts

## /library

Entry: `cloudflare/thot-os-next/src/app/library/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/library/page.tsx
  - cloudflare/thot-os-next/src/app/actions.ts
    - cloudflare/thot-os-next/src/lib/audit-identity.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts
    - cloudflare/thot-os-next/src/lib/creator-db.ts
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/library.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/fansly-pairing.ts
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-db.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/lib/internal-service.ts
    - cloudflare/thot-os-next/src/lib/profile-link-input.ts
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/components/asset-card.tsx
    - cloudflare/thot-os-next/src/lib/library.ts (already listed)
    - cloudflare/thot-os-next/src/components/private-stream-player.tsx
  - cloudflare/thot-os-next/src/components/attribute-fields.tsx
    - cloudflare/thot-os-next/src/lib/library.ts (already listed)
  - cloudflare/thot-os-next/src/components/lazy-native-video-uploader.tsx
  - cloudflare/thot-os-next/src/components/native-media-uploader.tsx
  - cloudflare/thot-os-next/src/components/preview-progress.tsx
    - cloudflare/thot-os-next/src/lib/library.ts (already listed)
    - cloudflare/thot-os-next/src/lib/preview-polling.ts
  - cloudflare/thot-os-next/src/components/video-playback-progress.tsx
    - cloudflare/thot-os-next/src/lib/library.ts (already listed)
    - cloudflare/thot-os-next/src/lib/video-playback-polling.ts
      - cloudflare/thot-os-next/src/lib/library.ts (already listed)
  - cloudflare/thot-os-next/src/lib/library.ts (already listed)
  - cloudflare/thot-os-next/src/lib/deployment-metadata.ts
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)

## /accounts

Entry: `cloudflare/thot-os-next/src/app/accounts/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/accounts/page.tsx
  - cloudflare/thot-os-next/src/app/actions.ts
    - cloudflare/thot-os-next/src/lib/audit-identity.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts
    - cloudflare/thot-os-next/src/lib/creator-db.ts
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/library.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/fansly-pairing.ts
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-db.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/lib/internal-service.ts
    - cloudflare/thot-os-next/src/lib/profile-link-input.ts
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)

## /onboarding

Entry: `cloudflare/thot-os-next/src/app/onboarding/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/onboarding/page.tsx
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/app/onboarding/actions.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
    - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/lib/onboarding-interview.ts
  - cloudflare/thot-os-next/src/components/creator-onboarding.tsx
    - cloudflare/thot-os-next/src/app/onboarding/actions.ts (already listed)
    - cloudflare/thot-os-next/src/app/onboarding/secure-login-capture.tsx
    - cloudflare/thot-os-next/src/components/guided-onboarding-interview.tsx
      - cloudflare/thot-os-next/src/lib/onboarding-interview.ts (already listed)

## /access

Entry: `cloudflare/thot-os-next/src/app/access/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/access/page.tsx
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/app/access/access-controls.tsx

## /operations

Entry: `cloudflare/thot-os-next/src/app/operations/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/operations/page.tsx
  - cloudflare/thot-os-next/src/app/actions.ts
    - cloudflare/thot-os-next/src/lib/audit-identity.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts
    - cloudflare/thot-os-next/src/lib/creator-db.ts
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/library.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/fansly-pairing.ts
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-db.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/lib/internal-service.ts
    - cloudflare/thot-os-next/src/lib/profile-link-input.ts
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/library.ts (already listed)
  - cloudflare/thot-os-next/src/lib/operations.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/internal-service.ts (already listed)
    - cloudflare/thot-os-next/src/lib/library.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
  - cloudflare/thot-os-next/src/components/reddit-flair-field.tsx

## /growth

Entry: `cloudflare/thot-os-next/src/app/growth/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/growth/page.tsx
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/growth-insights.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/creator-db.ts
    - cloudflare/thot-os-next/src/lib/growth-metrics.ts
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)

## /launch-readiness

Entry: `cloudflare/thot-os-next/src/app/launch-readiness/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/launch-readiness/page.tsx
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/lib/launch-readiness.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/creator-db.ts
    - cloudflare/thot-os-next/src/lib/growth-insights.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-db.ts (already listed)
      - cloudflare/thot-os-next/src/lib/growth-metrics.ts

## /public-profile

Entry: `cloudflare/thot-os-next/src/app/public-profile/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/public-profile/page.tsx
  - cloudflare/thot-os-next/src/app/actions.ts
    - cloudflare/thot-os-next/src/lib/audit-identity.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts
    - cloudflare/thot-os-next/src/lib/creator-db.ts
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/library.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/fansly-pairing.ts
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-db.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/lib/internal-service.ts
    - cloudflare/thot-os-next/src/lib/profile-link-input.ts
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
  - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/components/public-profile-editor.tsx
    - cloudflare/thot-os-next/src/app/actions.ts (already listed)
    - cloudflare/thot-os-next/src/components/profile-appearance-editor.tsx
      - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts (already listed)
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts (already listed)
  - cloudflare/thot-os-next/src/components/copy-profile-link.tsx
  - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts (already listed)
  - cloudflare/thot-os-next/src/lib/profile-image-processing.ts
  - cloudflare/thot-os-next/src/lib/profile-public-url.ts

## /adult-profile

Entry: `cloudflare/thot-os-next/src/app/adult-profile/page.tsx`

Dependencies:
- cloudflare/thot-os-next/src/app/adult-profile/page.tsx
  - cloudflare/thot-os-next/src/app/actions.ts
    - cloudflare/thot-os-next/src/lib/audit-identity.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts
    - cloudflare/thot-os-next/src/lib/cloudflare.ts
    - cloudflare/thot-os-next/src/lib/creator-db.ts
    - cloudflare/thot-os-next/src/lib/identity.ts
      - cloudflare/thot-os-next/src/lib/access.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/library.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
    - cloudflare/thot-os-next/src/lib/fansly-pairing.ts
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-db.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/lib/internal-service.ts
    - cloudflare/thot-os-next/src/lib/profile-link-input.ts
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts
  - cloudflare/thot-os-next/src/components/app-shell.tsx
    - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
    - cloudflare/thot-os-next/src/app/identity-actions.ts
      - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
      - cloudflare/thot-os-next/src/lib/audit-identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access.ts (already listed)
      - cloudflare/thot-os-next/src/lib/creator-onboarding.ts
      - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
      - cloudflare/thot-os-next/src/lib/access-vault.ts
        - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
        - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
    - cloudflare/thot-os-next/src/components/app-navigation.tsx
      - cloudflare/thot-os-next/src/components/theme-toggle.tsx
        - cloudflare/thot-os-next/src/components/ui/button.tsx
          - cloudflare/thot-os-next/src/lib/utils.ts
      - cloudflare/thot-os-next/src/components/ui/button.tsx (already listed)
      - cloudflare/thot-os-next/src/components/ui/separator.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
      - cloudflare/thot-os-next/src/components/ui/sheet.tsx
        - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
    - cloudflare/thot-os-next/src/components/ui/badge.tsx
      - cloudflare/thot-os-next/src/lib/utils.ts (already listed)
  - cloudflare/thot-os-next/src/lib/authorization.ts (already listed)
  - cloudflare/thot-os-next/src/lib/cloudflare.ts (already listed)
  - cloudflare/thot-os-next/src/lib/identity.ts (already listed)
  - cloudflare/thot-os-next/src/components/profile-appearance-editor.tsx
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts (already listed)
  - cloudflare/thot-os-next/src/components/copy-profile-link.tsx
  - cloudflare/thot-os-next/src/components/adult-profile-editor.tsx
    - cloudflare/thot-os-next/src/app/actions.ts (already listed)
    - cloudflare/thot-os-next/src/components/profile-appearance-editor.tsx (already listed)
    - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts (already listed)
  - cloudflare/thot-os-next/src/lib/profile-appearance-contract.ts (already listed)
  - cloudflare/thot-os-next/src/lib/profile-image-processing.ts
  - cloudflare/thot-os-next/src/lib/profile-public-url.ts
