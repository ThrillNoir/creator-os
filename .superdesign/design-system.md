# THOT OS design system

## Product
THOT OS is a private agency and creator operations workspace. The creator onboarding flow gathers private identity details, creator-approved public context, independent social/paid accounts and login methods, then submits saved sections to agency review. It never implies publishing, messaging, connection or activation authority.

## Visual language
Use the existing BoldKit cloud system only: Geist, square corners, 3px high-contrast borders, 8px offset shadows, pale pink primary, mint secondary and lavender accent. Preserve the graph-paper workspace background and plain, cheeky-but-clear copy. Do not introduce gradients, soft SaaS cards, decorative typefaces or new colors.

## Interaction
Use native form controls, visible labels, keyboard focus, aria-live save feedback and reduced-motion support. Progressive disclosure is preferred: show the account list and one prominent Add account button; reveal the account editor only after selection. Conditional password fields appear only for password sign-in. Google/Apple store provider metadata and email only. The Account PIN is prominent and required before saving or changing login details.

## Onboarding account layout
1. PIN explainer callout.
2. Existing account navigation labelled as Platform – Username.
3. Add account button opens editor.
4. Editor order: Platform; sign-in method; Username + URL; Email + conditional Password; purpose suggestions; PIN; save.
5. Creator-created accounts remain inactive until agency review.
6. Review section explicitly states where submission appears, what changes to Ready for review, and what does not happen.

## Responsive behavior
Two columns on desktop only where fields naturally pair; collapse to one column on narrow screens. Keep actions in a short, readable row and avoid five competing buttons.

## Source of truth
See `.superdesign/init/theme.md` for exact tokens and raw CSS and `.superdesign/init/layouts.md` for the canonical shell.
