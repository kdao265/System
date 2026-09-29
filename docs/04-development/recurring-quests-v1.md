# Recurring Quests / routines V1

Task: implement Daily, Weekly (selected weekdays) and Monthly recurring Quests on
`feat/recurring-quests-v1` per [ADR-018](../02-architecture/decisions.md), RR-01..RR-07 and
AC-32/AC-33/AC-39/AC-40. Status: database and application surface implemented and validated
for PR #39. ADR-018 is Accepted / Implemented in the repository; IDEA-006 is resolved.
The work remains uncommitted and undeployed.

## Application task contract (2026-09-29)

Complete creation, recovery, daily materialization and pause/resume in the existing
Dashboard, preserving ADR-015 and the single occurrence/completion/EXP pipeline.
The Product Owner accepted ADR-018 and authorized a versioned pending contract.
Keep exact v2 one-off records and their keys unchanged; add exact v3 recurring records
under the same origin-wide lock, enumerate both versions, and replay each original
command without migration or reinterpretation. Widening v2 would break its frozen
shape; replacing v2 would strand recoverable commands. This additive strategy avoids
both. Calendar dates remain server-interpreted in the current Profile timezone.
Add durable exact pause/resume retries and focused Node/browser tests. Do not edit
recurrence schedules, add dependencies, redesign SQL, commit, push, deploy, or touch
the real Local/Cloud databases. Acceptance is the full validation set and UI lifecycle
specified in the PR #39 task, including existing one-off/Auth/EXP/PWA regressions.

## What was added

One additive migration, [20260928181000_create_recurring_quests.sql](../../supabase/migrations/20260928181000_create_recurring_quests.sql).
It creates no table, column, constraint, index, policy, role or grant on a pre-existing object
and does not modify any previously applied migration. Two composite receipt types and four
routines are added.

| Routine | Kind | Purpose |
| --- | --- | --- |
| `public.create_recurring_quest(command_id uuid, request jsonb, origin text)` | SECURITY DEFINER, `quest_command_owner` | Creates one recurring definition, its single current rule and exactly two events. Never materializes an occurrence. |
| `public.materialize_quest_day(p_day date DEFAULT NULL)` | SECURITY DEFINER, `quest_command_owner` | The only generation trigger. Lazily materializes at most one occurrence per eligible rule for one profile-local day; returns how many were created. |
| `public.set_quest_recurrence_pause(command_id uuid, quest_id uuid, paused boolean, origin text)` | SECURITY DEFINER, `quest_command_owner` | RR-07 pause/resume of one series. Never archives, deletes or rewrites an occurrence. |
| `public.list_recurring_quests()` | STABLE, SECURITY INVOKER | Owner-scoped projection of the recurring definitions and their pause state. |

A recurring occurrence is an ordinary `quest_occurrences` row, so completion, reopen and EXP go
through the unchanged `complete_quest_occurrence` / `reopen_quest_occurrence_v2` commands and the
unchanged `exp_ledger`. There is no second Quest engine.

## Creation contract

The request surface is closed. Allowed keys are `title`, `description`, `importance`,
`priority`, `default_difficulty`, `default_estimated_duration_minutes`, `default_energy_cost`,
`default_focus_demand`, `default_reward_exp`, `tags`, `notes`, `recurrence_mode`, `start_date`,
`end_date`, `weekdays`, `month_day`, `occurrence_limit`. Anything else — Goal, Project, Penalty,
an absolute one-off instant, an unknown key — rejects with `22023` rather than being dropped.

- `recurrence_mode` is `daily`, `weekly` or `monthly`. `start_date` is the required inclusive
  anchor; `end_date` is inclusive when supplied and may not precede the anchor.
- `weekly` requires `weekdays`, one to seven distinct ISO weekdays 1 (Monday) to 7 (Sunday);
  they are sorted and deduplicated and stored as the already-constrained rule type
  `selected_weekdays`. `monthly` requires `month_day` 1..31. Supplying the other mode's
  parameter rejects rather than silently dropping it.
- The cadence is stored twice by design: `quests.recurrence_mode` is the user-facing cadence and
  `quest_recurrence_rules.recurrence_type` is the frozen stored discriminator.
- `origin` is attribution only and is validated with `progression_internal.require_origin`. A
  retry may arrive under a different valid origin; the recorded payload is never rewritten.
