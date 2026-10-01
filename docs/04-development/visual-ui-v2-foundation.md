# Visual UI V2 and localization foundation

## Task contract

Authority: Product Owner's Visual UI V2 Foundation + Localization Foundation request,
2026-10-01. Branch: `feat/visual-ui-v2-foundation`, initially clean and equal to fetched
`origin/main` (029d758). The branch already existed; it is reused without resetting history.
The active implementation request supersedes the initial governance-only task restriction.

Scope: compact semantic CSS tokens, typography, presentation primitives, bilingual shell,
local preference, representative pilot, tests and this handoff. No dependencies, routes,
domain rules, Auth/owner gates, RPCs, schema, migrations or service-worker caching changes.
No commit, push, merge, deploy or real Local/Cloud Supabase access.

References: [architecture](../02-architecture/overview.md), ADR-010/015/017/019/020 in
[decisions](../02-architecture/decisions.md), [Calendar](../01-requirements/calendar-schedule.md),
[Goals](../01-requirements/goals-main-quest-v1.md), [testing](testing.md).

Acceptance: visibly consistent shell at 360/390/412 px and desktop; semantic focus and
touch targets; typed vi/en key parity and Vietnamese fallback; SSR and hydration agree;
existing feature behavior remains covered by the disposable test suites.

## Audit before editing

- `globals.css`: only body literals and five Calendar color tokens. No shared typography,
  focus, surface, radius or motion layer. Calendar's source colors already have UI ownership.
- Dashboard: narrow readable single column; inline navigation duplicates Calendar/Goals
  links. Keep its content order, Suspense boundaries and recovery providers.
- Quest cards/controls: repeated zinc borders/surfaces, rounded-md/lg, button padding and
  white outlines; long content is already allowed to wrap. English status/action/recovery
  strings and explicit English date formatters need later feature-by-feature localization.
- Calendar: existing responsive day/week/month layouts and specialized grid tokens should
  stay intact. Its local navigation is different from application navigation.
- Goals: duplicated button/input styles and progress markup; preserve live derived counts,
  archived status and existing completion controls.
- Auth/onboarding: repeated field/button styling; keep native forms, labels, autofill and
  request/error handling. English server error text remains outside this pilot.
- Mobile/PWA: `page-frame` already respects safe-area insets; preserve this, zoom, existing
  viewport and network-authoritative PWA behavior. No fixed navigation that obscures forms.
- Typography mixes tiny tracked uppercase labels, normal headings and monospace stats.
  Borders range zinc-600..800; panels mix zinc-900/950 opacity; ad-hoc inset shadow in Player.

## Design system

`src/app/globals.css` owns a compact `:root` token layer, exposed through Tailwind v4
`@theme inline` aliases (`bg-surface`, `text-muted`, `text-exp`, etc.). Colors name
roles rather than palette steps: app, surface, elevated, subtle/strong border,
accent/secondary, text/muted, success/warning/danger, EXP, Level, Quest, Main Quest
and Calendar. EXP and Level intentionally share amber; they retain separate semantic
names for future evolution. Calendar's existing public token names alias these roles;
its grid geometry and specialized cell neutrals remain local.

Two radii, panel/section spacing, panel shadow, restrained active-link glow, one duration,
one easing and one focus ring cover the pilot. Native controls have 44 px minimum height,
visible focus, wrapping labels and strong borders. Reduced-motion sets UI transitions to
zero. There are no decorative animations, downloaded fonts or image assets.

Arial/Helvetica/system sans-serif remains the font stack with Vietnamese support.
`type-display`, `type-page`, `type-section`, `type-card`, `type-body`, `type-metadata`
and `type-stat` define the hierarchy. Display/page sizes scale with viewport width;
stats use tabular numbers. Numeric values still come from existing domain projections.

`src/components/ui/primitives.tsx` exports:

| Primitive | Contract / pilot use |
| --- | --- |
| Panel | Native section; caller supplies accessible name; Player and EXP cards |
| SectionHeader | h2 with optional description/actions; ready for Dashboard V2 |
| Button | Native button; defaults to type=button, explicit submit in forms; primary/secondary/danger; auth and locale forms |
| Badge | Visible status text plus semantic tone; no status inferred from color; ready for Dashboard V2 |
| ProgressBar | Caller supplies label, value and optional accessible value text; clamps visual bounds only; EXP and Goal progress |
| EmptyState | Caller supplies localized title/description/action; ready for Dashboard V2 |
| fieldClass | Native input/select styling; label, validation and field ownership remain at call sites; login and locale select |

Only the application header/navigation, Player/EXP panel presentation, EXP/Goal progress
bars and auth form controls adopt this foundation. Dashboard content order, Calendar grids,
Goal editors and feature workflows are retained. Header navigation exposes all three
existing routes, marks the current page and preserves Dashboard's selected-day Calendar link.

## Localization and preference

The Product Owner explicitly requested a lightweight internal vi/en layer and local
persistence. This implementation stays within that presentation scope; it introduces no
new domain/integration/access-control architecture and needs no additional ADR.

`src/lib/localization/dictionaries.ts` defines the canonical English key shape and requires
Vietnamese to satisfy the same recursive string shape. `getDictionary` and `resolveLocale`
centralize lookup and validation; missing/unsupported values fall back to `vi`. Both
dictionaries are complete for the pilot. Add a key to English, add its Vietnamese value,
and consume the typed property via `useLocale().messages`; do not branch on locale in UI.
For later server components, use `getDictionary` with the validated request locale.

