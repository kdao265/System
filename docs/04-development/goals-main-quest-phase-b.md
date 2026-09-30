# Goals / Main Quest V1 — Phase B

Task date: 2026-09-30. Branch: `feat/goals-main-quest-v1`.

The Product Owner's Phase B request authorizes application implementation against
[requirements](../01-requirements/goals-main-quest-v1.md),
[architecture](../02-architecture/goals-main-quest-v1.md) and ADR-020. Earlier
documentation-only task restrictions describe earlier work, not this authorization.
Phase A's migration and seven RPC contracts remain authoritative and unchanged.

Scope: protected `/goals`, list/detail/progress, metadata and archive/restore,
existing one-off attachment/detachment, reuse of Quest completion/reopen, responsive
and accessible controls, targeted tests and disposable-environment validation.
Acceptance: GM-AC-01..10 plus the requested browser cases at 360/390/412 px.
No dependencies, database redesign, real Local/Cloud access, commits, pushes, PR,
merge or deployment. No Goal completion command, EXP, recurrence, reorder, Calendar
changes, artwork, animation or global redesign. Quest creation stays in Dashboard;
the picker attaches existing Quests only.

## Application boundary

`/goals` uses the existing owner-authenticated Profile gate and onboarding check,
with private/no-store Proxy coverage. Dashboard adds one navigation link. The
dynamic server page reads `list_goals_v1` and, for `?id=...`, `get_goal_v1` through
the user-session Supabase client. Active and archived lists are separate; active
includes derived-complete Goals. UUID keyset pagination follows Phase A.

The `features/goals` adapter validates RPC summaries, ordered membership, counts,
receipt identities and decimal-string bigint revisions. Its action maps the five
mutation RPCs without direct writes or privileged credentials. No migration,
permission, RLS, Quest lifecycle, EXP or Calendar contract changes are required.

Cards and detail show metadata, completed/total count, a prominent progress bar,
percentage and textual state. Empty is 0/0, 0%, incomplete. Percentage truncates to
one decimal for display; completion uses exact counts and never the percentage.
Detail preserves server attach order, current occurrence status and membership
identities. No detached intervals are shown as current work.

## Mutations and recovery

Create/edit forms use the approved title/description limits. Archive hides the Goal
from the active list while retaining readable live progress. Archived detail hides
metadata and membership controls and offers Restore. Ordinary Quest controls stay
available because Goal archival does not archive the Quest.

The attach picker uses RLS-bound existing-table reads to filter one-off, unarchived
Quests with one compatible occurrence, no recurrence rule, no legacy parent data
and no current membership (including membership in an archived Goal). Candidate
pages scan 100 definitions at a time and expose continuation rather than silently
omitting later candidates. SQL remains authoritative. Detach names the exact link
interval; it does not delete or change the Quest. Quest creation remains the existing
Dashboard flow, linked from the picker; opening attachment creates nothing.

Before a Goal mutation is sent, its complete request is saved in account-scoped
`sessionStorage`: command ID, Goal ID, expected revision and payload. A synchronous
submission guard and disabled controls prevent duplicate in-flight submissions.
An unknown transport/receipt outcome retains this request and blocks new mutations.
Reload restores it without automatic submission; Retry sends the same intent.
Known rejections provide specific feedback for stale revision, archived Goal,
ineligible Quest and existing membership. Refresh and a new explicit decision are
required to submit changed intent. Receipt success triggers a fresh read, never a
local completion/progress update. A cache failure does not negate accepted success.

## Shared Quest integration review

- `completion-action.ts` and `reopen-action.ts`: additionally invalidate `/goals`
  after the existing commands; arguments, receipts and EXP semantics are unchanged.
- `completion-resolution-action.ts`: invalidate Goal projections after an existing
  owner-authenticated resolution read; no new mutation or retry logic.
- `completion-provider.tsx` and `reopen-recovery.ts`: accept the narrow server
  occurrence identity/cycle observation needed by stale-reopen reconciliation from
  either a day read or Goal detail. The existing recovery algorithm is unchanged.