- Replaying the identical `command_id` returns the recorded receipt with `replay = true` and
  writes nothing, including after a later pause or Profile-timezone change. The recorded
  creation timezone is validated as historical provenance and is never rewritten or
  compared to the current Profile timezone. Reusing a `command_id` with a different request, or with a tampered event
  payload, rejects with `23505`.

## Materialization rules

`materialize_quest_day` is deterministic through three ordered layers: the shared owner advisory
lock (`progression_internal.lock_owner`), the Quest row `FOR UPDATE` around the limit check and
counter increment, and `ON CONFLICT (quest_id, source_slot_date) DO NOTHING` against the frozen
partial unique index `uq_recurring_slot` with `GET DIAGNOSTICS ... ROW_COUNT` deciding whether
`quests.materialized_occurrence_count` moves.

- Only the profile-local **today or a later** requested day generates. A past day that was never
  materialized is skipped silently, without backfill and without consuming `occurrence_limit`
  (section 18.2, RR-05, AC-33). Slots already materialized on their own day are untouched.
- Daily steps every day, weekly matches ISO weekdays 1-7, monthly uses `month_day` and falls back
  to that month's last valid day while retaining the intended day for the next long month
  (RR-07, AC-32). The slot key is the resulting calendar date, so a fallback cannot duplicate.
- A generated slot is an unscheduled `draft` with a null `scheduled_at` and `deadline_at`. It
  carries a calendar day, never an invented instant: section 18.4 forbids manufacturing a
  deadline and the frozen `ck_occurrence_schedule` check requires an instant before a status may
  be `scheduled`. `draft` is already completable for both the advisory day projection and the
  atomic completion command, so completion and EXP are unchanged.
- Archived Quests, stopped (paused) rules, days before the anchor, days after the end date and
  rules already at their cumulative limit all yield nothing.
- No cron, worker, queue, background job or precreation horizon exists.

## Pause and resume

Pausing sets `quest_recurrence_rules.stopped_at` and writes one `recurrence_stopped` definition
event; resuming clears it and writes one `recurrence_changed` event. Neither archives the
definition, removes an occurrence, reverses EXP or increments the rule revision. A fresh command
that finds the series already in the requested state writes nothing and returns `replay = false`
with a null `state_event_id`; replaying an accepted command returns its recorded receipt with
`replay = true`. Both payloads record the old and new rule state and the effective boundary, and
an accepted pause still replays after a later resume.

## Authorization

Every routine runs `system_private.require_owner()` before any other work, because the deferred
ADR-015 stage-two activation guards only its frozen pre-existing RPC list. Identity comes only
from `system_internal.request_user_id()`; no routine accepts a caller-supplied owner. `anon`,
`service_role` and the three internal command roles hold no EXECUTE.

`public.list_day_quest_occurrences(date)` is deliberately left byte-identical: the promoted
activation migration pins its exact source hash, and the historical day-read suites assert its
catalog shape. Recurrence therefore enters the read path through the sibling routine, and a
generated slot becomes visible through the existing day projection because day membership
already includes `source_slot_date = D`.

## Deliberate deviations

- Materializing a slot writes no Quest Event. The frozen `ck_event_type` vocabulary has no
  slot-generation kind and inventing one would widen the accepted domain-event contract.
  Provenance lives in `recurrence_rule_id`, `recurrence_revision`, `source_slot_date`,
  `source_timezone`, the cumulative counter and `quest_occurrences.created_at`. Definition changes
  do write events: `created` plus `recurrence_changed` on creation, and `recurrence_changed` or
  `recurrence_stopped` on pause/resume.
- Rule edits are outside V1. No routine changes a rule after creation; `revision` therefore stays
  1. The cumulative counter contract of section 18.2 and AC-40 is still implemented and tested.

## Application surface and recovery

The existing Create Quest form selects One-off, Daily, Weekly or Monthly. One-off
keeps its existing absolute planned-start/deadline fields and command. Recurring
forms collect title, EXP, inclusive start and optional inclusive end, plus accessible
weekday checkboxes for Weekly or day 1 to 31 for Monthly. Description, importance and
priority remain available. Mode-inapplicable fields are omitted from the request.
Input-shape validation lives outside React; eligibility and monthly fallback run
only in PostgreSQL.

The Dashboard calls `materialize_quest_day(selectedDate)` before the unchanged day
projection. Errors fail closed through existing day-panel recovery. Generated rows
are identified as recurring and use the unchanged Complete/Reopen controls, completion
aliases, recovery coordinator, cycle guards and EXP ledger. A compact Recurring Quests
section shows cadence and pause state independently of selected-day occurrences.
There is no separate management page.

