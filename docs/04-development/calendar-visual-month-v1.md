# Calendar Visual / Month View V1

Branch: `feat/calendar-visual-month-v1`. Product Owner task label: PR #41.
Scope: finish the existing working tree, validate the visual Calendar and update
only relevant documentation. No new dependencies, database/schema/migration
changes, commits, pushes, PR operations, deployment or real Local/Cloud access.

Authority: [Calendar requirements](../01-requirements/calendar-schedule.md),
[ADR-019](../02-architecture/decisions.md#adr-019---the-calendar-is-a-read-only-projection-over-two-owning-tables)
and the existing [Schedule V1 implementation](calendar-schedule-v1.md).
There is no new architectural decision: Calendar remains a time projection over
Schedule Events and existing Quest occurrences, with one range read per view.

## Interaction and presentation

Day retains the selected-day agenda and Schedule Event editor. Week remains the
default for an absent/unknown view. Switching Day/Week/Month keeps the selected
date; Today selects the Profile-local current date in the current mode.

Month renders Monday–Sunday rows covering its containing month, including muted
adjacent-month dates. It uses four, five or six rows as needed, bounded by the
supported calendar dates. Previous/Next shift one actual calendar month, never a
fixed number of days. Day numbers clamp at the target month's end: January 31,
2028 moves to February 29, and moving back then selects January 29.

Each cell is a native navigation link with a full date/count/title accessible name,
selected-date state and visible keyboard focus styling. Selecting it retains
Month mode and replaces the agenda below with that day's complete entries. An
outside-month selection opens the selected date's month. The editor also follows
the selected day. Today has sky emphasis and a date badge; selection has a white
inset outline, with Today still identifiable when the two dates coincide.

Schedule Events use sky chips/dots; Quest occurrences use violet. Completed Quest
chips are dimmed. Colors derive from the existing source/status, never persisted
Calendar state. The agenda includes textual source labels and links Quests back
to the existing Quest surface. Calendar reads do not materialize, duplicate,
reschedule, complete or reward Quests.

At widths of at least 420 px, Month shows at most three title chips per cell and
eight per week row; busy rows share that budget. `+N more` counts all omitted
entries. Below 420 px, including the tested 360/390/412 px widths, cells show at
most four kind-colored dots and a compact `+N`. The full agenda is never truncated.
All-day dates remain date-only; untimed recurring occurrences keep their existing
slot date without an invented scheduled instant.

Week adds seven timeline columns from 06:00 to midnight in the Profile timezone.
The hour grid, gutter, event positions and current-time marker use matching rem
geometry (2.75 rem per hour). The marker is a server-rendered snapshot, not a live
clock. Overlapping entries receive horizontal lane offsets; full labels/times
remain in the day agendas. All-day, untimed and wholly off-hours entries use the
band above the timeline. Overnight Schedule Events are clipped per touched day,
respect exclusive ends and never draw beyond midnight. Minimum block heights and
the display footprint for a missing end are presentation only, not stored duration.

## Repairs and implementation files

The inherited imports and MonthView props were already coherent. Work preserved
true month navigation and selected-day routing, then corrected crowded-cell chip
limits, early-year leap dates, repeated timezone parsing, mixed px/rem geometry,
internal navigation markup and an extra CSS EOF line. Targeted tests then exposed
off-hours/midnight clipping and overnight continuation bugs; those calculations
now reuse existing day membership. View link names are actual capitalized text,
so visible and accessible Day/Week/Month labels agree.

- `src/app/calendar/page.tsx`: view routing, date navigation and selected-day agenda.
- `src/features/calendar/view.ts`: pure grids, windows, summaries and timeline geometry.
- `src/features/calendar/views.tsx`: Month cells and Week timeline presentation.
- `src/features/quests/dates.ts`, `time.ts`: shared month/clock formatting and padded dates.
- `src/app/globals.css`: Calendar palette and hour rules.
- `tests/calendar.test.mjs`: grid/window/navigation/budget/timeline regressions.
- `tests/e2e/calendar-view-helpers.ts`, `calendar-views.desktop.spec.ts`,
  `calendar-views.mobile.spec.ts`: UI-created fixtures and targeted visual-view checks.

Existing Calendar model, panel, data adapter, actions and database contracts are
unchanged. No new ADR or dependency is needed.

## Validation

Validation uses synthetic fixtures and the repository's disposable harness only.
The targeted run completed before full-suite validation: 15 Calendar tests and
six Calendar Playwright tests passed, with zero failures/skips. Browser coverage
includes Day/Week/Month switching, true month navigation, Today, selected/empty
agendas, Schedule Event/Quest placement, truthful overflow, database row-count
stability, 360/390/412 px bounds, and 16/20 px root-font timeline alignment.
Existing Calendar create/edit/remove, all-day, timezone and recovery checks passed.

The first browser attempt lacked sandbox access to Docker's local pipe. A later
run exposed lowercase accessible view names; those were repaired and the final
targeted run passed all six tests in 3.1 minutes, one worker and zero retries.
The final continuation inherited that completed targeted checkpoint, required no
further behavior changes, and normalized one extra EOF line in the untracked view
component. Full suites then ran once, after the targeted tests were green.

Final validation on 2026-09-30:

| Command/check | Result |
| --- | --- |
| `node --test tests/calendar.test.mjs` | PASS: 15 tests, zero failures/skips; includes nine view-focused tests |
| Targeted Playwright: both `calendar-views.*.spec.ts` and both existing `calendar.*.spec.ts` | PASS: 6 tests, zero failures/skips, 3.1 minutes |
| `node --test tests/*.test.mjs` | PASS: 209 tests, zero failures/skips |
| `node tests/auth-smoke.mjs` | PASS: owner/non-owner/anonymous, onboarding, refresh/logout, RLS and bad-configuration checks; owned services removed |
| `node supabase/tests/private-owner-wire.mjs` | PASS: 21 migration checkpoints and 11 database/security groups, including Calendar; owned services removed |
| `npm run test:e2e` | PASS: 22 tests, zero failures/skips, 5.0 minutes, one worker and zero retries |
| `npm run lint` | PASS: zero errors/warnings |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS: synthetic loopback configuration, `/calendar` dynamic and Proxy present; isolated harness builds also passed |
| `git diff --check` | PASS; Git's LF/CRLF conversion notices are informational |
| File and documentation review | Six intended untracked files inspected, no extra EOF/trailing whitespace, local Calendar links resolve |

Build, test report, trace/screenshot, environment and scratch paths remain ignored.
The untracked file inventory contains only the new view modules, browser tests/helper
and this handoff. Nothing is staged. The available `origin/main` comparison has no
database/migration, dependency or lockfile change. Ready for commit/push review;
no commit, push, PR creation, merge or deployment was performed.

## Deferred and operational boundary

Drag/drop, recurring Schedule Events, reminders/notifications, Google Calendar,
chatbot entry, free/busy analysis and Calendar Quest editing/completion are deferred.
Physical-device testing and durable cross-navigation Schedule Event recovery remain
outside this change. Browser results cover Chromium desktop/mobile emulation.

The branch starts at `aaa59b7`, matching the available `origin/main` reference;
the local `main` reference is stale. Working changes include no database/migration
or package changes. Local history associates PR #41 with Recurring Quests and
PR #42 with Schedule V1; PR #41 above is the supplied task label, not verified remote
PR metadata. No remote PR, branch or deployment has been modified.
