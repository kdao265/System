# Goals / Main Quest V1 requirements

## Status and ownership

Finalized against the Product Owner's approval and final decisions, 2026-09-30.
Status: agreed architecture, not implemented. Owner: Human Product Owner.
Branch: `feat/goals-main-quest-v1`. Related issue: not supplied.
Authority: the Product Owner's design and finalization requests; [accepted ADR-020](../02-architecture/decisions.md#adr-020---goals-as-main-quests-with-live-derived-progress).
The [finalized architecture](../02-architecture/goals-main-quest-v1.md) records the repository audit, exact storage and RPC contracts, security, test plan and rollout.

Task contract: finalize these three design documents only. Documentation/link/whitespace checks
only; no production code, migrations, test creation/execution, database access (including
Local/Cloud), dependencies, commits, pushes or deployment. Architecture approval is not
implementation authorization. V1 exposes stable attach-order; manual reorder is deferred.

## Purpose and terminology

A **Goal**, displayed as a **Main Quest**, groups existing actionable work toward an outcome.
A **Sub Quest** is an existing one-off Quest linked to that Goal. It remains the same Quest
definition and executable occurrence, including its existing completion, reopen and EXP history.
A standalone Quest has no current Goal link. A retained, detached link is membership history,
not a current Sub Quest. A standalone Quest remains a normal Quest. Existing Quest importance,
priority and historical uses of `main` are independent of membership; never infer a Goal
relationship from them or relabel a standalone Quest as a Main Quest because of importance.

## User stories

- As the owner, I can group existing one-off Quests into a Main Quest and see how much work is complete.
- As the owner, I can complete or reopen a Sub Quest using the normal Quest controls and see the count reflect its current state.
- As the owner, I can see a stable Sub Quest order, detach work or archive my planning structure without changing earned EXP or erasing Quest history.

## Functional requirements

| ID | Requirement |
| --- | --- |
| GM-01 | Create and update a Main Quest's required title and optional description; use the existing Quest text limits of 120 and 4000 characters. |
| GM-02 | Link multiple existing owned one-off Quests; each Quest has at most one current Goal membership, including membership in an archived Goal. Standalone Quests remain valid. |
| GM-03 | Reject every recurring definition, including paused/stopped series and individual occurrences of a series. Link by Quest identity and bind its existing unique one-off occurrence. |
| GM-04 | Derive completed and total counts from current links and current occurrence state. Do not store completion, percentage, weights or copied Quest state on a Goal/link. |
| GM-05 | Use the existing Quest completion, safe Reopen V2, command identity, cycle and recovery contracts. A committed reopen reduces derived progress on the next fresh read. |
| GM-06 | Goal commands and reads never create/edit/complete/reopen Quests, materialize recurrence, write EXP or grant rewards. |
| GM-07 | Persist archival only; derive complete when total > 0 and completed = total. Empty Goals have progress 0% and completed=false; unarchived empty Goals display active, archived empty Goals display archived. |
| GM-08 | Archive preserves membership and hides the Goal from the default list. Archived Goal metadata/membership/order are read-only until restored. Its displayed progress remains live; Quest actions remain independent. |
| GM-09 | Detach changes membership only. Retain membership intervals and immutable accepted command receipts; reattachment creates a new interval. |
| GM-10 | V1 exposes stable attach-order only, stored as position and read by position then link ID. Detach preserves survivors' order; reattachment appends a new interval. Keep the position column for future manual reorder, with no V1 reorder RPC/UI. |
| GM-11 | Every mutation is owner-guarded, atomic, durably replayable and rejects conflicting command reuse. Stale unrecorded edits cannot overwrite newer Goal revisions. |
| GM-12 | Enforce ADR-015 in application identity checks, public RPC entry guards, owner RLS and same-owner references; anonymous/non-owner requests cannot mutate or retrieve owner data. |

## Business rules and lifecycle

For current links, numerator = occurrences whose current `status` is exactly `completed`;
denominator = all current links. Draft, scheduled, active, failed and cancelled count as incomplete.
An archived linked Quest remains in both the denominator and, if completed, numerator.
Completed Quests may be attached; they contribute immediately without earning EXP again.
Attaching an incomplete Quest can make a complete Goal active; detaching an incomplete Quest
can make a nonempty Goal complete. Detaching the last Quest yields active 0/0, 0%, completed=false.
Progress is unweighted: if total=0 return 0%; otherwise derive 100 * completed / total using
non-integer division. Never persist percentage. Derive completion from counts, not a rounded percentage.

| Stored retention | Derived condition | Display state | Allowed Goal edits |
| --- | --- | --- | --- |
| Not archived | Empty or at least one incomplete Sub Quest | active | Metadata, attach/detach, archive |
| Not archived | Nonempty and every Sub Quest completed | completed | Same as active; no manual complete/reopen command |
| Archived | Any count | archived, with current count | Restore only |

