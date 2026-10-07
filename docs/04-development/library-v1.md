# Library V1 development handoff

## 1. Task and current state

Date: 2026-10-07. Branch: `feat/library-v1`. Owner: Product Owner.
Task: L0 requirements and architecture contract only. Product decisions are
approved by the L0 request; the completed detailed contract awaits L0 sign-off.
No Library functionality, migration or tests have been implemented.

Sources of truth:

- [Requirements and acceptance criteria](../01-requirements/library-v1.md).
- [Architecture contract](../02-architecture/library-v1.md).
- ADR-023 in [decisions](../02-architecture/decisions.md).
- [Project context](../PROJECT_CONTEXT.md), [workflow](ai-agent-workflow.md),
  [testing guidance](testing.md).

The approved V1 includes optional manual cover_url and summary and uses responsive
cover-led BookCards. Do not carry forward the discovery audit's suggested deferrals
or list-row recommendation. Reading status, archived_at and optimistic revision
are separate concerns. No hard delete or Quest recovery subsystem is approved.

## 2. Base verification

Before documentation changes:

| Check | Result |
| --- | --- |
| git status --short --branch | feat/library-v1 tracking origin/main; only unrelated .vscode/ untracked. |
| git fetch origin | Succeeded on a non-interactive retry. Initial restricted attempt could not write FETCH_HEAD; an initial elevated fetch stalled and was interrupted. No merge/rebase occurred. |
| git rev-list --left-right --count HEAD...origin/main | 0 0 after successful fetch. |
| git log origin/main -3 --oneline | c7f1e72 PR #54; 4e9f8d9 PR #53; e162651 PR #52. |
| Library implementation | None found in current source/migration/test inventory; tracked worktree and index initially clean. |

The confirmed baseline is c7f1e72, containing the PR #54 SYSTEM UI foundation.
The unrelated .vscode/settings.json must remain untouched. Historical document
claims about other feature deployments are not a Library rollout authorization;
this work neither verifies nor changes those environments.

## 3. Tranche plan

Each implementation tranche should be independently reviewable and normally a
separate PR. Follow feature branches and PR review before merge; never push
directly to main. L0 does not authorize L1 or any commit/push.

| Tranche | Scope and likely files | Required validation | Non-goals | Dependency |
| --- | --- | --- | --- | --- |
| L0 - contract/documentation | The three Library documents, ADR-023 and focused PROJECT_CONTEXT entry. | Contract traceability, local links, whitespace, diff and untracked/scope audit. | No code, migrations, tests, packages, database access or commit/push. | Successful base verification; approved product direction. |
| L1 - database/domain foundation | New additive books migration; src/features/library/model.ts; SQL behavior/catalog suites; wire helper and harness registration; domain tests. | Unicode/URL/status normalization, DB lifecycle/concurrency, direct API isolation, executor/catalog, immutable history/checkpoint regression. | No routes/UI, dependencies, provider APIs, note entities, Quest recovery or rollout. | Signed-off L0 and explicit L1 authorization. |
| L2 - application boundary | src/features/library/data.ts and actions.ts; small create identity helper; action/adapter/pending-identity tests; existing auth boundary tests as needed. | Auth/profile gates, allowlisted changes, parsing, exact revision strings, bounded projections, uncertain outcomes, saved/refresh-required and identity-only reload handling. | No generic repository/recovery framework, persisted note drafts, autosave or offline edits. | L1 contract and security tests pass. |
| L3 - complete core UI | Collection/new/detail routes; BookCard, cover fallback, forms/actions; shell/proxy/dictionaries/CSS; desktop/mobile E2E. | Full create/read/edit/status/notes/archive/restore journey, cover failures, filters, two-tab conflict, response loss, EN/VI, keyboard/accessibility and 360/390/412px mobile. | No deferred features, second visual system, global lint weakening, automatic server cover fetch. | L2 boundary verified. |
| L4 - release verification | Focused defect fixes, complete regression and this handoff updated with actual results and rollout review. | All release gates, production build, clean scope/diff review, additive migration and deployment ordering. | No new features or unrelated refactoring; no unapproved deployment. | L3 complete, including mobile and accessibility. |

