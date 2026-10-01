# Quest Archive/Delete V1 debugging

Task contract (2026-10-02), branch `feat/quest-archive-delete-v1`: diagnose
successful archive leaving Daily Quests and Calendar visible; implement durable
browser command recovery following Quest creation. Scope includes focused source,
tests and a backend projection correction only if demonstrated necessary.
No commits, pushes, resets, database pushes, dependency additions, or removal of
databases, volumes, preserved stacks or diagnostic artifacts.

Authority: Quest history/archival requirements, ADR-010 application boundaries,
ADR-015 owner enforcement and the Product Owner's Archive/Delete V1 continuation
request. Existing staged work must be preserved.

Initial evidence: the retained failure snapshot contains both `Quest archived.`
and the newly archived row, alongside the active daily/calendar rows. Both active
SQL projections join `quests` without an `archived_at IS NULL` predicate. The
Archived Quests adapter explicitly selects non-null `archived_at`. The action
currently generates a new UUID on each submission, unlike creation recovery.

Acceptance: active and archived projections converge without a full reload;
same-command retries survive unknown responses, reloads and disappearing rows;
completed deletion guidance and Profile timezone formatting are accurate.
Validate lint, build, focused UI/backend E2Es and affected regressions; retain
test resources/artifacts and record exact results below.

## Findings and correction

Confirm archive submitted the form to `manageQuest`, authenticated the owner,
called `set_one_off_quest_archived_v1`, validated its receipt, invalidated
`/dashboard`, `/goals` and `/calendar`, and returned
`{ outcome: "success", operation: "archive", replay: false }`. The original
snapshot's success feedback and archived row agree with that path. The new
response-loss browser test also inspects a real successful action response before
dropping it and verifies `replay: true` on recovery.

This was a projection contract bug, not a timeout or failed invalidation.
Fresh owner-authenticated RPCs after archive returned the archived Quest in both
`list_day_quest_occurrences` and `get_calendar_events`. The archive timestamp was
non-null. The preserved failing reproduction is under
`test-results/management-debug-before/`. Archived Quests uses a separate raw-table
read with an explicit non-null archive filter, explaining why it updated while
both active views kept returning the row.

Neither active adapter uses React cache, unstable_cache or global memoization.
Auth/Profile use per-render React cache; the dashboard is force-dynamic and the
Supabase clients are request-scoped. Refresh triggers server reads; invalidating
the same incorrect SQL cannot fix their results. Existing `/calendar`
invalidation is retained. There was no original client/server action-boundary
failure and no receipt shape mismatch.

Added `20261002023000_quest_active_projections.sql`, leaving every historical
migration and both mutation RPCs unchanged. The only read semantics change is
`q.archived_at IS NULL AND q.deleted_at IS NULL` in each Quest projection.
Signatures, ownership, ACLs, SECURITY INVOKER, STABLE, search_path, owner entry
guards, date logic, ordering and the Schedule Event branch remain intact. The
test harness compares routine catalog properties before/after this migration.
This is a correctness repair within the existing read architecture, not a new
authorization model. No RLS policy or privilege is widened.

Deployment requires applying this additive migration after private-owner
activation. The test harness already defers activation for fixture provisioning;
it now applies the projection correction after that step so activation can still
verify the historical routine checksum. No developer Local or Cloud database was
modified; the new migration has only been applied to newly generated E2E stacks.

The old action allocated a fresh UUID on every submission, had no durable pending
record, and advised refreshing before another request. It could therefore issue
a new mutation after an earlier commit whose response was lost. Management now
uses an account-scoped localStorage record, immutable exact payload, verified
persist-before-send, navigator.locks, and an account-keyed Dashboard provider.
The global recovery panel survives disappearance of the active or archived row.
New deterministic rejections clear their record; transport uncertainty and
rejections of an uncertain retry retain it. Confirmed receipt replay clears it.
Unreadable/changed storage or missing coordination fails closed. Auth changes
invalidate in-flight callbacks without clearing the previous account's record.

During implementation, browser validation exposed a streamed hydration mismatch
in the new store subscription. A fixed server snapshot, matching the existing
completion/reopen pattern, ensures late-hydrating controls transition from the
disabled server state to recovered client state correctly.