Pending creation records are additive and versioned:

- One-off: exact existing `version: 2` envelope and seven-field request at
  `system.quest-creation.pending.v2:<userId>:<commandId>`.
- Recurring: `version: 3`, the same envelope identity/timezone keys, and a closed
  recurring request at `system.quest-creation.pending.v3:<userId>:<commandId>`.
  The common fields are title, description, importance, priority, default_reward_exp,
  recurrence_mode, start_date and end_date; only Weekly adds sorted unique ISO weekdays,
  and only Monthly adds month_day. No one-off instants are accepted in v3.
- Both namespaces are enumerated under the existing origin-wide Web Lock. Stored
  version/request/key mismatches, duplicate command identities, corrupt records and
  unsupported v1 data block creation without deletion or conversion. Existing v2
  snapshots retain their original bytes, keys and replay behavior.
- Recovery restores cadence, dates and selections. Dispatch/retry preserves the same
  command ID and normalized request; uncertain transport, RPC errors and malformed
  receipts retain it. Account verification occurs server-side before RPC. New requests
  retain Profile-timezone review; retries never reinterpret one-off instants or recurring
  calendar dates. Recurring generation uses the current Profile timezone, while existing
  occurrence provenance and history remain unchanged.
- Pause/resume has a separate exact `system.quest-recurrence.pending.v1:<userId>:<questId>`
  record containing version, userId, questId, commandId and paused. A Web Lock, verified
  storage writes/removals, synchronous pending gates and account-generation checks protect
  dispatch. Reload restores the original operation; uncertain outcomes require an explicit
  exact retry before another change to that series. An accepted historical receipt triggers
  a server refresh, rather than pretending its old state is the current state.

These guarantees require supported secure browser storage and Web Locks. Offline mutation
is disabled and reconnect never auto-replays. External eviction, manual storage clearing,
older builds outside this protocol and cross-device recovery remain outside this guarantee.
The UI provides no unsafe discard path for an uncertain command.

## Future consumers

Calendar and chatbot clients can use the same definition commands, requested-day
materialization, occurrence IDs, completion aliases and cycle-guarded reopen commands.
They must authenticate through the same owner boundary, supply command identities and
respect server receipts; they must not calculate their own recurrence or EXP entitlements.
No Calendar, chatbot, notification, reminder or background scheduler is implemented here.

## Integration defect and regression

The new real-UI interrupted-creation test proved a backend recovery defect: after
creation committed and its response was dropped, pausing the visible definition and
changing Profile timezone made the original exact creation retry reject. The creation
routine compared a mutable stopped_at value and the current Profile timezone to its
creation history. The narrow fix removes the live pause-state condition and validates
the immutable recorded timezone separately from the unchanged normalized request.
All request, event-pair, owner, actor, rule identity, rule shape and provenance validation
remain in place. Replay never resumes the series, creates a second definition or rewrites
history. SQL regressions independently cover timezone change, pause and malformed
historical timezone; the browser regression covers the complete recovery journey.

The extended Playwright suite also exposed a fixture registration issue: an imported
beforeEach hook applied only to its registering spec. Owner login is now an automatic
per-test fixture shared by both Quest spec files. No existing assertions were removed.

## Validation performed

Final validation on 2026-09-29:

| Check | Final result |
| --- | --- |
| `node --test tests/recurring-migration.test.mjs` | **4/4 passed**: additive boundary, owner/search-path enforcement, command-role/EXECUTE security, historical checkpoint registration. The handoff's earlier 66/66 smoke count is prior evidence, not a newly executed count; no corresponding checked-in runner was present. |
| `supabase/tests/recurring-quests-catalog.sql` | **Passed** inside the disposable wire harness: four routines, two receipts, privileges, source hash and slot index. |
| `supabase/tests/recurring-quests.sql` | **Passed** inside the disposable wire harness, including the new timezone-change, paused-creation replay and invalid historical-timezone regressions; all existing assertions retained. |
| `node supabase/tests/private-owner-wire.mjs` | **19/19 migration-checkpoint suites and 10/10 database/security groups passed**, including ADR-015 activation checks. |
| `node --test tests/*.test.mjs` | **194/194 passed**, zero failures/skips. Baseline 178 plus 11 creation/recurrence tests, one materialization boundary test and four static migration tests. |
| `node tests/auth-smoke.mjs` | **Passed**: 11 Auth/Profile/security scenario groups, plus disposable startup and production build. |
| `npx playwright test --list` | **16 tests discovered in 8 files**. |
| `npm run test:e2e` | **16/16 passed**, zero retries, in the final full run (3.0 minutes). Existing 13 plus two recurring desktop journeys and one mobile-control journey. |
| `npm run lint` | **Passed**, zero warnings. |
| `npx tsc --noEmit` | **Passed**. |
| `npm run build` | **Passed**, including strict TypeScript and static generation. |
| `git diff --check` | **Passed**. Tracked diffs and new files reviewed separately. |

