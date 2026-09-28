# Personal Beta / PWA V1

## Task contract

Branch `feat/personal-beta-pwa-v1`, dated 2026-09-28 (the Personal Beta / PWA V1 task).
Goal: let the Product Owner install SYSTEM on an Android phone and an iPhone and use it
daily as a standalone app, with the smallest amount of new machinery. Explicitly out of
scope: offline use, background sync, push notifications, third-party analytics, new
dependencies, and any change to authentication, RLS, schema or Quest/EXP semantics. See
[ADR-017](../02-architecture/decisions.md) for the accepted trade-offs.

## What ships

| Path | Responsibility |
| --- | --- |
| `src/app/manifest.ts` | Web app manifest: name, `start_url: "/dashboard"`, `scope: "/"`, `display: "standalone"`, dark theme/background colors, icon list |
| `src/app/layout.tsx` | `Viewport` metadata (`width=device-width, initial-scale=1, viewport-fit=cover`), `theme-color`, `color-scheme`, Apple home-screen tags, `link rel="manifest"`, favicon entry |
| `public/icons/*` | Committed icon set: `icon.svg`, `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon-180.png` |
| `public/favicon.ico` | 32×32 PNG-in-ICO so the default browser icon request does not 404 |
| `scripts/generate-pwa-icons.mjs` | Dependency-free, deterministic generator for every raster asset |
| `public/sw.js` | Minimal service worker; caches the manifest and icons only |
| `src/features/pwa/service-worker-registration.tsx` | Production-only registration, fail-open on any error |
| `next.config.ts` | Serves `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` |
| `src/app/globals.css` | `page-frame` utility: safe-area padding that never shrinks existing spacing |
| Page containers + controls | `page-frame` on every page shell, `pointer-coarse:` touch-target growth on buttons/inputs |

## What makes it installable

Chromium/Android offers a real install (a WebAPK, not a bookmark) when all of these hold:

1. The page is a secure context — HTTPS in Production, or `http://localhost` /
   `http://127.0.0.1` for Local development.
2. A manifest is linked from the document and declares `name`/`short_name`,
   `display: standalone`, a `start_url` inside `scope`, and icons that include at least
   one PNG of 192 px and one of 512 px. The `maskable` 512 px icon lets Android mask the
   mark into its own shape without clipping the emblem.
3. A service worker is registered for the scope and has a `fetch` handler. SYSTEM's
   handler answers exactly the six allowlisted static URLs and returns without
   `respondWith()` for everything else, which satisfies the requirement without
   intercepting authenticated traffic.
4. The icons, manifest and worker all resolve from the same origin — verified against a
   real production build rather than assumed.

`start_url` is `/dashboard`: an authenticated visit renders the dashboard and an
unauthenticated one is redirected to `/login` by the existing server boundary, so the
manifest never grants access.

## Icons

`node scripts/generate-pwa-icons.mjs` regenerates every raster asset from one SVG
definition and writes `public/favicon.ico`. It is pure Node (`node:zlib`,
`node:fs`) — it encodes PNG chunks (CRC + zlib-deflated RGBA scanlines) and the ICO
container directly, so no image library is added to the repository. Output is
byte-deterministic for a given source, so re-running it on an unchanged mark is a no-op
and any diff in `public/` is a real design change.

Sizes and variants: `icon-192.png` and `icon-512.png` are rounded (`purpose: "any"`),
`maskable-512.png` is full-bleed with the mark scaled into the 80 % safe zone
(`purpose: "maskable"`), `apple-touch-icon-180.png` is full-bleed because iOS applies
its own mask, and `favicon.ico` is 32 px full-bleed. `icon.svg` is the vector favicon.

## Install on Android / Chromium

