# Extractable components

## AppNavigation
- Source: `cloudflare/thot-os-next/src/components/app-navigation.tsx`
- Category: layout
- Description: Fixed desktop sidebar plus mobile sheet with brand, navigation and creator context.
- Extractable props: active, mode, creatorName, creatorInitials, email, roleLabel, items.
- Hardcoded: THOT OS brand copy, Lucide icon mapping, theme toggle.

## AppShell
- Source: `cloudflare/thot-os-next/src/components/app-shell.tsx`
- Category: layout
- Description: Chooses agency or creator portal navigation and wraps workspace content.
- Extractable props: active, creator portal mode.
- Hardcoded: role-specific navigation labels and URLs.

## PageHeader
- Source: `cloudflare/thot-os-next/src/components/app-shell.tsx`
- Category: basic
- Description: Eyebrow, title, subtitle and PRIVATE status badge.
- Extractable props: eyebrow, title, subtitle.
- Hardcoded: PRIVATE badge styling.

## ThemeToggle
- Source: `cloudflare/thot-os-next/src/components/theme-toggle.tsx`
- Category: basic
- Description: Accessible light/dark theme toggle.
- Extractable props: none.
- Hardcoded: icons and accessible labels.
