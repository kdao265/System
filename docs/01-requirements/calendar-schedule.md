# Calendar / Schedule requirements

## 1. Status and ownership

**Status:** Approved for PR #40 on 2026-09-29. Implementation and validation: [Calendar handoff](../04-development/calendar-schedule-v1.md).
**Owner:** Product Owner (decision) / orchestrator (drafting). **Date:** 2026-09-29.
**Related:** PR #40 (approved), [ADR-018](../02-architecture/decisions.md#adr-018--recurring-quest-definitions-materialize-lazily-on-read), [ADR-019 (approved)](../02-architecture/decisions.md#adr-019--the-calendar-is-a-read-only-projection-over-two-owning-tables), [V1 scope — Planning](../00-product/scope-v1.md), [Auth/Profile timezone](auth-profile.md), [Quest engine](quest-engine.md).

The Product Owner's Calendar Visual / Month View V1 task extends the presentation
to Day / Week / Month on `feat/calendar-visual-month-v1`. See the
[visual view handoff](../04-development/calendar-visual-month-v1.md) for current
behavior and validation; the earlier Schedule V1 handoff records the original release.

Calendar sits in the Planning module, which [V1 scope](../00-product/scope-v1.md) lists as a
conceptual baseline and [PROJECT_CONTEXT](../PROJECT_CONTEXT.md) lists as **not shipped
functionality**. Scope line 31 forbids inferring a schema from that table, so this document is the
required predecessor to any migration or UI work. Requirements below record approved V1 behavior; section 11 records resolved decisions and deferred scope.

## 2. Purpose

**Problem:** the owner can see one profile-local day of Quest work, but has no way to see when that
work sits relative to the rest of their day, and no place to record time that belongs to them
(classes, work shifts, appointments, sleep, travel) as a first-class SYSTEM object.

**Intended outcome:** one calendar surface showing, for a chosen range of profile-local days, every
scheduled Quest occurrence and every owner-entered Schedule Event, so the owner can judge available
time before committing to new Quests.

**Module boundary:** Calendar *displays* and owns Schedule Events only. It never creates,
materializes, moves, completes, fails or rewards a Quest. Quest scheduling stays inside the Quest
Engine's existing commands (ADR-018: future Calendar consumers "must reuse these same server
commands and occurrence identities, not independently generate slots or rewards").

## 3. Terminology

- **Schedule Event:** an owner-entered block of time that is not Quest work. It has a title, an
  optional note, a category label and a time span; it carries no EXP, reward, status machine or
  completion evidence.
- **Occurrence:** the existing Quest occurrence row (`public.quest_occurrences`) with its own
  lifecycle, the only object that can be completed and earn EXP.
- **Calendar entry:** one rendered item in the Calendar. It is either a Schedule Event or an
  Occurrence, never a merged third object.
- **Profile-local day / instant:** a day or wall-clock time interpreted in the owner's current
  `profiles.timezone`, the same rule Profile onboarding and ADR-018 recurrence already use.
- **Free / busy:** a day-level read of which hours inside the working window are covered by a
  Calendar entry.

## 4. User stories

- As the owner, I want to record dated commitments and see them in a weekly view, so my plan
  reflects real availability instead of memory.
- As the owner, I want to see today's Quests alongside my appointments in one place, so I can tell
  whether a new Quest is realistic.
- As the owner, I want to add, correct and remove a Schedule Event without touching Quest data, so
  a typo never becomes a Quest edit.
- As the owner, I want the calendar to follow my Profile timezone, so a "07:00 class" means the
  same instant wherever I am.

## 5. Functional requirements