1. Deploy or run the app over HTTPS (or `http://localhost` on the device's own browser).
2. Open the site in Chrome and sign in once.
3. Chrome shows an "Install app" prompt, or use the ⋮ menu → *Add to Home screen* →
   *Install*. Confirm the dialog that names the app SYSTEM.
4. Launch from the home screen. The app opens at `/dashboard` in standalone mode with no
   browser toolbar; sign out from the in-app *Sign out* control.
5. To remove it: long-press the icon → *App info* → *Uninstall*. Clearing the app's
   site data also drops the cached icons and the worker.

If no prompt appears, open DevTools → Application → Manifest for the installability
errors, or `chrome://service-worker-internals` for the worker state. The most common
cause is a non-secure origin.

## Install on iPhone / Safari

1. Open the site in Safari (Chrome on iOS cannot install web apps) and sign in.
2. Tap the Share button → *Add to Home Screen* → *Add*.
3. Launch from the home screen. The icon comes from `apple-touch-icon-180.png` and the
   status bar uses `black-translucent` over the dark theme.

iOS limitations that are inherent, not SYSTEM bugs:

- There is no install prompt API; *Add to Home Screen* is always manual.
- The icon and manifest are captured when the shortcut is created. After an icon or
  manifest change, remove and re-add the shortcut; iOS may also need time to refresh its
  icon cache.
- iOS home-screen shortcuts open standalone regardless of the meta tags, so the
  `mobile-web-app-capable` / `apple-mobile-web-app-capable` pair is compatibility
  metadata for Safari versions that only knew the legacy name, not the switch that
  enables standalone mode.
- The service worker update arrives on its own schedule, so the static icon cache can lag
  a deploy by one navigation. There is no in-app "new version" banner in V1.
- Richer PWA features (Web Push, independent storage) require an installed shortcut over
  HTTPS; none of them are used here.
- `viewport-fit=cover` safe areas are honored, but iOS still draws its own home
  indicator; content is padded rather than drawn under it.

## Standalone-mode expectations

- `viewport-fit=cover` plus the `page-frame` utility lets the layout reach the screen
  edges while content keeps `max(existing spacing, env(safe-area-inset-*))` padding, so a
  notch or home indicator never covers text or a control and desktop spacing is untouched
  (every `env()` value is `0px` in a normal tab).
- `theme-color` and `color-scheme: dark` keep the OS chrome and the over-scroll area dark.
- No code branches on display mode: `display-mode` media queries, window size and
  user-agent strings are never used for authorization or feature gating. An installed
  app has exactly the same privileges and routes as a browser tab.
- Coarse-pointer devices (`pointer: coarse`) get taller hit targets on buttons and
  inputs; fine-pointer desktop rendering is unchanged.

## Online / offline behavior

SYSTEM is network-authoritative in V1. The only cached entries are the six paths in the
worker's `PRECACHE` list — the manifest and five icons. Everything else (document HTML,
React Server Component payloads, Server Action responses, Supabase Auth and PostgREST
traffic, application JS/CSS) goes straight to the network.

Consequences the Product Owner accepted for V1:

- With no connection an installed app shows the browser's normal offline error; there is
  no offline shell, no cached dashboard and no queued Quest or EXP mutation.
- Quest completion, EXP credit and reversal always hit the server, so a stalled or
  offline device cannot invent progress, and the existing recovery flow still governs an
  interrupted completion.
- The worker writes nothing user-specific to Cache Storage, `localStorage` or IndexedDB;
  session storage keeps its pre-existing behavior.

## Update behavior

`/sw.js` is served `no-store`, so the browser always re-checks the worker script. A new
revision means bumping `CACHE_VERSION` in `public/sw.js`; on activation the worker
deletes every cache that does not match, so an old icon set cannot outlive the deploy.
Registration posts `SKIP_WAITING` and the worker calls `clients.claim()`, which is safe
here precisely because application code is never served from cache — the next navigation
reads the current build either way. No forced reload and no update prompt exist in V1.

## Security boundary

- Authentication, session refresh in `src/proxy.ts`, server-side owner verification and
  RLS are unchanged and run for installed apps exactly as they do in a tab.
- The worker never sees or stores a session cookie, token, Quest, EXP or reward payload:
  its `fetch` handler returns before `respondWith()` for any URL outside the allowlist,
  ignores non-`GET` requests, and ignores cross-origin requests, which includes the
  Supabase project domain.
- Registration is production-only and wrapped in a `try`/`catch`; a blocked, unsupported
  or failing registration (private mode, enterprise policy) leaves the app fully
  functional in the browser.
- The cached static assets are public by nature and contain no personal data, so caching
  them reveals nothing about the account.


## Automated coverage

`tests/e2e/pwa.mobile.spec.ts` runs in the existing disposable Playwright harness
(desktop + mobile projects — see [Playwright setup and safety](playwright-e2e.md)) and
adds five read-only tests. It never creates, completes, reopens or resolves a Quest, so
the mutating Quest lifecycle stays in the desktop suite.

| Test | Asserts |
| --- | --- |
| manifest advertises installable metadata | `/manifest.webmanifest` status, content type, exact name/scope/`start_url`/`display`/colors, exact icon list |
| required assets resolve from the isolated build | 200 + image content type + real PNG/ICO magic bytes for every manifest icon, `icon.svg` and `favicon.ico`; the rendered `apple-touch-icon` link resolves; `manifest` link, `theme-color`, `viewport-fit=cover` and both capable metas |
| the worker is fresh and static-only | `/sw.js` status, JavaScript content type, `no-store` in `Cache-Control`, the `PRECACHE` allowlist is exactly the six static paths, `skipWaiting` and `clients.claim` present, and no reference to `/dashboard`, `/login`, `/api`, `supabase`, `localStorage` or `indexedDB` |
| sign-in is usable at phone widths | no horizontal overflow and no element past the viewport edge at 360/390/412 px, editable email/password, sign-in button in the viewport and ≥ 44 px tall, coarse pointer active |
| dashboard keeps Quest controls reachable | the same overflow checks at 360/390/412 px plus in-viewport, editable Create Quest fields, ≥ 44 px Schedule Quest and day-navigation buttons, Daily Quests region and in-app *Sign out* reachable |

