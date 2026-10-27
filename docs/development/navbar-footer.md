---
title: Website navbar and footer adoption
doc_type: development-guide
status: active
owner: app-maintainer
created: 2026-10-27
last_reviewed: 2026-10-27
canonical_for: App website-style navbar and footer implementation
---

# Website navbar and footer

The primary references are `cybergold-design-system/CYBERGOLD_NAVBAR_FOOTER.md`
and `CYBERGOLD_DESIGN_SYSTEM.md`. The Phase 1 palette and local Inter/IBM Plex
Sans font variables are reused. Component styles live in
`app/components/siteChrome.css`, without Bootstrap or new dependencies.

## Implementation

The fixed navbar is 58px at desktop widths and 54px below 992px. Its centered
row is capped at 1120px. A ResizeObserver and resize listener measure the
actual bar and update the preceding spacer. ScrollY > 12 enables the 90%
`rgba(8, 8, 8, 0.9)` surface, 1px `rgba(255, 255, 255, 0.1)` bottom border
and 14px blur. At 12px or less, the surface is `rgba(8, 8, 8, 0.38)` with
4px blur and a transparent 1px bottom border. Neither state has a shadow;
opening the mobile drawer preserves these values. Reduced motion removes
navbar, underline, drawer and settings transitions.

The supplied gold brand logo links to the website's current locale homepage.
Swap and Dashboard remain same-tab, locale-aware routes on the current dApp
origin, including localhost. Litepaper uses the exact documented destination,
new-tab behavior, `rel="noopener"`, external icon and localized announcement.
Primary links use the documented muted/bright colors and focus/hover underline
without an automatic active-link class.

Right-side order is wallet, hamburger (below 992px), Settings. The original
RainbowKit/wagmi component, account formatting, network handling, disconnect
callbacks, balance panel and cache are retained. The sidebar's existing top
offset now uses the shared navbar height. Wallet panels retain body typography
instead of inheriting the compact navbar font.

The settings pill contains the gear, divider and chevron. Its single region
contains language, gold metrics, currency and theme groups. It uses the original
currency/unit context, display-mode setters, theme cookie, routing and saved
disclosure hook. Selections remain enabled, show their current checks and
close the panel. Keyboard arrows/Home/End, Escape/focus return, outside pointer
and focus dismissal are supported. Saved preferences and disclosure positions
are restored before hydration. Locale changes preserve the path, query and hash.

The left drawer has the documented full-viewport backdrop, slide transition,
Unicons close glyph and focus trap. Escape, close and backdrop dismiss it and
restore focus after the trap is removed. Desktop resize clears mobile modal
state and restores inline links. Body scrolling remains enabled.

The footer uses the original light logo and 2x descriptor, opaque #111 surface,
responsive named grid areas, gold heading, fine separators and original copy.
GitHub/LinkedIn/X links and focus/hover states follow the specification. The
original PNG/font files were copied byte for byte; matching installed Feather,
Lucide and Font Awesome React icon exports supply the documented SVGs.

## Integration choices and deviations

- The user confirmed EN/FR/DE. Russian remains disabled and unmodified.
- The dApp retains its 16px root and Swap/Dashboard geometry. Every website
  rem value used by the chrome is converted using the specified 20px basis;
  pixel heights, breakpoints and 44px targets stay literal pixels.
- Navbar blur is painted by a decorative pseudo-element, so it cannot turn
  the existing fixed wallet panel into a navbar-relative element. Its visual
  fill/blur/border/scroll behavior is unchanged from the specification.
- Below 360px, settings-pill and wallet padding/gaps are slightly reduced to
  fit the additional shortened address while preserving the logo, address
  text and 44px target heights. The existing wrong-network action appears
  just below the narrow bar instead of expanding its height.
- Language/group labels use the dApp's translations. Language option names
  are English/French/German as specified. Theme is retained as a fourth group
  but hidden from the menu at the user's request;
  currency and unit choices are functional rather than website placeholders.
- Existing selection and menu persistence is retained, including first paint.
  Drawer/settings cross-dismiss to keep one focus owner on small screens.
- The existing authority-gated Governance link is retained. No authority,
  wallet, transaction, data-fetching, Swap or Dashboard logic was changed.
- The footer displays only the deployed App commit from
  `NEXT_PUBLIC_CYBERGOLD_APP_COMMIT`, with an eight-character label and a link
  to the full commit in the App repository. Missing or invalid build metadata
  shows the localized unavailable message. The source-code link is retained;
  website version links and credits are removed at the user's request.
- The exact documented contact target is `mailto:#`. It intentionally does
  not address `contact@cybergold.io`; correcting this source-site quirk would
  be a separate content decision.
- The referenced `assets/` directory was absent. The identical branding and
  Unicons originals were available under `backgrounds/`; matching React icon
  components were already installed and are explicitly permitted by the spec.

## Files changed for this task

- `app/components/navbar.tsx`
- `app/components/navbarSettings.tsx` (new)
- `app/components/footer.tsx`
- `app/components/siteChrome.css` (new)
- `app/components/walletConnectButton.tsx` (presentation attributes/labels only)
- `app/[locale]/layout.tsx` (owned stylesheet import)
- `app/globals.css` (wallet panel navbar-height integration only)
- `app/config/publicEnvironment.ts`, `.env.example`
- `messages/{en,fr,de}.json` (Navbar/Footer keys only)
- `public/branding/` (three original PNGs and source note)
- `public/fonts/unicons/` (two original font files and source note)
- `tests/e2e/navbar-footer.spec.ts` and `fixtures/navbar-settings.ts` (new)
- `tests/e2e/{app-refresh-header,home,theme-refresh,public-display-cache,wallet-balances-api}.spec.ts`
- `docs/architecture/environment.md` and this implementation note.

Phase 1 edits and the existing user change to package-lock.json are preserved.
No commit, push, pull request or publication is part of this task.

## Validation on 2026-10-27

- Full lint, standalone TypeScript and production build passed.
- Eleven configuration/build-identity unit tests passed.
- The final combined Edge run passed 41 scenarios. It covers all 13 widths
  (320, 390, 575, 576, 767, 768, 820, 991, 992, 1024, 1199, 1200, 1440px),
  footer grid columns, no horizontal overflow, wallet/settings access,
  keyboard navigation, focus trap/return, resize cleanup, scroll/hover/focus,
  reduced motion, exact links, locale path/query/hash preservation, all
  preference groups and pre-hydration reload persistence.
- Read-only synthetic-wallet coverage includes connected 320px/1440px layouts,
  original shortened/full addresses, balance panel opening, sidebar alignment,
  tabbing back to Settings/main, disconnect, cached-wallet handoff and the
  existing wrong-network control. No real-wallet signatures or transactions
  were requested.
- All five copied PNG/font assets returned HTTP 200 and matched the source
  files byte for byte. EN/FR/DE rendering and the live Sandbox chain-31338
  environment validation passed.
- Desktop navbar, settings and footer were compared visually with the live
  https://www.cybergold.io/en/ in Edge. Mobile/tablet/desktop audit screenshots
  are available under `out/audit/navbar-footer/`, including connected wallets.
  The web-fetch tool could not load the site, but the desktop browser could.
- The isolated chain-31337 fixture server was stopped and its temporary source
  copy removed before the final build. The user's `.env.local`, live app and
  previous Phase 1 work were preserved.

There are no known blocking issues in the checked scenarios. The documented
contact URI and extra functional dApp controls/provenance are intentional
differences noted above. Physical mobile-wallet relay/deep-link/signing flows
were not qualified by these synthetic browser checks.
