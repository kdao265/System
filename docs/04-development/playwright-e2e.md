# Playwright E2E foundation

Task contract: `feat/playwright-e2e-v1`, requested by the Product Owner on
2026-09-28. Scope is browser Auth/dashboard coverage, isolated test infrastructure,
mobile foundation and CI. No Quest mutations, application behavior, migrations,
Cloud/Vercel changes, commits or publishing. Acceptance is the six Auth journey
checks, desktop/mobile discovery, disposable cleanup and preserved regression gates.
Related: [Auth requirements](../01-requirements/auth-profile.md),
[ADRs 014–016](../02-architecture/decisions.md), and [testing](testing.md).

## Run

Use Node.js 24, `npm ci`, and a running local Linux Docker engine (Docker Desktop
on Windows). Install only the browser used by both projects:

```sh
npx playwright install chromium
# Linux CI additionally needs system libraries:
npx playwright install --with-deps chromium
```

The existing auth helper requires these cached images; it never pulls implicitly:

```sh
docker pull public.ecr.aws/supabase/postgres:17.6.1.166
docker pull public.ecr.aws/supabase/gotrue:v2.197.0
docker pull public.ecr.aws/supabase/postgrest:v16.2
npm run test:e2e -- --list
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e -- --project=mobile-chromium
```

No `.env` file, Supabase CLI project, owner credentials or target URL is required.
Discovery does not start Docker. Do not supply an external base URL or storage state.

## Isolation and lifecycle

Each Playwright worker owns an instance of `tests/helpers/auth-environment.mjs`:
UUID-named containers/network, dynamically assigned loopback ports, PostgreSQL
tmpfs, real GoTrue and PostgREST, generated credentials and owner configuration.
The existing helper applies migrations with ADR-015 activation deferred until owner
provisioning. It checks immutable container IDs, labels, network and absence of
mounts before SQL or removal. No reset command, Docker volume operation, existing
Local `System` project, or Production connection is used.

E2E opts into an application source copy under ignored `.e2e/`. Only an explicit
source/config allowlist is copied — `src`, `public` (installability icons and the
service worker), `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `package.json`
and `package-lock.json` — never `.env*`, `.next`, backups or credentials. Dependencies
are linked read-only by convention; the app has its own production
build and loopback server. It uses the application's default Next.js/Turbopack
production build, with shared dependency resolution inside the repository root.
Application configuration comes only from generated values and a small OS environment
allowlist. The existing development build and running server are not reused.

Fixture setup has its own deadline. Normal success, assertion failure and graceful
interruption tear down the app, gateway, verified containers/network and source
copy. Setup failure also tears down partially created resources. A forced process
kill or Docker outage can prevent cleanup; never compensate with prune/reset or
broad volume deletion. Inspect the `system.test=private-auth-v1` and unique
`system.run` labels to identify an abandoned run before manual cleanup.

The fixture requires the helper-created app and gateway origins and generated
owner configuration. Missing/invalid configuration fails closed; browser requests
to any other HTTP(S) origin are blocked. No stored authentication state is loaded
or saved. The owner logs in through the real UI and completes timezone onboarding
through the real form, with all application reads/writes subject to RLS.

## Coverage and extension

The subsequent [Quest lifecycle increment](quest-e2e.md) adds desktop-only
scenarios using this foundation; its prerequisite and validation status are
recorded separately below that task contract.

One worker, no retries, no parallel test files: the single-owner database is shared
only sequentially within a worker. Desktop tests cover anonymous protection and a
single Auth lifecycle with named steps: UI login, required onboarding, dashboard,
refresh, logout, and protection after logout. The fresh owner's accessible
progression region must show “Level system not configured.” No progression policy
or EXP mutation is manufactured for the assertion.

The mobile Chromium project runs only `*.mobile.spec.ts` (Pixel 7 emulation),
initially checking the anonymous dashboard redirect and usable login controls.
It has a separate disposable environment and never repeats desktop mutations.
Future Quest/EXP/Level/recovery specs should import the same fixture, preserve
one-worker execution and explicitly arrange their state. Add read-only mobile
navigation/visual smoke scenarios separately. Tests use accessible names, with no
application test IDs added.

## Diagnostics and CI

Screenshots, videos and traces are retained on failure in `test-results/`; the HTML
report is in `playwright-report/`. Use `npx playwright show-report` locally. These
directories, `.e2e/` and `playwright/.auth/` are ignored. Traces can contain the
disposable session/password: treat them as sensitive diagnostic files even though
the stack is destroyed, and never commit them or real credentials.

The separate E2E workflow installs Chromium only and runs lint, typecheck, Node
regressions, existing disposable auth/database regressions and browser tests.
Failure artifacts have seven-day retention. Historical eight/nine/ten-migration
checkpoint CI is unchanged. The E2E fixture performs a fresh production build;
regular `npm run build` remains the default application build command.

## Validation record — 2026-09-28

Validated on Windows with Node.js 24.18.1, Docker Desktop's Linux engine and
Playwright 1.63.0 / Chromium. Final results:

| Check | Result |
| --- | --- |
| `npm run test:e2e -- --list` | 3 tests, 2 files, desktop and mobile projects |
| `npm run test:e2e` | 3 passed, 1 worker, 1.6 minutes |
| `node --test tests/*.test.mjs` | 177 passed, no failures/skips |
| `node tests/auth-smoke.mjs` | Passed, including real refresh, logout, owner gates and RLS |
| `node supabase/tests/private-owner-wire.mjs` | 17 historical checkpoint suites and 10 security groups passed |
| `npm run lint` | Passed, zero warnings |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed using synthetic loopback configuration; no live DB dependency |
| `git diff --check` | Passed |
| Workflow YAML | Parsed successfully; historical workflow diff is empty |
| Cleanup | No labeled disposable containers/networks or application copies remain; all 9 pre-existing Docker volumes unchanged |

The two `test:e2e` rows record the foundation increment: 3 tests in 2 files (desktop
Auth plus the mobile anonymous smoke). The subsequent
[Quest lifecycle increment](quest-e2e.md) extends the same suite, so the current
repository discovers and runs 5 tests in 3 files; that increment's results are recorded
in that document and are not backfilled here.

Initial setup failures also exercised partial-resource cleanup before the final
passing runs. Generated/auth artifact paths are confirmed ignored. GitHub Actions
itself has not been executed: no commit, push, PR, merge or deployment was made.
There is no remaining local implementation blocker. Linux CI execution remains
the next verification once the Product Owner authorizes publishing the branch.