Tests also needed two narrow corrections: ensure an already-open action menu
stays open after Reopen; wait for `Daily Quests[aria-busy=false]` before absence
assertions after reload. The latter prevents a loading placeholder from falsely
passing a removal check, explaining the earlier backend browser test's inadequate
projection coverage. Direct authenticated projection assertions now cover it.

## Validation and resource preservation

All E2E commands use `SYSTEM_E2E_PRESERVE=1` and unique
`SYSTEM_E2E_OUTPUT_DIR` / `SYSTEM_E2E_REPORT_DIR` paths. This stops app processes
and gateways at teardown but retains running tmpfs databases, their sibling
containers/networks and application copies. Existing artifacts are untouched.
No database, Docker volume, backup or preserved stack was deleted.

Focused UI E2E: 2 passed (1.2 minutes), artifacts under
`test-results/management-debug-ui-3/`. Coverage includes archive/restore/archive/
delete without reload, active and archived completed guards, Restore -> Reopen ->
Delete, exact EXP, retained audit, Profile-zone timestamps, and lost successful
archive/delete responses followed by reload and global exact-command replay.
Each lost-response case verifies exactly one event for the original command ID.

Final validation:

| Command | Result |
| --- | --- |
| `git diff --check` and `git diff --cached --check` | PASS |
| `npm run lint` | PASS, zero warnings |
| `npm run build` | PASS, including TypeScript |
| `npm run test:e2e -- tests/e2e/quest-management.desktop.spec.ts --project=desktop-chromium` | 2 passed, 1.2m |
| `npm run test:e2e -- tests/e2e/quest-delete.desktop.spec.ts --project=desktop-chromium` | 1 passed, 1.0m |
| `node --test --test-reporter=dot tests/quest-management.test.mjs tests/quest-creation-ui.test.mjs tests/quest-completion-ui.test.mjs tests/daily-quests.test.mjs tests/calendar.test.mjs` | 172 passed |
| `npm run test:e2e -- tests/e2e/quests.desktop.spec.ts tests/e2e/calendar.desktop.spec.ts --project=desktop-chromium` | 5 passed, 1.5m |

Backend and regression artifacts are under
`test-results/management-debug-backend-final/` and
`test-results/management-debug-regression/`; reports use matching directories
under `playwright-report/`. Earlier reproduction and intermediate failures were
retained. Intermediate lint warnings (unused test destructuring), the test-only
App Router context omission, menu toggling and response instrumentation issues
were corrected before the final passing runs. No timeouts or production
assertions were relaxed to hide the original projection failure.

Files changed by this debugging task (the index's pre-existing staged changes
were not reset or restaged):

- `src/features/quests/management-action.ts`
- `src/features/quests/management-control.tsx`
- `src/features/quests/management-lifecycle.ts` (new)
- `src/features/quests/management-provider.tsx` (new)
- `src/features/quests/archived-panel.tsx`
- `src/app/dashboard/page.tsx`
- `src/lib/localization/dictionaries.ts`
- `supabase/migrations/20261002023000_quest_active_projections.sql` (new)
- `tests/quest-management.test.mjs` (new)
- `tests/daily-quests.test.mjs`
- `tests/e2e/quest-management.desktop.spec.ts`
- `tests/e2e/quest-delete.desktop.spec.ts`
- `tests/helpers/auth-environment.mjs`
- `playwright.config.ts`
- `docs/04-development/quest-management-debugging.md` (new)

Reviewed but unchanged here: management RPC adapters/receipt validators, active
and archived read adapters, Quest components, creation/recovery implementations,
the staged login helper/tsconfig changes, and the original archive/delete
migration. No fake Edit action was added. Both languages now distinguish current
completion from historical completion and guide archived completed work through
Restore -> Reopen -> Delete. Archived timestamps use the supplied Profile zone.

Known limits: browser durability remains subject to localStorage retention; a
user clearing storage and closing all tabs loses browser recovery provenance.
Cross-device recovery and reconciliation of permanently corrupt/conflicting
records are not introduced. As in creation recovery, a rejection during retry
does not prove a previous attempt failed and remains unresolved. The new
projection migration must be deployed before relying on corrected active reads.
