# Calendar Quest Timeline & Detail V1

Branch: `feat/calendar-quest-timeline-detail-v1`. Product Owner implementation authorization supersedes the initial governance-only restriction. No commits, pushes, Cloud, Supabase reset/push, or preserved Docker resources. Tests use only freshly created isolated environments.

## Approved contract / ADR-022

The Product Owner approved occurrence-level planning: `scheduled_at` remains planned start and nullable `planned_end_at` is an independent finish. Deadline and estimated workload are never interpreted as finish; no backfill or second start column. Calendar reads remain write-free. Existing recurring slots alone are eligible; generation and rule defaults remain unchanged.

This explicitly amends ADR-019's prohibition on hosting Quest scheduling in Calendar: the detail modal invokes a Quest-owned command, never Schedule Event writes or a second execution model. Complete/Reopen/retirement controls are excluded. Alternatives rejected: deriving finish from estimate/deadline, duplicating planned start, copying occurrences into Schedule Events, and adding timing defaults to recurrence rules.

Planning uses the existing owner lock, Quest lock, then occurrence lock. Expected start/end and execution cycle prevent stale edits. Exact command replay precedes current lifecycle rejection. Fresh writes require an active definition and draft/scheduled/active occurrence. Status is retained, except clearing the last date from scheduled work changes it to draft to satisfy `ck_occurrence_schedule`. No rewards, cycle, deadline, provenance, Goal membership or materialization counters change.

Audit uses `occurrence_edited`, payload version 1, command kind `occurrence_plan_v1`, exact typed request, before/after start/end/status, and changed flag. No-op commands also retain receipts. Existing append-only Quest events provide durable identity and replay; no new journal or revision column is needed.

V2 Calendar adds explicit occurrence identity and independent deadline while retaining Schedule Event semantics. Half-open interval overlap supports overnight Quests. Detail is an owner-guarded SECURITY INVOKER read, with definition text explicitly current, occurrence snapshots authoritative, current recurrence summary separate from captured provenance, and current Goal membership from retained links. Retired subjects return no detail.

Rollout requires the additive migration before frontend deployment. Historical migrations/checkpoints stay intact. Existing starts are unchanged and new ends default to null. Rollback of the UI can retain the additive backend. New planning recovery uses its own versioned, account-scoped namespace and exact persisted command requests.

## Validation

Completed 2026-10-03 in fresh disposable isolated environments only: no reset/push, no Cloud, no preserved Local project, no volume/backup changes, no historical migration edits.

- `occurrence_edited`: already an accepted Quest event type and permitted by existing quest-event guards/triggers. No schema or guard change was required; the plan command emits it under the existing append-only audit model.
- SQL/backend integration: the migration applies cleanly from current production-equivalent history. The 14 disposable SQL/backend integration tests pass, covering: planned interval constraint, the exact 09:20-11:45 interval, deadline independent of planned end, cross-midnight projection, start-only Quest, recurring occurrence planning, unchanged provenance/cycle/reward/EXP/counters, exact replay, stale expected-plan rejection, command-ID conflict, rollback atomicity, planning races with completion/Reopen/archive/recurring retirement, owner and non-owner isolation, `get_calendar_events_v2` RLS, and `get_quest_occurrence_detail_v1` RLS with Goal relation. Status cases verified: clearing `scheduled_at` with no deadline yields draft; with a remaining deadline stays scheduled; draft recurring planning does not silently change status; active stays active; completed/cancelled/failed reject fresh planning.
- SECURITY INVOKER read RPCs: authenticated SYSTEM owner reads return data; a second user's rows are not exposed.
- Commands: `git diff --check` clean (exit 0), `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs` reports **276 passing / 0 failing** (unchanged from the previous 276).
- Focused Playwright: **24 passed**. Full Playwright suite: **42 passed**, 0 failed, 0 flaky.

Fixes made during validation (all in the working tree, uncommitted):

1. `supabase/migrations/20261003180000_calendar_quest_plan_v1.sql`: moved the `quest_command_owner` release to last so the executor-owned planning function can be revoked/granted while the migration role still holds owner membership, matching the archive/delete and recurring-retirement migrations. Without this the migration aborted with `42501 must be owner of function get_calendar_events_v2`.
2. `src/features/calendar/quest-detail.tsx`: focus restoration now runs in an effect after the modal unmounts. The previous `close()` called `trigger.focus()` while the dialog was still mounted, and the surrounding `inert` page made that a silent no-op.
3. `tests/e2e/calendar-plan-helpers.ts` plus the plan desktop/mobile specs: new `retire()` archives the scenario's recurring series and one-off Quest in teardown, so running daily series no longer leak into later Calendar specs that open the Dashboard on a different fixed day and materialize extra Month-cell entries.
4. `tests/e2e/calendar.desktop.spec.ts`: the Quest agenda row now legitimately exposes its "Quest detail" trigger, so the Schedule Event assertion was narrowed to "no Edit controls on a Quest row" instead of "no buttons at all".

Remaining risk: platform tooling (`supabase db push`/`supabase db reset`, checksum verification) is prohibited and was not run; migration validation used disposable environments applying the full production-equivalent history instead, and no historical migration was modified. The migration, its tests and the frontend fixes are uncommitted, so the approved rollout order (additive migration before frontend deployment) still applies. The focus-restoration fix and fixture teardown were validated by the suites above, not by additional manual keyboard/screen-reader testing.
