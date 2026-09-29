# Calendar / Schedule V1 — PR #40

Task contract: continue `feat/calendar-schedule-v1`, preserving the prior agent's
uncommitted work. The Product Owner's implementation request supersedes the old
initial-governance documentation-only restriction. No dependencies, historical
migration edits, commits, pushes, PR creation, merges, deployments, or access to
Cloud/Vercel/Production/the developer Local Supabase project. Validation uses only
the existing disposable Docker/Auth/PostgREST/app harnesses.

Authority: [requirements](../01-requirements/calendar-schedule.md),
[ADR-019](../02-architecture/decisions.md#adr-019---the-calendar-is-a-read-only-projection-over-two-owning-tables),
ADR-015 and ADR-018. Acceptance includes protected `/calendar`, Profile timezone,
day/week views, all-day/timed create/edit/remove, existing Quest projection,
recoverable guarded mutations, and 360/390/412 px usability.

## Recovery audit

The branch already contained four modified tracked files: ADR-019, the owner
catalog/wire suites and the Auth environment checkpoint map. Four untracked files
held the requirements, Calendar migration and two SQL suites. There was no Calendar
application route, feature or browser coverage. Requirements and ADR still claimed
approval was pending; the current Product Owner request resolves that stale text.

No durable previous validation report established a completed pass. The baseline
run passed all 19 historical checkpoints and the Calendar catalog, then failed the
Calendar behavior test's composite-record assertion. The projection itself returned
the expected rows. Repairs include `SELECT e.* INTO`, null-safe receipt comparison,
boolean removal assertions, a missing synthetic fixture primary key and the wire
assertion comparing receipts while ignoring the intentionally changed replay flag.

Browser validation exposed a pre-existing fixture race: `loginOwner` could fill the
date form in the dashboard's streamed loading card, which was then replaced by the
real card. The helper now waits for its existing `aria-busy="false"` signal before
editing. No application loading or Quest behavior was changed. The mobile focus
test uses actual Tab/Shift+Tab input, matching the existing hardening test, before
asserting `focus-visible` styling.

The reported `schema_migrations.id` error is a probe issue, not a product defect.
The disposable database catalog was inspected through `information_schema.columns`:
the relation is absent because this harness applies migration files directly and
does not install CLI history. No real Local database was inspected. The checkpoint
map and execution order are retained; no history table was fabricated or repaired.

## Storage, security and contracts

The additive `20260929120000_create_schedule_events.sql` retains the four original
RPC names/signatures. `get_calendar_events` is STABLE, SECURITY INVOKER and writes
nothing. Three writes run under `schedule_command_owner`, a dedicated NOLOGIN,
NOBYPASSRLS role that does not own the table. Each RPC first requires the configured
owner and derives identity from the verified request. Permissive row ownership and
the ADR-015 restrictive single-owner policy remain in force. Authenticated has
owner-bound SELECT and RPC EXECUTE, never direct writes; anon and service_role have
no Calendar privileges. The command role can read only Profile user ID/timezone
under its owner-bound policy. No Quest/EXP grants or historical migrations change.

Create deduplicates by caller event UUID; update replaces full desired state and
does nothing if that state already holds; concurrent edits are last-write-wins.
Remove hides the event and retains `removed_at`, preventing a delayed create retry
from resurrecting the spent identity. This is an internal retry guard, not an
attendance/completion/EXP lifecycle. A repeated remove returns false truthfully.

## Time and Quest projection

Timed inputs use existing Profile timezone conversion, rejecting invalid dates,
reversed/equal endpoints and ambiguous/nonexistent DST times. SQL remains the
authoritative validator. Timed events are stored as instants, and half-open overlap
places spanning events on every touched day. A timed event without an end belongs
only to its start day, rather than leaking into every later query.

All-day forms accept first/last dates, with a missing last date meaning one day.
The existing instant RPC parameters transport those dates in the Profile zone.
SQL retains authoritative `start_date`/exclusive `end_date`; compatibility instant
columns are never used for all-day projection membership or clock labels. Profile
timezone changes cannot shift an all-day date. Day boundaries use separate local
midnights, including 23/25-hour days; spans are bounded to 366 days.

Calendar UNIONs existing Quest occurrences with active Schedule Events. Timed
occurrences use their `scheduled_at`; existing untimed recurring occurrences use
their `source_slot_date` and display “Untimed occurrence”. Calendar never calls
materialization, copies a Quest, or writes to its lifecycle/EXP. Unmaterialized
future slots do not appear. The UI explains this and links to the existing Quest
dashboard for planning/completion. Deadline-only one-off occurrences remain outside
this scheduled/slot-date projection.

## Application and recovery

- `src/app/calendar/page.tsx`: owner/Profile gates, date/week navigation, today
  emphasis, day/week selection and recoverable read error.
- `src/features/calendar/model.ts`: input validation, response boundary, Profile
  time conversion and day slicing.
- `src/features/calendar/data.ts`, `actions.ts`: owner-authenticated projection
  and sanitized RPC mutations; no privileged client credentials.
- `src/features/calendar/panel.tsx`: event form/list, edit/remove, distinct Quest
  links, immediate duplicate-submit guard, busy controls and offline awareness.
- `src/app/dashboard/page.tsx`, `src/proxy.ts`: SYSTEM Calendar entry and session
  refresh/private-cache boundary.

Unknown mutation outcomes retain the exact request in the mounted editor, freeze
its fields and offer an explicit retry. Controls recover after transport failures;
reconnection never sends work automatically. Pending requests are in memory only:
refreshing/leaving the page discards the retry request. The user is told to retry
before leaving; durable cross-reload recovery is deferred. Last-write-wins also
means a later retry of an edit can supersede another tab's intervening edit.

## Validation

Validation on 2026-09-29 used synthetic fixtures and disposable resources only:

| Check | Result |
| --- | --- |
| Calendar catalog + behavior SQL | PASS, including timezone changes, a 23-hour all-day DST date, no-end bounds, spent identity and existing untimed recurring projection |
| `node supabase/tests/private-owner-wire.mjs` | PASS: 21 checkpoint suites (19 historical plus 2 Calendar), 11 database/security groups; owned resources removed |
| `node --test tests/*.test.mjs` | PASS: 200 tests, zero failures/skips |
| `node tests/auth-smoke.mjs` | PASS, including added Calendar anonymous/non-owner/onboarding/logout/bad-configuration gates; owned resources removed |
| `npx playwright test --list` | PASS: 19 tests in 10 files |
| `npm run test:e2e` | PASS: all 19 tests, zero failures, 3.4 minutes, one worker and zero retries |
| `npm run lint` | PASS, zero warnings |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS; `/calendar` is dynamic and covered by Proxy |
| `git diff --check` | PASS; 13 new files separately reviewed and checked for trailing whitespace/local documentation links |

Earlier browser attempts identified the mobile focus-test error and the shared
streamed-date-form race; those failures are not counted as passes. The suite retains
Auth, one-off Quest, recurring Quest, completion/reopen/EXP, PWA and hardening tests.

## Deferred scope and operational boundary

No Schedule recurrence, external sync, free/busy calculation, overload warning,
drag/reschedule, or Calendar Quest completion. No deployment has been attempted.
Deployment must apply the new additive migration before exposing the route; existing
ADR-015 bootstrap/activation prerequisites remain mandatory. The branch remains
uncommitted for Product Owner review.

Final readiness: ready for commit/push review on `feat/calendar-schedule-v1`.
No commit, push, PR creation, merge or deployment was performed. No real Local,
Cloud, Vercel or Production target was used. Physical-device validation and durable
cross-reload Calendar mutation recovery remain deferred as described above.