- `completion-recovery-ui.tsx`: optional refresh location/label lets the same recovery
  panel refresh Goals; Dashboard remains the default and retains selected-day links.
- `completion-control.tsx`: location-neutral recovery wording for reuse on both pages.

Goal detail renders the existing completion provider, completion/reopen controls
and recovery panel. Advisory availability is kept in the application adapter;
the Quest RPC still decides completion eligibility. Existing browser locks,
completion resolution, cycle guards and EXP idempotency stay in the Quest system.
No Goal-specific complete/reopen command exists. Goals refresh after mutations and
on navigation, window focus and reconnection. Failed reads show unavailable progress;
offline state labels displayed progress as potentially stale.

## Mobile and accessibility

The current dark visual language is retained. Cards, fields and actions use flexible
widths, wrapping, visible focus and at least 44-pixel Goal control targets. Progress
has a named progressbar with numeric values and completed/total text. Semantic
headings, labelled inputs, buttons for mutations, links for navigation, and status/
alert feedback are preserved. Browser coverage exercises long unbroken content,
keyboard focus, touch targets and page bounds at 360, 390 and 412 pixels.

## Limitations and deferred work

Goal recovery is scoped to the current browser tab session; keep that tab open until
uncertain work is reconciled. It survives reload/navigation, not intentional clearing
of session storage. Quest recovery retains its existing cross-tab localStorage model.
There is no realtime subscription: other-device updates appear on refresh/focus.
Creation-and-attachment as one flow is deferred; create a normal Quest in Dashboard
and then attach it. Manual reorder, nested/recurring Goals, recurring Sub Quests,
weighted progress, Goal EXP/rewards, milestones/history snapshots, cinematic Dashboard,
custom artwork, animation and SYSTEM Visual UI V2 remain out of scope.

## Validation and handoff

Resumed after application implementation and initial Node/backend validation. The
remaining work was targeted browser coverage, final Auth/shared-Quest regression,
the complete final gate and workspace review. All integration runs use generated
synthetic accounts and self-owned disposable resources. No real Local/Cloud target,
database reset or global Docker prune is permitted.

Reproduced issues during implementation/validation:

- Phase A creation receipts use `revision_before: "0"`. The UI receipt validator
  initially expected null; it now accepts the actual contract and has a regression
  assertion. The migration was not changed.
- The attach select's wrapping label included option text in exact label lookup.
  Browser snapshots showed eligible options present while lookup timed out. An
  explicit `htmlFor`/`id` label association fixes the field without changing candidate
  filtering. A disposable PostgREST audit independently verified the response shape.
- Initial sandboxed Docker access was unavailable; approved runs use the existing
  disposable harness. Earlier concurrent Turbopack builds exhausted Windows resources;
  subsequent browser builds are sequential. Only the identified owned scratch copy
  and validation log were removed; pre-existing files were preserved.

The resumed backend runs passed `node supabase/tests/goals-main-quest-wire.mjs`
(catalog, behavior, seven-RPC security/replay/no-side-effects and three concurrency
scenarios) and `node supabase/tests/private-owner-wire.mjs` (23 historical migration
checkpoints and 12 security groups), both exit 0 with owned-resource cleanup.

The targeted Goals cases passed across the final targeted runs: both desktop
lifecycle/eligibility cases, the lost-response case and the mobile case. Together
they exercise empty creation; ordered attachment; 0/3 → 1/3 → 2/3 → 3/3; normal
reopen → 2/3; detach denominator changes; archive/read-only/live progress; restore
and metadata edits; existing controls in Goal detail; exclusive membership;
recurring filtering/server rejection; stale revisions; reload persistence;
duplicate-submit/exact retry; owner protection and all three mobile widths.