Two deliberate limits of the automated coverage: Playwright blocks service workers
(`serviceWorkers: "block"`) so the worker script is asserted rather than executed, and
emulation cannot prove an install prompt appears. Those remain device checks.

`tests/helpers/auth-environment.mjs` now copies `public/` into the isolated E2E build so
the icons and worker exist there; the copy allowlist in
[playwright-e2e.md](playwright-e2e.md) documents it.

### Validation record for the Personal Beta PR (2026-09-28, `feat/personal-beta-pwa-v1`)

| Check | Result |
| --- | --- |
| `npm run lint` | pass |
| `npx tsc --noEmit` | pass |
| `npm run build` (synthetic env, no credentials used) | pass |
| Rendered `<head>` from a real `next start` server | `viewport` with `viewport-fit=cover`, `theme-color`, single `link rel="manifest"`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, `mobile-web-app-capable` and `apple-mobile-web-app-capable` = `yes`, `icon` and `apple-touch-icon` links all present |
| `GET` on every installability asset from that server | `/manifest.webmanifest` 200 `application/manifest+json`; `/icons/icon.svg` 200 `image/svg+xml`; `/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon-180.png` 200 `image/png`; `/favicon.ico` 200; `/sw.js` 200 `application/javascript` with `Cache-Control: no-cache, no-store, must-revalidate` |
| `npm run test:e2e` | pass: 10/10 in 2.1 min (4 desktop + 6 mobile, including the 5 new PWA/phone-layout tests) |
| `node scripts/generate-pwa-icons.mjs` re-run | pass: all 6 raster assets byte-identical (SHA-256) after regeneration |
| `git diff --check` | clean |


## Production validation checklist

Run against the Product Owner's authorized deployment, on a real phone, after the PR is
merged. Every step is a manual confirmation; none of it can be done from the repository.

- [ ] HTTPS loads, the app is in a secure context, and the console shows no
      mixed-content or certificate warning.
- [ ] `/manifest.webmanifest` returns 200 with `application/manifest+json`, and the
      DevTools Application panel reports no installability errors.
- [ ] Chrome/Chromium offers *Install app*; after installing, the home-screen icon shows
      the SYSTEM mark (not a generic page icon) and the app opens standalone at
      `/dashboard` with no browser toolbar.
- [ ] Inside the installed app: sign in, create a Quest and complete it, then confirm
      EXP credited and the Level reflects it (network-authoritative, never cached).
- [ ] *Sign out* works from the installed app and the next launch lands on `/login`.
- [ ] On a notched and a home-indicator device, plus in landscape, no text is clipped and
      no control is unreachable; the on-screen keyboard does not cover the focused field.
- [ ] Airplane mode: the app shows the browser offline error and offers no stale
      dashboard and no queued mutation.
- [ ] After a new deploy, relaunch the app: the new build loads and the worker log
      (`chrome://service-worker-internals`) shows the current cache version with older
      caches deleted.
- [ ] iPhone: Safari → *Add to Home Screen* → *Add*; the icon, name and dark status bar
      are correct and the shortcut opens standalone. Re-add the shortcut if the icon did
      not refresh.
- [ ] Uninstall, then confirm the browser tab still works normally.

## Remaining real-device checks

Not verifiable from the repository, therefore still open for the Product Owner:

1. Whether Chrome offers the install prompt for the deployed manifest on the exact
   Android version in hand.
2. iOS icon caching: whether a changed icon requires recreating the shortcut, and how
   long iOS keeps the previous one.
3. Real safe-area inset values on the owner's devices versus the `max()` fallbacks
   asserted under emulation.
4. Standalone behavior on iOS with the keyboard open, and any effect of iOS storage
   partitioning on session lifetime for a home-screen web clip.
5. Whether any Chromium version warns about the worker's update policy or treats a
   `no-store` worker script unusually.

## Product Owner approval items

- **Deploy:** this PR needs an authorized deployment before any phone check is possible.
  No deployment was performed from the agent session.
- **Credentials:** no real Supabase credentials were used; builds and tests ran with
  synthetic values in the disposable harness.
- **Architecture:** ADR-017 records the accepted trade-off (installability without an
  offline cache) and is offered for review rather than assumed.
- **Backlog:** an offline shell, push notifications, an in-app update banner and any
  further iOS-specific polish are candidates, not part of V1.

