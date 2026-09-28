# Daily-use Hardening V1 — PR #38

Task contract: implement only confirmed daily-use gaps on
`feat/daily-use-hardening-v1`. The Product Owner's current implementation request
supersedes the historical documentation-only initial-governance restriction.
No commits, pushes, PR creation, deployment, dependencies, schema changes or access
to Cloud, Vercel, Production or the developer Local Supabase project.

Preserve [Auth](../01-requirements/auth-profile.md),
[Quest creation](../02-architecture/quest-creation-v1-contract.md),
[Quest commands](../02-architecture/quest-command-api-v1.md),
[EXP](../01-requirements/player-exp.md), ADR-012 through ADR-015 and
[PWA cache boundaries](personal-beta-pwa.md). Use only the existing isolated
Playwright/Auth/private-owner harnesses. Acceptance: recoverable failures, guarded
pending controls, clear offline/loading feedback, mobile accessibility and the
requested regression checks, without changing command or reward semantics.

## Audit before implementation

- Login/logout: server errors are sanitized and buttons use `useActionState`, but
  browser-to-server rejection escapes that state entirely. There is no immediate
  submit guard for repeated form submissions before React renders pending state.
- Dashboard: Profile and progression reads precede any Suspense boundary; both
  participate in redirect decisions. Loading them behind a streaming fallback
  changes HTTP redirect behavior. Keep those gates intact (see deferred work).
- Creation/completion/reopen: existing lifecycle guards, Web Locks, persisted exact
  requests and safe recovery already protect command identity. Preserve them.
  Recovery/create action buttons lack the explicit focus/touch treatment used by
  ordinary navigation. Creation's pending title has no long-word wrapping.
- Quest list, EXP/Level and rewards already distinguish empty/unconfigured/error
  states; errors do not display raw database messages. No replacement needed.
- Network loss: no shared offline indicator; users can attempt new actions while
  the browser explicitly reports offline. Existing uncertain requests must remain
  recoverable and must never be automatically replayed on reconnect.
- PWA: only manifest/icons are cached; no authenticated data, HTML or application
  bundles. Activation causes no reload. No confirmed stale-version problem calls
  for update UX or a worker change.
- Existing mobile suite checks empty dashboards at 360/390/412 px. Extend it for
  long creation recovery text and focus/touch controls, not another full lifecycle.

## Fixes and user-visible behavior

- Login/logout keep their server-rendered Server Action forms. Hydrated submits
  use a synchronous guard and React transition, disable pending controls, catch
  transport failures, and restore retry controls with concise sanitized messages.
  Next redirects are rethrown via the framework's
  [control-flow helper](https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow).
  Login inputs survive failed attempts in component memory only; nothing writes
  credentials to browser storage. The server owner/session/logout logic is unchanged.
- A shared polite live region explains offline state and warns that displayed data
  may be stale. Auth and Quest send/retry controls disable while the browser reports
  offline. Reconnection enables eligible controls without refreshing or dispatching
  work. This browser hint does not claim server reachability; unexpected connection
  loss still follows the existing exact-request/reconciliation paths.
- Quest creation recovery wraps long unbroken titles, preventing phone overflow.
  Its retry target now meets the same touch sizing as normal controls. Creation,
  completion, reopen and recovery buttons have explicit visible focus outlines.
  Cancelling reopen remains possible offline.
- Existing pending lifecycle locks, command IDs, EXP calculations, cycle guards,
  server revalidation and recovery rules are untouched. Empty Quest, unavailable
  progression and reward states already have explicit messages and remain intact.
  No database/schema, RLS, dependencies or service-worker changes were needed.

Production files: `src/app/layout.tsx`, `src/features/network/network-status.tsx`,
`src/features/auth/{auth-form.tsx,logout-form.tsx,use-auth-action.ts}` and
`src/features/quests/{create-form.tsx,completion-control.tsx,completion-recovery-ui.tsx}`.

## Regression coverage

- `tests/e2e/hardening.desktop.spec.ts`: same-tick login/logout submissions send
  once; held requests expose disabled pending controls; transport rejection restores
  controls and preserves the login input; offline login disables; successful retry
  still authenticates and logs out through real isolated Supabase.
- `tests/e2e/quests.desktop.spec.ts`: targeted creation failure with duplicate
  submission, retained command ID, explicit successful retry and database proof of
  exactly one Quest/occurrence with no EXP entries. Existing lifecycle gains offline
  complete/reopen assertions instead of duplicating that lifecycle.
- `tests/e2e/hardening.mobile.spec.ts`: aborted creation with a valid 120-character
  unbroken title, overflow/viewport/focus/44px touch checks at 360/390/412 px,
  offline retry/logout controls and no automatic replay after reconnect.
- `tests/quest-completion-ui.test.mjs`: online/offline transitions keep controls
  usable without dispatch and unsubscribe listeners on unmount. Browser mocks now
  declare `onLine`; shared-coordinator assertions still require exactly four readers
  and two owners, filtering out the additional boolean network subscriptions.
- Existing Auth smoke still checks server-rendered forms, exact HTTP redirects,
  refresh/logout and owner isolation. Existing private-owner suite still checks
  all historical business bodies, RLS and command/EXP behavior.

## Intentionally deferred

- Initial Auth/Profile/EXP loading: a route fallback was rejected during validation
  because it changes HTTP redirects into streamed 200 responses. The EXP reader can
  also redirect for verified expired sessions, so moving only that read behind
  Suspense has the same issue. Keep the existing gates and Quest/reward loading
  panels; revisit navigation feedback with explicit redirect-contract coverage.
- PWA update UX: no confirmed stale-version issue; static-only caching and no-reload
  activation remain unchanged. Actual Android/iOS installation, device keyboard and
  safe-area rendering still need physical-device checks. Chromium emulation and
  delivered worker/manifest checks are not a claim of installed-device validation.
- Browser online events cannot detect every server outage. No active probes,
  automatic mutation retries, offline mutation queue or sync were added.

## Validation — 2026-09-29

All integration targets are disposable; no existing Local or Cloud database was
contacted. Final checks:

| Command | Result |
| --- | --- |
| `npm run test:e2e -- --list` | 13 tests in 6 files, desktop and mobile Chromium |
| `npm run test:e2e` | 13 passed, 0 failed, 1 worker, 2.5 minutes |
| `node --test tests/*.test.mjs` | 178 passed, 0 failed/skipped |
| `node tests/auth-smoke.mjs` | Passed; HTTP redirects, server-rendered actions, owner gates, session refresh, logout and RLS |
| `node supabase/tests/private-owner-wire.mjs` | Passed; 17 historical checkpoint suites and 10 database/security groups |
| `npm run lint` | Passed, zero warnings |
| `npx tsc --noEmit` | Passed, no diagnostics |
| `npm run build` | Passed; synthetic loopback Supabase/owner overrides, no live database dependency |
| `git diff --check` | Passed |
| Disposable cleanup | No harness-labeled containers/networks or `.e2e` application copies remain |

The mobile hardening test also passed independently after correcting its fixture
to use a valid maximum-length title and planned start. Early validation caught
the route-loading redirect regression, the need to retain server-rendered Auth
action metadata, and network-store additions to the Node browser mock. Those were
fixed without weakening redirect, lifecycle, ownership or command assertions.
The initial sandbox could not access Docker; integration runs used the authorized
local Docker engine and the harness's owned disposable resources instead.

No commit, push, PR, merge or deployment was performed. Browser diagnostics remain
under the existing ignored paths and are not deliverable application artifacts.