L3 is a complete usable core: do not expose a placeholder Library route while
create/edit/archive are absent. Mobile and accessibility belong in L3, not a later
feature PR. If a tranche is too large, split by reviewable dependency while
preserving these boundaries and never infer approval for additional product scope.

## 4. Planned file map

All paths below are future candidates, not files created by L0. Co-locate small
helpers when clearer; do not manufacture abstractions to match this inventory.

| New file/path | Responsibility |
| --- | --- |
| supabase/migrations/<new_timestamp>_create_books_v1.sql | Table, constraints/indexes, executor, RLS/grants and five focused RPCs. Choose timestamp in L1 after verifying main. |
| src/features/library/model.ts | Book/card types, field normalization/limits, statuses, archive rules, validation and response parsers. |
| src/features/library/data.ts | Authenticated server read and RPC adapters. |
| src/features/library/actions.ts | Authenticated mutation orchestration and refresh outcomes. |
| src/features/library/create-identity.ts | Minimum identity-only pending-create metadata/validation; no note drafts or Quest coupling. |
| src/features/library/book-card.tsx | One semantic responsive cover-led collection component. |
| src/features/library/book-cover.tsx | Narrow browser image/fallback boundary. |
| src/features/library/book-form.tsx | Shared create/edit fields, in-memory draft and explicit save. |
| src/features/library/book-actions.tsx | Status/archive/restore controls and feedback. |
| src/app/library/page.tsx | Protected bounded collection and scope/status query composition. |
| src/app/library/new/page.tsx | Protected creation page. |
| src/app/library/[id]/page.tsx | Protected current detail and long-form workspace. |
| src/app/library/error.tsx | Retryable route error presentation if needed; do not mask not-found/auth handling. |
| src/styles/library.css | Feature grid/card/detail/form responsiveness using SYSTEM tokens. |
| tests/library.test.mjs and tests/library-ui.test.mjs | Domain, adapter/action and semantic UI regressions. |
| supabase/tests/library-v1.sql and library-v1-catalog.sql | Behavioral and schema/security assertions. |
| supabase/tests/helpers/library-wire.mjs | Real authenticated/anonymous/non-owner RPC and direct-table tests. |
| tests/e2e/library.desktop.spec.ts, library.mobile.spec.ts and library-helpers.ts | Complete journeys using existing disposable fixtures. |

Likely existing-file changes in L1-L3:

- tests/helpers/auth-environment.mjs: explicit new migration/checkpoint registration.
- supabase/tests/private-owner-wire.mjs: invoke Library wire checks without
  weakening historical counts or changing historical activation scope.
- tests/private-auth.test.mjs and tests/auth-smoke.mjs: Library action/route gates.
- src/components/system-shell.tsx and app-header.tsx: fourth route and nested active state.
- src/lib/localization/dictionaries.ts: typed EN/VI Library and shell copy.
- src/proxy.ts: /library/:path* matcher; preserve all existing matchers/headers.
- src/app/globals.css: import library.css. Change system-shell.css only for a
  demonstrated fourth-route layout requirement, not unrelated redesign.
- tests/visual-foundation.test.mjs and tests/e2e/visual-foundation-helpers.ts:
  navigation, locale and responsive shell coverage.
- This handoff, PROJECT_CONTEXT.md and testing.md: actual implemented status and checks.

No planned package/lockfile, historical migration, Quest/progression, service
worker or broad Next Image configuration change is necessary. Any native-img lint
exception must be narrow and justified in the cover component, not a global rule change.

## 5. Future test plan and release gates

These tests are required for implementation; none was created or run during L0.