Restore clears archival and computes the display state from current Quest facts. Archiving a
Goal does not archive/cancel its Quests or reverse EXP. No freeze-at-archive progress is promised.
Goal revisions track Goal edits, not Quest completions, so a revision is not a progress cache key.
Archived Goals reject fresh metadata, attach and detach commands, including would-be no-ops.
There is no V1 reorder entry point; future reorder must also reject archived Goals. Restore
before editing. Archive/restore uses desired state, not a toggle, and is idempotent. An exact
recorded retry returns only its historical receipt even after archival; it applies no edit.
Historical completion snapshots are deferred to a future Goal History/Milestone feature.

## Edge cases and historical meaning

Retained links prevent hard deletion of their referenced Quest and occurrence even after detach.
V1 exposes no Goal deletion or Quest deletion/archive command. If a Quest is already archived,
reject a fresh attach; existing links remain visible and counted. Goal behavior never substitutes
for the Quest engine's future archive eligibility rules.
An archived linked Quest keeps contributing according to its current occurrence status, never
its archive flag. Quest archive rules remain Quest-owned; Goal archival never invokes them.
The partial unique index on quest_id WHERE detached_at IS NULL enforces one current Goal even
when that Goal is archived. Detached rows are excluded from uniqueness and progress, allowing
later attachment to a different Goal without deleting history.

The existing `direct_goal_id`, `project_id` and occurrence parent snapshots remain untouched.
Reject attaching data with any nonnull legacy parent field until explicitly reconciled. Attaching
completed work means current grouping, not a claim that its original completion was attributed
to that Goal. Quest events/EXP preserve execution history; Goal membership and receipts preserve
planning history. V1 does not expose an as-of progress report or a permanent completion milestone.

Lost responses retry the same request identity and payload. Recorded retries return the old
receipt, then the application reads current state; a historical success is never treated as a
current completion fact. Concurrent unrecorded edits with the same expected revision allow only
one effective change. Authentication failures do not disclose whether a Goal/Quest exists.
An accepted attach retried after detach must not reattach; an accepted detach retried after a
new attachment must not detach the new interval. New intentional reattachment needs a new
command ID and current Goal revision. Detach always names the membership link ID.

## Acceptance criteria

| ID | Observable outcome | Requirements |
| --- | --- | --- |
| GM-AC-01 | Three incomplete links show 0/3; ordinary Quest completions show 1/3, 2/3, 3/3 and derived completed. | GM-04..06 |
| GM-AC-02 | Safe reopen of one Sub Quest changes 3/3 to 2/3 and active; only the Quest engine's original EXP reversal occurs. Recompletion returns 3/3 with normal new-cycle EXP. | GM-04..07 |
| GM-AC-03 | Attach/detach updates both counts, preserves Quest state/history/EXP, rejects a second current Goal, and supports explicit detach then attach elsewhere. | GM-02, GM-06, GM-09 |
| GM-AC-04 | Attach-order persists across refresh; detaching a middle link preserves survivors' order, reattachment appends, and retry creates no duplicate position/link. No manual reorder is exposed. | GM-10..11 |
| GM-AC-05 | Archived Goal is absent from default listing but readable explicitly; mutations reject until restore. Reopen elsewhere changes its live count; restore reflects that count. | GM-07..08 |
| GM-AC-06 | Daily/weekly/monthly/custom definitions and paused series cannot attach; rejection creates no link, receipt, Quest event, occurrence or EXP entry. | GM-03, GM-06 |
| GM-AC-07 | Empty Goal has total=0, completed=0, progress=0%, is_complete=false, including while archived; completed-before-attach and archived-after-attach cases count correctly. | GM-04, GM-07 |
| GM-AC-08 | Duplicate submits and replay after later detach/restore/edit preserve subsequent state; changed command intent is rejected. | GM-09..11 |
| GM-AC-09 | Direct RPC/table attempts from non-owner and anonymous clients reveal no owner data; missing owner configuration fails closed. | GM-12 |
| GM-AC-10 | Existing Quest, EXP, recurrence and Calendar behavior is unchanged; Goal operations create no engine side effects. | GM-05..06 |

## Out of scope

Recurring Sub Quests or Goals, nested Goals, Projects, weighted progress, manual Goal completion,
automatic Goal rewards/EXP, chatbot/AI, Calendar changes, Goal deadlines, external sync and
manual reorder UI/RPC, historical progress charts and Goal History/Milestone completion
snapshots. No second task or completion engine.

## Open questions

No unresolved product or architecture decision remains for V1. The approval and final decisions
are recorded in ADR-020, including the amendment of older attribution/archived-parent language.
An authorized future data preflight may identify legacy attribution requiring reconciliation;
no database was inspected here. Implementation remains explicitly unauthorized in this task.
