# Library V1 development handoff

## 1. Task and current state

Date: 2026-10-08. Branch: `feat/library-v1`. Owner: Product Owner.
Current task: resume and complete the in-progress L1 database/domain foundation
under the Product Owner's explicit takeover instruction and approved L0 contract.
The foundation and its tests are implemented; final validation is recorded below.
L2/application adapters, routes, UI, localization and navigation remain unstarted.
No commit, push, merge, dependency change or environment rollout is authorized.

Sections 2-9 retain the L0 baseline and tranche plan as history. The requirements,
architecture and ADR-023 remain the approved contract; their implementation-absent
statements describe L0, not the current working tree. See section 10 for L1 evidence.

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

## 10. L1 takeover and implementation record (2026-10-08)

### Authorization and initial inspection

The Product Owner explicitly authorized completing the existing L1 work only,
without restarting/reverting it, beginning L2, committing or pushing. The initial
status was feat/library-v1 tracking origin/main, ahead by the L0 documentation
commit 0551fa2. A successful fresh fetch confirmed divergence 1/0 against c7f1e72
(PR #54). Tracked diff/name-status/stat were empty. Separate untracked inspection
found the model, migration, domain tests and two SQL fragments, plus unrelated
.vscode/settings.json. Every partial Library file was read before editing.

| Inherited artifact | Finding and disposition |
| --- | --- |
| src/features/library/model.ts | Substantial pure domain implementation: normalization, field validation, HTTPS syntax, code-point limits, exact revision strings, archive predicate and strict response parsers. All eight inherited Node tests passed. Preserved the model unchanged. |
| supabase/migrations/20261007120000_create_books_v1.sql | Substantial additive table/RLS/five-RPC implementation retained. Real SQL exposed a missing is_owner EXECUTE grant: managed ADMIN-only membership had been mistaken for usable inherited authority. Changed the grant predicate from MEMBER to USAGE and verified membership restoration. Review also found SQL accepted an empty DNS host after removing the final dot; now rejects it, with shared regression fixtures. |
| tests/library.test.mjs | Eight useful tests retained and extended to nine; shared normalization/URL corpus extracted so Node and actual PostgreSQL receive the same cases. Added Unicode URL boundary coverage. |
| supabase/tests/library-books.sql | Unfinished/malformed fragment: wrong helper arities, invalid JSON operators, no authenticated fixture context and no completed DO/transaction. Replaced with executable lifecycle/normalization/concurrency-guard/query-plan assertions. |
| supabase/tests/library-books-catalog.sql | Tiny incomplete fragment, no executable suite. Completed schema, grant, policy, role and runtime isolation tests. |
| Wire/checkpoint registration | Absent. Added the Library wire helper and explicit post-activation migration/test checkpoint in the existing disposable harness. No duplicate Library endpoints, tables or competing implementation were introduced. |

### Implemented boundary and access-control review

One public.books table has the approved plain-text fields, immutable UUID/owner/
created_at, positive bigint revision, status CHECK, restrictive owner FK and unique
(id,user_id) key. Active and archived owner-leading created_at/id partial indexes
support bounded metadata-only list pages; detail alone includes long text.

The five public entries are create_book_v1, update_book_v1,
set_book_archived_v1, get_book_v1 and list_books_v1. Updates accept only explicit
editable keys; null clears nullable text, omitted fields are preserved, and empty
updates reject. Both revision and archived-edit guards precede no-op acceptance.
Actual changes increment revision once and use database timestamps. Archive/restore
preserve content/status. Revision exhaustion rejects actual changes; no-ops remain
valid. Create uses caller-retained UUID plus INSERT ON CONFLICT DO NOTHING, returns
created/existing identity, and never overwrites even after editing or archival.
Foreign collisions return the same unavailable response as absent detail IDs.

The dedicated library_command_owner is NOLOGIN/NOBYPASSRLS and owns only the three
write routines, never books. It receives SELECT, column-limited INSERT/UPDATE and
necessary identity/owner/value helper privileges, with no DELETE/TRUNCATE, schema
CREATE, client membership or other-domain grants. Authenticated gets RLS-bound
SELECT and the five RPC EXECUTEs only. Reads are SECURITY INVOKER; writes are
SECURITY DEFINER with fixed pg_catalog search_path. Each RPC checks configured
owner and request identity. Owner policies plus the restrictive system_single_owner
policy protect both runtime roles. Anonymous, service-role and other-domain
executor privileges are revoked. Missing identity/configuration fails closed.

URL validation is syntax-only, with no fetch, DNS lookup or external service. The
shared subset accepts ASCII DNS/punycode, canonical IPv4 and bracketed IPv6,
optional ports 0..65535 and Unicode paths/query/fragment. It rejects credentials,
empty userinfo, empty/invalid hosts, repairable slash/backslash/whitespace forms,
unsupported schemes and over-limit values. Unicode DNS can be entered as punycode.
The approved explicit whitespace set, LF normalization and code-point counting are
identical across TypeScript and SQL. PostgreSQL/PostgREST reject NUL/lone-surrogate
encoding before storage; the application rejects it before dispatch.

### Validation coverage and checkpoint order

The harness excludes the new migration from its early filename loop. With normal
owner activation it applies Library after recurring schedule defaults. The private-
owner runner applies it explicitly after the historical ADR-015 catalog/security
checks. The frozen 19-policy assertion and all historical suite registrations stay
unchanged. The Library checkpoint adds its own catalog and behavior suites, checks
that every existing public RPC body/identity/ACL is unchanged, and checks borrowed
membership restoration. No historical migration/checksum is modified.

SQL tests cover create/defaults, every text cap, Unicode/line endings, malformed
fields/encoding, all status transitions, nullable clearing, stable creates after
edit/archive, stale-equal writes, no-op full-row preservation, archive/restore,
foreign collisions, filtered cursor pages, invalid list input and bigint exhaustion.
Actual EXPLAIN ANALYZE queries under owner RLS, with 4,000 rollback-only synthetic
rows, select the expected active/archive index with and without a status filter.
This is representative query-plan evidence, not a production benchmark.

Catalog/runtime tests check exact columns, constraints/indexes, RLS predicates,
helper/RPC ACLs, restricted role attributes, nonownership, immutable-column grants,
no unrelated data privileges, forged writes, missing identity/configuration and
non-vacuous own/foreign rows. The real Auth/PostgREST helper adds simultaneous
same-ID creates, differing revision writes, edit/archive races, 50/100-row bounds,
page traversal, exact bigint transport above Number.MAX_SAFE_INTEGER and shared
Node/SQL normalization/URL cases. A transport wrapper consumes a successful actual
HTTP response before discarding it: committed create/edit/archive state is read
back and stale retries cannot overwrite later changes. Unrelated Quest/EXP/Goal/
reward state is compared before/after. Private-owner unbootstrap repeats all five
Library RPC denials and table invisibility.

### Final checks

All L1 gates below passed. Docker Desktop was initially stopped and was started
for the disposable harness. Initial database failures found the missing helper
grant and test-fixture defects; those were corrected before the successful final
SQL/wire run. No unavailable security gate or unresolved L1 defect remains.

| Executed command/check | Result |
| --- | --- |
| git -c credential.interactive=false fetch origin; git rev-list --left-right --count HEAD...origin/main | Successful fetch; 1/0, existing L0 commit only. |
| npm run lint | Passed with zero warnings; rerun after final test refinements. |
| npx --no-install tsc --noEmit | Passed. The domain model was unchanged afterward. |
| node --test tests/*.test.mjs | 353/353 passed. |
| node --test tests/library.test.mjs | Final focused rerun: 9/9 passed after URL corpus/boundary refinements. |
| node supabase/tests/private-owner-wire.mjs | Final run passed all 25 SQL checkpoint suites and 13 database/security groups; own disposable resources removed. |
| node tests/auth-smoke.mjs | Passed existing Auth/application smoke, normal full migration order and isolated production build; own disposable app/containers/network removed. |
| git diff --check; tracked diff review; separate untracked review | Passed; no whitespace errors. New files also checked for trailing whitespace, NUL/BOM and updated document links. |
| Scope/preservation audit | No historical migration, package/lockfile, route/UI/CSS/localization/proxy changes; no staged changes. Unrelated .vscode/settings.json SHA-256 unchanged. |

No separate npm run build is claimed: the auth-smoke command built an isolated copy
of the final application using synthetic disposable configuration. Playwright was
not run for this foundation-only tranche; there is no Library UI to exercise.
Browser/mobile/locale coverage remains an explicit later-tranche gate.

### Files delivered in the working tree

| File | L1 disposition |
| --- | --- |
| [model.ts](../../src/features/library/model.ts) | Inherited untracked domain model retained unchanged. |
| [books migration](../../supabase/migrations/20261007120000_create_books_v1.sql) | Inherited additive migration corrected in place, never deployed. |
| [domain tests](../../tests/library.test.mjs) | Retained and extended. |
| [shared fixtures](../../tests/helpers/library-fixtures.mjs) | Added for identical Node/wire acceptance cases. |
| [SQL behavior](../../supabase/tests/library-books.sql) | Completed malformed partial suite. |
| [SQL catalog/security](../../supabase/tests/library-books-catalog.sql) | Completed partial suite and runtime role matrix. |
| [Library wire helper](../../supabase/tests/helpers/library-wire.mjs) | Added real transport/concurrency/security coverage. |
| [disposable harness](../../tests/helpers/auth-environment.mjs) | Deferred Library migration/checkpoint and legacy privilege/RPC preservation checks. |
| [private-owner runner](../../supabase/tests/private-owner-wire.mjs) | Invokes Library after frozen checks and repeats fail-closed tests. |
| [project context](../PROJECT_CONTEXT.md), [testing guide](testing.md), this handoff | Current status, validation and next-tranche boundaries. |

Final state remains uncommitted on feat/library-v1. No commit, push, merge, rebase,
application deployment, Local database change or Cloud operation was performed.

### Delivery limits and next tranche

Only disposable synthetic Auth/PostgREST/tmpfs PostgreSQL resources are authorized
for validation; no developer Local or Cloud database was contacted. There is no
Library UI or application data/action adapter yet. L2 must implement the approved
auth/profile gates, typed errors, identity-only pending-create metadata and saved/
refresh-required outcomes; those are not claimed as L1 behavior. Mobile, EN/VI and
Library end-to-end UI acceptance belong to L3/L4. Migration rollout and any later
commit/push require separate authorization. Preserve book data on rollback.

## 11. Pre-L3 L2 blocked-create identity follow-up (2026-10-08)

Task contract: the Product Owner authorizes a narrow follow-up on feat/library-v1
at fca1c5b. Invalid stored metadata or a changed account currently blocks create
preparation with no explicit cleanup path. Add a feature-local blocked-state
cleanup helper and focused identity tests, preserving the stable-ID contract in
[architecture section 6](../02-architecture/library-v1.md#6-create-identity-and-uncertain-outcomes)
and LIB-AC-10/18 in the [requirements](../01-requirements/library-v1.md).

Accept only a valid verified account ID; remove only the Library pending-create
key when its current read is invalid_identity or account_changed. Never remove a
ready identity, expose stale metadata or persist draft content. Empty storage may
report cleared; read/remove/verification errors must fail closed. Tests must cover
malformed JSON/shape/extra keys/version, account changes, ready-ID preservation,
unrelated keys and storage failures while preserving existing identity tests.

Scope is create-identity.ts, library-identity.test.mjs and this task/validation
record. No L3, migration/DB-contract changes, changes to actions/data/contracts/
model, dependencies, commits, pushes, merges, rebases or deployment. Preserve the
user-owned untracked .vscode directory. Run focused identity and combined Library
tests, lint, TypeScript, diff checks and the full Node suite if reasonable. Stop
for Product Owner review with uncommitted changes and actual validation results.

Implemented: clearBlockedCreateIdentity checks the supplied verified account ID
before reading storage, returns resolution_required without removal for ready
identities, and removes only invalid_identity/account_changed metadata. It returns
cleared for empty storage or verified removal, and storage_unavailable on read,
removal or verification failure. No stale payload is returned or persisted. The
caller remains responsible for supplying the currently verified account. Existing
prepare/read/clear behavior and all six original identity tests are unchanged.
There is no UI wiring in this follow-up.

Validation on the final source/test changes:

- node --test tests/library-identity.test.mjs: 15/15 passed.
- node --test tests/library-application.test.mjs tests/library-identity.test.mjs:
  38/38 passed.
- node --test tests/*.test.mjs: 391/391 passed, none skipped.
- npm run lint: passed with zero warnings.
- npx --no-install tsc --noEmit: passed.
- git diff --check: passed; only the existing LF-to-CRLF advisory was emitted.

Local commands required the approved escalated runner because sandbox process
startup failed before execution. No database, browser, build or deployment check
was needed for this helper-only change. Diff review confirms only the three scoped
files changed; nothing is staged. HEAD remains fca1c5b on feat/library-v1, and the
untracked .vscode/settings.json SHA-256 is unchanged. No L3, migration/DB-contract,
actions/data/contracts/model or dependency change, commit, push, merge, rebase or
deployment occurred. Stop for Product Owner review.