The full Playwright suite was interrupted mid-run earlier and was resumed on this same
working tree without any further application, test or configuration change. The resumed
run passed completely: `26 passed (6.7m)`, exit 0, one worker, no failures, no flaky or
skipped cases, no retries. It covers all desktop and mobile files, so the protected
existing behaviour is re-confirmed in the same run as the Goals cases: Dashboard Quest
completion and reopen, completion and reopen recovery, two-tab convergence with EXP
idempotency, recurring Quest completion/pause/EXP, Calendar projection and recovery,
Auth/private-owner protection, hardening and the PWA/mobile regressions at 360/390/412 px.
Failure output was empty (`test-results/.last-run.json` reports `status: "passed"` with no
failed tests), so no traces, videos or screenshots were produced.

| Final check | Result |
| --- | --- |
| `node --test tests/*.test.mjs` | PASS: 221/221, zero failures/skips, exit 0 |
| `node tests/auth-smoke.mjs` | PASS: expanded Goals protection/no-store matrix and existing Auth/Profile cases, exit 0 |
| `npm run test:e2e` | PASS: 26/26 in 6.7 min, zero failures/flaky/skipped, exit 0 |
| `npm run lint` | PASS (`eslint . --max-warnings=0`), exit 0 |
| `npx tsc --noEmit` | PASS, no diagnostics, exit 0 |
| `npm run build` | PASS: Turbopack production build, `/goals` emitted as a dynamic route, exit 0 |
| `git diff --check` | PASS, exit 0 (only informational `LF will be replaced by CRLF` notices) |

## Changed-file inventory

New application files: `src/app/goals/page.tsx`, `src/app/goals/error.tsx`, and
`src/features/goals/{actions,components,data,model,panel,quest-controls}` (`.ts` or
`.tsx`). Existing application changes are the Dashboard entry link, Proxy route
coverage and the seven shared Quest files described above.

New validation files: `tests/goals-ui.test.mjs`, `tests/e2e/goals-helpers.ts`,
`tests/e2e/goals.desktop.spec.ts`, `tests/e2e/goals.mobile.spec.ts`.
`tests/quest-completion-ui.test.mjs` updates the expected Goal cache invalidation;
`tests/auth-smoke.mjs` adds Goals to the existing protection matrix and checks its
owner response is not cached. This document is the development handoff.

## Final scope audit

`git status --short -uall` after all gates lists exactly eleven modified tracked files and
thirteen untracked files: this document, `src/app/goals/{error,page}.tsx`, the six
`src/features/goals/*` modules, `tests/goals-ui.test.mjs` and the three `tests/e2e/goals*`
files. Nothing else was added or changed.

- No migration was created or modified: `git status --short -- supabase` is empty, so
  Phase A's single migration and its seven RPC contracts remain exactly as committed.
- No dependency change: `package.json` and `package-lock.json` are unmodified.
- No environment file was created or modified. The ignored `.env.local` predates this
  work; the isolated E2E harness never reads or writes env files.
- No E2E scratch output is tracked. `.e2e/`, `test-results/` and `playwright-report/` are
  ignored; the harness removed its disposable app copies, `test-results/` holds only
  `.last-run.json`, and the only surviving ignored scratch is the earlier disposable
  PostgREST audit under `.e2e/inspect`, which is pre-existing and outside the change set.
- No screenshots, logs, backups or generated secrets were added. `.gitignore` covers
  `.env*`, and no credential appears in any added file.

The real Local Supabase stack, Cloud Supabase, `supabase_db_System` and the preserved
browser-smoke and restore-drill stacks were never contacted or altered; every integration
run used the harness's own uniquely named containers and networks on tmpfs. The resumed
suite's own environment cleaned itself up completely. The earlier abrupt interruption had
left two orphaned stopped runs of that same harness (`system-private-auth-*`, label
`system.test=private-auth-v1`, created 2026-09-29, exited 255, no mounts and no remaining
network); after verifying each container's immutable ID, label and stopped state they were
removed individually by ID, exactly as the harness's own cleanup does. No `db reset`,
`system prune` or `volume prune` was run, and every preserved volume and network still
exists.
