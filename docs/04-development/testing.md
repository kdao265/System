# Testing and verification

Validate against agreed acceptance criteria and business rules. Choose checks proportional to the change and record actual results in the PR or handoff.

## Intended coverage when implementation exists

- Domain tests: state transitions, EXP/money separation, penalty waiver rules, no recursive escalation, criteria evaluation, and evidence verification boundaries.
- Integration tests: persistence and access enforcement, including RLS; external adapter mapping, retries, duplicates and conflicts once specified.
- UI tests/manual review: critical user journeys, error/empty/loading states, accessibility, and correct distinction between estimates and verified data.
- Deployment review: Vercel preview before production merge when available; report when unavailable.

Use synthetic or redacted fixtures. Do not use production secrets or perform destructive operations against live data for testing.

## Available checks

| Check | Current status |
| --- | --- |
| Lint | `npm run lint` (ESLint, zero warnings permitted) |
| Typecheck | Included in `npm run build` with strict TypeScript configuration |
| Local Auth/Profile integration | `node tests/auth-smoke.mjs`; owns disposable Auth/PostgREST/tmpfs PostgreSQL and production app; tests private auth without existing Local/Cloud or retained accounts |
| Database SQL behavior and catalog suites | `node supabase/tests/private-owner-wire.mjs`; applies every migration to disposable Auth/PostgREST/tmpfs PostgreSQL, replays all 19 migration-checkpoint suites, then applies the ADR-015 stage-two activation and its 10 database/security groups. The recurring Quest suites are `supabase/tests/recurring-quests-catalog.sql` and `supabase/tests/recurring-quests.sql`; see [Recurring Quests V1](recurring-quests-v1.md) |
| Private Auth/action boundaries | `node --test tests/private-auth.test.mjs`; all protected actions, owner configuration, disabled signup and cookie rejection |
| Application regression suite | `node --test tests/*.test.mjs` |
| Browser Auth/dashboard + mobile smoke | `npm run test:e2e`; see [isolated Playwright setup and safety](playwright-e2e.md) |
| PWA installability and phone layout | Part of `npm run test:e2e`: manifest metadata, required icon/asset responses, service-worker script and 360/390/412 px layout checks in the mobile project; see [Personal Beta PWA](personal-beta-pwa.md) |
| Explicit TypeScript check | `npx tsc --noEmit` |
| Runtime timezone validation | `node --test tests/timezones.test.mjs` (Node.js 24, no database needed) |
| Build | `npm run build`; `npm run start` serves the resulting production build |

For documentation-only changes, inspect required content, relative links, templates and the file tree. Run `git diff --check`, `git status`, and `git diff --stat`; ordinary diffs do not include untracked files, so read those separately. No application tests are warranted for this initial documentation setup.

Report the checks performed, results, unavailable checks and unresolved risks. A planned test or unavailable tool must never be reported as a pass.

## Recurring Quests V1 application validation

Run `node --test tests/recurring-migration.test.mjs` for the checked-in additive migration,
owner enforcement, privilege and historical-checkpoint static checks. The full
`node --test tests/*.test.mjs` includes exact v2/v3 creation recovery, recurring request and
receipt validation, pause/resume persistence and action authorization/error boundaries,
and server materialization-before-read behavior. Existing assertions remain intact.

The disposable `node supabase/tests/private-owner-wire.mjs` executes the recurring catalog
and behavior suites only after migration `20260928181000`, preserving all historical
checkpoints. The behavior suite also covers creation replay after pause/timezone changes.
`npx playwright test --list` discovers 16 tests. `npm run test:e2e` adds two desktop
recurring journeys and one mobile-control journey to the existing 13 Auth/Quest/EXP/PWA
checks, including actual committed-response loss and exact recovery. Owner login is an
automatic per-test Quest fixture, so importing the fixture from multiple specs is safe.
Run browser suites sequentially: they share the configured report/artifact directories.
See [final results and limitations](recurring-quests-v1.md#validation-performed).