| Layer | Required scenarios | Acceptance trace |
| --- | --- | --- |
| Node/domain | Title/author boundaries, nullable normalization, Unicode and line endings, HTTPS/userinfo/scheme/length validation, status defaults/allowlist, revision range/exact strings, archived-edit guard and response parsing. | AC-01..04, 06, 09 |
| Actions/adapters | Owner/profile rejection, supplied identity cannot authorize, update allowlist, collection excludes long fields, invalid responses, transport uncertainty, draft retention, successful write with failed invalidation. | AC-05, 08..13 |
| Create identity | Same UUID until resolved, double submit, identity collision without overwrite, session metadata contains only version/userId/bookId, metadata storage failure before dispatch, reload lookup without automatic resend, changed account. | AC-10, 18 |
| SQL behavior | Create/list/detail/edit/status/archive/restore, no-op unchanged revision/time, stale revision before no-op, concurrent writers, create collision, immutable identity/owner/created_at, DB-owned updated_at, malformed fields, revision exhaustion. | AC-01..11 |
| SQL/security/catalog | Configured owner versus another authenticated identity and anon; own/cross-owner rows; missing owner configuration; direct unauthorized writes/ownership transfer/DELETE denied; executor not table owner and NOBYPASSRLS; RLS policies, fixed search_path and EXECUTE grants. | AC-12, 13 |
| Desktop E2E | Create, list/filter/paginate, detail, edit, all status directions, summary/content notes/lessons, archive/archived scope/restore, reload, duplicate creation, committed-response loss and stale conflict. | AC-01..11, 14 |
| Mobile E2E | 360/390/412 widths, same responsive cards, long titles/notes/URLs, forms/actions, >=44px targets, no horizontal overflow, keyboard/focus and touch usability. | AC-15, 16 |
| Shared/visual/localization | Both languages, typed key parity, SSR/hydration locale, nested active route, Dashboard date-aware Calendar link, broken/absent cover, SYSTEM tokens and reduced motion. | AC-04, 14..17 |

AC references mean LIB-AC identifiers in the requirements. Exercise both row-owner
isolation and configured-owner restriction separately using controlled fixtures;
non-owner denial alone is not evidence that the owner predicate works. Security
tests must hit PostgREST directly as well as Next.js actions. Test duplicate create
with identical and different payloads and after edit/archive; never assert that
an existing-identity response proves historical payload equality. Lost-response
tests must include a committed mutation whose response is dropped, not only a
pre-dispatch rejection. Use synthetic content and intercept image requests for
deterministic fallback testing; never use live third-party books services.

Use existing Node 24 test tooling, SQL/catalog scripts and the disposable
Auth/PostgREST/tmpfs PostgreSQL fixture. Add no testing dependency. Keep shared
browser/database fixtures sequential as configured. Do not run against developer
Local or Cloud, log personal notes/URLs, or read secrets into test reports.

Standard future release gates, grounded in package.json, testing.md and current CI:

