# Profile onboarding application layer

## Task contract

Branch: `feat/profile-onboarding`. Implement `/onboarding`, owner Profile loading,
optional display name, explicit required timezone, safe updates and centralized
dashboard/Auth routing. Sources: [Auth/Profile requirements](../01-requirements/auth-profile.md),
[database contract](../02-architecture/auth-profile-database-schema.md) and
[Auth application layer](auth-application-layer.md).

Reuse Supabase SSR and existing RLS. No new dependencies, Profile provisioning,
migrations, privileged credentials, remote services, other domains, staging,
commits or pushes. Missing profiles must fail safely, without application repair.

Validate installation, lint, production build, local HTTP onboarding/Auth tests,
owner isolation, Git diff/status and ignored environment files. Completion derives
from a persisted valid timezone; no new status column or inferred default.

## Implemented behavior

`src/features/profile/session.ts` resolves the current user via the existing server
Auth helper, then loads only display name/timezone with an owner filter through RLS.
The render-scoped cache does not share user data between requests. Missing rows and
query failures return distinct controlled states; both block dashboard content and
offer retry/sign-out, without provisioning or redirecting back and forth.

`saveProfile` is a Server Action. It independently verifies Auth, reads only the two
allowed fields, trims the name (blank becomes null), validates timezone support,
and updates the verified owner's row. Browser IDs and timestamp fields are ignored.
It checks the returned row before redirecting; zero updated rows cannot count as
success. Database errors are mapped to safe messages. Database catalogue validation,
timestamps, privileges and provisioning remain unchanged.

The select options come from Node.js 24 `Intl.supportedValuesOf("timeZone")`, with
UTC and Asia/Ho_Chi_Minh explicitly included when supported, to accommodate ICU
canonical-name differences. See the [Intl specification](https://tc39.es/ecma402/2025/#sec-intl.supportedvaluesof).
There is no browser detection, preselected timezone or universal default. Runtime
validation accepts named zones/aliases but excludes offsets and implementation-only
names; the database still requires an exact supported catalogue entry. Existing
persisted zones must also be interpretable by the runtime for completion.

| Identity/profile state | Routing |
| --- | --- |
| Unauthenticated | Dashboard/onboarding redirect to login |
| Authenticated, timezone null or runtime-unsupported | Dashboard and Auth pages lead to onboarding |
| Authenticated, saved supported timezone | Onboarding/Auth pages redirect to dashboard |
| Authenticated, missing/unreadable profile | Controlled error; no dashboard content, insert or loop |

Signup/password-login actions still enter `/dashboard`, which now applies the
shared Profile gate. Proxy includes onboarding for cookie refresh and no-store
responses. Successful updates invalidate the layout cache; the next dashboard
request reloads persisted data. Dashboard displays email, optional name and timezone.
Logout remains available both during setup and after completion.

Completed users are redirected away from onboarding as requested. A separate
post-onboarding settings UI is not introduced; existing owner RLS permissions are
unchanged. Clearing timezone through those permissions restores the gate.

## Verification scope

`tests/timezones.test.mjs` covers the runtime list and rejection of null, offset,
whitespace, unknown and implementation-only zones, while retaining valid aliases.
The extended `tests/auth-smoke.mjs` exercises real HTTP forms/actions, gates,
optional/trimmed names, invalid timezone preservation, safe database rejection,
forged owner/timestamp fields, two-user RLS isolation, timezone clearing/re-gating,
session refresh and logout/password login. It retains two synthetic local accounts
per successful full run and does not reset data or change Auth settings.

## Results and handoff

- `npm install`: passed, zero vulnerabilities; package files unchanged.
- `node --test tests/timezones.test.mjs`: two tests passed.
- `npm run lint`: passed, zero warnings. The initial sandboxed run stopped making
  progress and was cancelled; the rerun outside the sandbox passed. The HTTP test
  received an additional targeted ESLint check after its last assertion change.
- `npm run build`: passed, including TypeScript. Onboarding, dashboard, login and
  signup are dynamic routes; Proxy is registered.
- `node --env-file=.env.local tests/auth-smoke.mjs`: full test passed, including
  all routing states, owner writes, RLS isolation, database rejection of a timezone
  accepted case-insensitively by Intl, server validation, null/trimmed names,
  forged identity/timestamp fields, refresh and logout/login.
- Git whitespace review passed. Migrations, Supabase configuration, package files
  and existing environment configuration are unchanged. `.env.local` is ignored;
  only `.env.example` is tracked. No configured key found in repository files;
  nothing staged, committed or pushed.

Local Docker/Supabase was initially stopped. Docker startup first timed out while
still initializing; the daemon subsequently became ready and the existing local
Supabase stack started successfully without a reset. It remains running. The
temporary application server was stopped after testing. Two synthetic local
accounts/profiles remain from the successful smoke run.

Limitations: missing-profile and network-error UI paths were reviewed but not
fault-injected into the database. The tests use HTTP Server Action submissions,
not a hydrated browser/visual test. Existing local email confirmation is disabled;
no Auth settings were changed. A runtime/database timezone catalogue disagreement
fails safely instead of selecting a fallback. The existing optional `unrs-resolver`
install-script warning and Git LF-to-CRLF notices remain nonblocking.