Browser coverage includes Daily creation and today's ordinary occurrence, single EXP credit,
refresh, cadence/identity, pause/resume, reopen/recomplete with reversal, one-off regression,
and actual committed-response loss for creation and pause. The creation recovery test pauses
the committed definition and changes Profile timezone before replay. Mobile checks exercise
Weekly checkboxes and Monthly/date controls at 360/390/412 pixels, 44px touch targets and no
horizontal overflow. SQL remains responsible for combinatorial recurrence/calendar cases.

All database/browser/Auth execution used owned disposable tmpfs databases and generated
loopback services. No real Local reset, existing-volume operation, Cloud/Production request,
Vercel change, dependency addition, commit, push, PR operation or deployment occurred.

## Limitations

- No arbitrary schedule editing/versioning, deletion, RRULE/cron, every-N cadence,
  occurrence-limit form field, Calendar UI, reminders, notifications, chatbot, streaks,
  penalties or offline synchronization. Pause/resume is the only series-management mutation.
- Materialization runs only when a day is requested; there is no automatic midnight refresh
  or background catch-up. Monthly edge behavior remains wholly server-owned.
- The routines' second `pg_timezone_names` guard (defence against a zone that later becomes
  unsupported) is not fixture'd, because the Profile row trigger already refuses an unstoreable
  zone. The missing-timezone branch is tested.
- No concurrency test fires two sessions at one day. Correctness rests on the shared owner
  advisory lock, the `FOR UPDATE` counter window and the frozen partial unique index, and the
  last two are asserted directly in the suites.

## Final changed-file inventory

The working tree contains 35 changed/new files, including the pre-existing
uncommitted backend/docs work supplied with the task. The recurring migration was changed
only for the application-proven creation replay defect; its SQL behavior suite gained the
corresponding regressions. Historical migrations and recurrence generation semantics are
unchanged. No remaining implementation or validation blocker is known before commit/push;
those operations remain explicitly unauthorized for this task.

- `docs/00-product/backlog.md`
- `docs/02-architecture/decisions.md`
- `docs/02-architecture/quest-creation-v1-contract.md`
- `docs/02-architecture/quest-database-schema.md`
- `docs/04-development/recurring-quests-v1.md`
- `docs/04-development/testing.md`
- `src/app/dashboard/page.tsx`
- `src/features/quests/components.tsx`
- `src/features/quests/create-action.ts`
- `src/features/quests/create-draft.ts`
- `src/features/quests/create-form.tsx`
- `src/features/quests/create-lifecycle.ts`
- `src/features/quests/create-pending.ts`
- `src/features/quests/data.ts`
- `src/features/quests/recurrence-action.ts`
- `src/features/quests/recurrence-pending.ts`
- `src/features/quests/recurring-controls.tsx`
- `src/features/quests/recurring-data.ts`
- `src/features/quests/recurring-list.ts`
- `src/features/quests/recurring-model.ts`
- `src/features/quests/recurring-panel.tsx`
- `src/features/quests/recurring-receipt.ts`
- `supabase/migrations/20260928181000_create_recurring_quests.sql`
- `supabase/tests/recurring-quests-catalog.sql`
- `supabase/tests/recurring-quests.sql`
- `tests/daily-quests.test.mjs`
- `tests/e2e/quest-fixtures.ts`
- `tests/e2e/recurring.desktop.spec.ts`
- `tests/e2e/recurring.mobile.spec.ts`
- `tests/helpers/auth-environment.mjs`
- `tests/private-auth.test.mjs`
- `tests/progression.test.mjs`
- `tests/quest-creation-ui.test.mjs`
- `tests/recurring-migration.test.mjs`
- `tests/rewards.test.mjs`