| ID | Requirement |
| --- | --- |
| CS-01 | The owner can create a Schedule Event with a non-empty title, a start, an optional end, an optional all-day flag, an optional category and an optional note. |
| CS-02 | The owner can edit and remove their own Schedule Events. Editing does not alter any Quest, occurrence, event or ledger row. |
| CS-03 | A Schedule Event is visible to exactly its owner. Another valid owner token, an anonymous request and a direct API call outside the owner receive nothing and cannot mutate it. |
| CS-04 | The Calendar lists Calendar entries for a requested inclusive range of profile-local days and orders them by start. |
| CS-05 | An Occurrence with `scheduled_at` inside the range appears as a Calendar entry carrying its title, status, start and deadline, read from existing occurrence data. |
| CS-06 | A Calendar entry never synthesizes a Quest start, end, status or reward the occurrence does not already hold. An existing untimed recurring occurrence appears on its `source_slot_date`, labelled untimed. No scheduled instant is invented. Deadline-only one-offs remain outside this projection. |
| CS-07 | Reading the Calendar does not materialize, reschedule, complete, fail or cancel any occurrence. |
| CS-08 | Creating, editing or removing a Schedule Event preserves the existing contracts: create deduplicates by event identity, update sets full desired state (last write wins), and remove is repeatable. Replay markers/removal booleans distinguish whether this call wrote; no duplicate entry is created. |
| CS-09 | A Schedule Event spanning midnight is displayed on each profile-local day it touches. |
| CS-10 | The Calendar offers Day, Week and Month views of the same projection; switching views changes only the window shown, not the data source. |
| CS-11 | Calendar is reachable from the dashboard as a protected route; an unauthenticated or non-owner visitor gets the existing session redirect, never calendar data. |
| CS-12 | Every Schedule Event write and every Calendar read is authorized by the same single-owner predicate the existing tables use; no path bypasses it. |

## 6. Business rules

- **BR-01 Ownership:** `user_id` comes from the verified request identity, never from a
  client-supplied owner argument, and is compared with the single configured owner.
- **BR-02 No game state:** a Schedule Event has no EXP, reward, level, penalty or evidence
  relationship. EXP and money stay separate; a Schedule Event is neither.
- **BR-03 Time order:** when both an end and a start exist, the end is after the start. An all-day
  event carries day granularity and no wall-clock start.
- **BR-04 Timezone authority:** the profile timezone determines day boundaries and how a wall-clock
  input becomes an instant. A later timezone edit reinterprets display only; it does not rewrite
  stored timed instants (as in ADR-018). All-day events instead keep authoritative start/end dates and never shift after a timezone edit.
- **BR-05 Category is a label:** categories are owner-chosen text or a fixed small list, never a
  hard-coded business rule, and carry no scoring, filtering privilege or automation (ADR-008).
- **BR-06 Single source of truth:** Quest entries come from occurrences, Schedule entries from
  Schedule Events. No copy of either is stored for display.

## 7. States / state machine

A Schedule Event has no attendance/completion state machine: it is displayed until edited or removed. An internal removal timestamp retains its spent identity against late create retries. It deliberately has no
`completed`/`missed`/`cancelled` status — attendance is not a V1 concept, and adding one would
create a second completion model competing with the Quest lifecycle. The absence is a decision, not
an omission.

## 8. Edge cases

- **Retry / double submit:** a repeated create after a lost response must not double-book (CS-08);
  an identical edit is a no-op when that state already holds. Concurrent updates are last-write-wins, not a separate command receipt ledger.
- **Range boundaries:** the range covers whole profile-local days; a DST transition day has 23 or
  25 hours and entries still appear in real instant order.
- **Timezone edit mid-range:** timed entries keep their stored instants and their displayed day may move; all-day entries retain their dates.
- **Past events:** stored and displayed; nothing auto-expires or auto-deletes them.
- **Long events:** an event longer than a week is shown per day it touches (CS-09) and must not
  force unbounded rendering; the day slice is the rendering unit.
- **Empty range:** an explicit empty state, not an error and not a permanent spinner.
- **Concurrent edit:** two tabs editing one event — the last accepted whole-state write wins (approved OQ-4).
- **Permission:** anonymous, non-owner authenticated and revoked-owner tokens receive an empty
  result or a denial and write nothing.