`RootLayout` reads `system-locale` using Next's request cookies, sets `<html lang>` and
provides that exact locale to `LocaleProvider`. The preference is a non-sensitive,
host-only, path=/, SameSite=Lax cookie with one-year max age and Secure on HTTPS. It is
device/browser-local, not account-synchronized. No Accept-Language inference, locale route
prefix, database setting, third-party i18n package or localStorage hydration correction.

The shell's labelled select and explicit apply button write the allowlisted preference,
verify it was accepted and request an RSC refresh. Transition state disables repeat submits;
cookie refusal yields a localized alert. The refresh preserves mounted client form drafts
and the current URL; normal server read behavior still applies. Cookie deletion/expiry or
unsupported values restore Vietnamese. Persisted domain strings, user-entered content,
identifiers, routes and RPC payloads are never translated.

Default Vietnamese currently covers shell labels, navigation and page headers only.
The selector explicitly states that its scope is navigation and page titles. SYSTEM, EXP,
LEVEL, Quest, Main Quest and Sub Quest may retain their identity. Existing English feature
content, including onboarding and offline text, inherits `lang=en` from the body (also
explicit on the three pilot pages and login); the shell overrides to the selected locale.
Feature status/error strings and date/number formatter localization remain
deferred together, rather than partially translating command contracts or user content.

## Dashboard V2 follow-up

Redesign Dashboard composition and information hierarchy in a separate PR. Adopt the
remaining primitives when actual feature presentation calls for them. Migrate feature
copy, accessibility labels, empty/loading/recovery states and date/number formats together
per feature, including Auth/onboarding and the network banner. Preserve timezone semantics
and exact EXP integer handling. Full Calendar/Goals redesign and account-synced locale are
outside this foundation.

## Verification

Validated 2026-10-01 on Windows, Node 24.18.1 and Chromium using the existing disposable
Auth/PostgREST/tmpfs PostgreSQL infrastructure. No real Local or Cloud instance was used.

| Check | Result |
| --- | --- |
| `node --test tests/*.test.mjs` | 227 passed, 0 failed/skipped (221 existing + 6 foundation tests) |
| `node tests/auth-smoke.mjs` | Passed; login/owner enforcement, RLS, onboarding, session refresh and logout |
| `npm run test:e2e` | 27 passed, 1 failed before the locale label fix; all 26 existing scenarios passed |
| `npm run test:e2e -- --grep 'V2'` | Final implementation: 2 passed (desktop + mobile), including the corrected desktop scenario |
| `npm run lint` | Passed, zero warnings |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed with synthetic loopback configuration; disposable browser runs also build isolated copies |
| `git diff --check` | Passed |
| Visual inspection | Reviewed generated Dashboard desktop and Dashboard/Calendar/Goals mobile screenshots |

The first browser attempt required installing the missing Playwright Chromium runtime;
no package or lockfile change was needed. The subsequent full run exposed an exact-label
lookup problem because the locale label enclosed the option list. The final markup uses
separate label/select elements linked by htmlFor/id. Both V2 journeys passed after this
fix; the entire 28-test suite was not repeated after the fix. No existing assertion was
removed or weakened.

Browser coverage includes both languages on all three shell routes; first-render SSR locale,
document language, cookie persistence through reload, unsupported-cookie fallback, cookie
refusal feedback, preserved unsent Quest title/current URL, active-route semantics, keyboard
focus, reduced motion and 44 px navigation targets. All three routes fit 360/390/412 px and
1280 px without horizontal document overflow. No hydration errors were observed. Token
tests check normal foreground contrast >=4.5:1 and control border contrast >=3:1 against
the new dark surfaces. Existing PWA installability and phone-layout scenarios passed.

Limits: browser checks use Chromium desktop/mobile emulation; no physical iOS/Android
installation or assistive-technology session was performed. Feature translation and full
Dashboard V2 are intentionally deferred. Test screenshots/reports/logs remain ignored local
artifacts under `test-results/` and `playwright-report/`.

Review status: ready for code/design review on the requested branch, with all 26 existing
browser scenarios and both final V2 journeys validated. Tracked diffs and new files were
reviewed separately. Auth authorization, domain/application services, schema/RPC contracts, dependencies
and routes have no changes. No commit, push, PR creation, merge or deployment was performed.

## Changed-file inventory

- Tokens, document locale and pilot pages: `src/app/globals.css`, `src/app/layout.tsx`,
  `src/app/dashboard/page.tsx`, `src/app/calendar/page.tsx`, `src/app/goals/page.tsx`.
- Shared presentation: `src/components/app-header.tsx`, `src/components/ui/primitives.tsx`.
- Localization: `src/lib/localization/dictionaries.ts`, `src/lib/localization/provider.tsx`.
- Representative adoption: `src/features/auth/auth-form.tsx`,
  `src/features/auth/logout-form.tsx`, `src/features/progression/components.tsx`,
  `src/features/goals/components.tsx`.
- Node tests: `tests/visual-foundation.test.mjs`, `tests/helpers/ui-loader.mjs`,
  `tests/progression.test.mjs`, `tests/daily-quests.test.mjs`, `tests/rewards.test.mjs`.
  Existing feature tests only gain the resolver for real shared TSX components.
- Integration/browser tests: `tests/auth-smoke.mjs`, `tests/e2e/fixtures.ts`,
  `tests/e2e/visual-foundation-helpers.ts`, `tests/e2e/visual-foundation.desktop.spec.ts`,
  `tests/e2e/visual-foundation.mobile.spec.ts`. Existing copy assertions explicitly select
  English; new tests start with no preference and exercise the real Vietnamese default.
- This development document: `docs/04-development/visual-ui-v2-foundation.md`.