| Gate | Existing command |
| --- | --- |
| Lint, zero warnings | npm run lint |
| TypeScript | npx --no-install tsc --noEmit |
| Node regressions | node --test tests/*.test.mjs |
| Disposable SQL/security | node supabase/tests/private-owner-wire.mjs |
| Auth integration and isolated production build | node tests/auth-smoke.mjs |
| Playwright desktop/mobile | npm run test:e2e |
| Production build | npm run build, using documented synthetic/disposable configuration rather than real credentials |
| Whitespace/scope/review | git diff --check; git status --short --branch; git diff --name-status; git diff --stat; full diff plus separate untracked review |

Report exact executed commands/results, skipped/unavailable checks and browser
emulation limits. An isolated production build can supply build evidence if the
same final code/configuration is covered; do not claim an unexecuted separate build.
Do not repeat historical test counts from older documentation as current results.

## 6. Rollout and order

1. Obtain L0 sign-off and a separate L1 instruction. Reverify branch/current
   origin/main; stop if behind instead of merging/rebasing automatically.
2. Implement the additive foundation and tests, inspect historical migration
   immutability and privilege cleanup, then review through a focused PR.
3. Build/test the application boundary, then the complete UI with mobile and
   accessibility. Keep navigation release coherent with working core flows.
4. Run L4 release gates on final code and document failures/limitations honestly.
5. Under separate environment authorization, apply the new migration first,
   verify guards/privileges and schema compatibility, then deploy the application.
   Do not expose navigation that calls unavailable Library RPCs.
6. Verify owner access, active/archive behavior and safe create/edit/conflict
   behavior in the authorized environment. Preserve book data on rollback.

Historical migrations and activation checksums are immutable. The harness defers
activation and some later migrations; explicitly register the new checkpoint and
post-activation checks rather than moving old suites or relaxing their assertions.
No backfill is needed. Frontend rollback retains the table and data; database
repairs use reviewed forward migrations, not automatic destructive down SQL.
This sequence is a plan, not migration/deployment permission.

## 7. Risks and implementation stop conditions

| Severity | Risk | Required handling |
| --- | --- | --- |
| High | RLS omits configured-owner restriction or executor bypasses RLS. | Dedicated non-table-owning executor; both isolation layers and direct API tests. |
| High | Long notes lost to stale or delayed writes. | Row-atomic revision guard before no-op; preserve draft; never silently update base revision. |
| High | Uncertain create receives a new identity or becomes upsert. | Stable ID; existing identity never updates fields; explicit read/review. |
| High | Historical migration or activation/checkpoint contract is changed. | New additive migration; preserve old files/assertions and add new checks. |
| Medium | URL parsing differs across layers or causes server fetch. | Shared accepted/rejected cases; syntactic validation only; no optimizer/proxy wildcard. |
| Medium | Unbounded/large collection payloads. | Field caps, bounded metadata projection and cursor pagination. |
| Medium | Revision no-op ordering permits stale archive/status replay. | Stale check precedes no-op; test opposing later mutations. |
| Medium | Sensitive drafts persist through recovery or logs. | Identity-only session metadata; plain in-memory drafts; synthetic test data. |
| Medium | Fourth navigation item/cards squeeze mobile or VI labels. | L3 mobile/locale/accessibility tests and visual review. |
| Medium | Receipt/Quest machinery or normalized notes inflate scope. | Keep one books row and focused commands; reject prohibited additions. |

Stop and report before dependent implementation if:

- The branch is wrong, origin/main is ahead, or current-base verification fails.
- Unrelated work overlaps an intended edit and cannot be safely preserved.
- Repository evidence contradicts an approved product/security contract.
- A proposed change requires historical migration edits, bypassed RLS, broadened
  privileges, a new dependency or a prohibited feature.
- Unicode/URL normalization, atomic revision behavior or non-leaking collision
  handling cannot be implemented consistently with the documented contract.
- Required disposable security tests cannot run: record the blocker and do not
  claim that foundation is verified or ready for rollout.
- Migration privileges, function ownership or helper grants cannot be verified.
- Live database/deployment access would be required without separate authority.

Approved scope is not reopened for routine implementation choices. Document any
real contradiction and request a focused decision; do not silently expand scope.

## 8. L0 artifacts and validation record

Created: this handoff, the Library requirements and Library architecture document.
Updated: decisions.md with ADR-023 and PROJECT_CONTEXT.md with a focused Library
status/link entry. No source, migration, tests or package changes are allowed.

L0 validation on 2026-10-07:

- Successful fetch and 0/0 divergence confirmed the current origin/main baseline.
- git diff --check passed. Git reports its existing LF-to-CRLF conversion advisory;
  no whitespace error was reported.
- Git status/name-status/stat and full tracked diffs were reviewed. Only the five
  approved documentation paths changed; three new documents are untracked and
  therefore were reviewed separately from ordinary git diff output.
- Local Markdown file targets and requirement/acceptance references passed checks.
- New document whitespace/content checks passed; no source, migration, test or
  package changes, and no staged changes were present.
- The pre-existing .vscode/settings.json content hash was unchanged.

Application lint/typecheck/build/Node/SQL/Playwright are intentionally not run for
documentation-only L0; no implementation validation or environment rollout is
claimed. No commit, push, merge or rebase was performed.

## 9. Remaining decisions and next authorization

No unresolved product contradiction was found. L0 sign-off covers the carried
forward proposed long-text caps, proposed 2,048-character URL bound, detailed RPC/
pagination/no-op behavior and identity-only pending-create reload design. The
native-img versus unoptimized-wrapper choice remains a bounded L3 implementation
detail; both must satisfy the approved no-server-fetch/fallback contract.

L0 readiness does not authorize L1. Stop after the documentation report; do not
create migration/code/tests or commit/push. Subsequent agents must use these
artifacts and the approved task instruction, not conversational memory.