## 9. Acceptance criteria

- **CS-AC-01** Given an owner with one Schedule Event and one scheduled Quest occurrence on the same
  day, when that day is read, then exactly two ordered entries appear, one per source, and no third
  row exists in either table afterwards.
- **CS-AC-02** Given a non-owner token, when a Calendar read or any Schedule Event write is
  attempted through the public API, then nothing is returned or changed.
- **CS-AC-03** Given one create command submitted three times with one identity, when it settles,
  then exactly one Schedule Event exists and every response agrees.
- **CS-AC-04** Given a Schedule Event, when it is created, edited or deleted, then occurrence rows,
  `quest_events` and `exp_ledger` are unchanged.
- **CS-AC-05** Given an event starting 23:30 profile-local, when the day view shows its start day
  and the following day, then it appears on both days under one identity.
- **CS-AC-06** Given the owner changes their profile timezone, when the Calendar is reopened, then
  timed instants are unchanged and only grouping/clock labels change; all-day dates and date-only labels stay unchanged.
- **CS-AC-07** Given a recurring definition with unmaterialized future slots, when a Calendar week
  is read, then no new occurrence exists afterwards (CS-07).

## 10. Out of scope

Quest creation, rescheduling or completion from the Calendar; Schedule Event recurrence; Google Calendar or any external sync; free/busy sharing; multi-user or shared calendars;
reminders and push notifications; drag-to-move interaction; natural-language or chatbot entry;
per-category automation; editing Quest occurrences through a calendar gesture.

## 11. Product Owner decisions and deferred items

| ID | Question | Decision owner | Blocks |
| --- | --- | --- | --- |
| OQ-1 | Both all-day and timed events are in V1. | Product Owner approved | Resolved |
| OQ-2 | No Schedule recurrence. Existing recurring Quest occurrences must appear without copying or generating them in Calendar. | Product Owner approved | Resolved |
| OQ-3 | Retain the implemented optional free-text category (40 characters). Fixed vocabulary deferred. | Existing schema | None |
| OQ-4 | Last-write-wins is accepted for V1. | Product Owner approved | Resolved |
| OQ-5 | Entry listing only; free/busy and overload warnings deferred. | V1 scope | None |
| OQ-6 | Protected `/calendar`, SYSTEM navigation, Day/Week/Month views (Month added by the approved visual-view task). | Product Owner approved | Resolved |

## 12. Calendar Visual / Month View V1

- Month uses a Monday–Sunday grid of whole weeks covering the selected month,
  including muted adjacent-month dates. Previous/Next move exactly one calendar
  month, preserving the day number when possible and otherwise clamping to the
  destination month's last day. Today uses the Profile timezone.
- Selecting a cell retains Month mode, selects that date and shows only its full
  agenda below the grid. Selecting an adjacent-month cell opens that date's month.
  View switching preserves the selected date. Selection and Today have distinct
  emphasis; an empty selected day still has an explicit empty agenda.
- Month summaries distinguish Schedule Events (sky) from Quest occurrences
  (violet). Wider screens show bounded title chips and `+N more`; compact screens,
  including 360/390/412 px, show bounded dots and `+N`. The agenda retains every
  entry and its full title, source and time information.
- Week adds a Profile-local 06:00–midnight timeline and a band for all-day,
  untimed and off-hours entries. Overnight Schedule Events use each day's clipped
  time slice. Quest membership stays governed by its existing scheduled/slot date.
  Full day agendas remain available. Day retains the existing selected-day list
  and Schedule Event editor.
- Calendar remains a time projection, not a second Quest engine. The visual work
  adds no storage, recurrence generation, Quest mutation or dependency. Authoritative
  all-day dates and existing Profile timezone conversion remain unchanged.
- Drag/drop, recurring Schedule Events, reminders/notifications, Google Calendar
  integration and chatbot entry remain intentionally deferred.
