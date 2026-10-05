# Recurring Schedule Defaults V1 - self-contained timezone backend

Date: 2026-10-04. Branch: feat/recurring-schedule-defaults-v1.
The Product Owner approved the corrected contract in [ADR-022](../02-architecture/adr-022-transition-derived-timezone-catalog.md).
This document supersedes the earlier provider-round-trip/attestation results; those results
are not certification of this implementation. No deployment, Cloud, database push/reset,
commit or push has occurred.

## Implementation and validation status

This feature is implemented end to end, not backend-only. The backend contract, the
frontend application layer and the browser journeys all exist in the working tree.
Recorded validation results for this branch are in the task handoff; historical ADR
decisions unrelated to this feature are unchanged.

No new production architecture validation is claimed beyond the checks listed below.
The final handoff records exact release identity, schema/counts, independent acceptance,
legacy/historical checks, both benchmark workloads, migration size/time and remaining limits.

## Scope

Only the uncommitted feature migration, generation fixtures/helpers, backend tests, disposable
harness, the frontend Quest schedule layer and architecture/handoff documents may change.
Historical migrations remain untouched. No Cloud, db push/reset, or preserved Docker
resource operations.

## What is implemented

### Self-contained timezone backend

The feature migration `20261004120000_recurring_schedule_defaults_v1.sql` is a single
self-contained file: pinned TZif bytes, a zone manifest, the generator, the generated
catalog, the runtime SQL and deterministic literals compose one migration with no runtime
includes, no provider round-trips and no prototype imports. SYSTEM owns recurring
timezone semantics through immutable, versioned, side-by-side releases selected by a
private singleton; provider tzdata, restart identity and server filesystem never decide
materialization. `quest_occurrences.source_tzdb_release_id` is added nullable with no
default and no backfill, and remains persistence-only provenance: it is never exposed in a
client read or used to derive application behavior.

### Recurring creation schedule defaults

Recurring Quest creation accepts optional default start/end times plus an
"ends the next day" flag, using the V4 request contract. The tuple is all-or-nothing and
is validated client-side against a mirror of the certified backend rule so an
unsubmittable pair is never sent. V4 creation recovery, the older v2/v3 replay paths and
their pending namespaces are unchanged.

### Pending V4

Recurring creation recovery uses the `system.quest-creation.pending.v4:` durable namespace
with the certified `create_recurring_quest_v2` command. Schedule-defaults commands use a
separate `system.quest-schedule.pending.v1:` namespace and Web Lock, so schedule recovery
never shares a record with pause, create or retirement recovery.

### Quest-ID series management

Series management is keyed by Quest ID, not by occurrence. Every active recurring
definition row carries a direct "Manage series" entry alongside the existing direct
Pause/Resume/Archive controls, and each recurring occurrence card keeps its disclosure
entry point. Both open the SAME shared manager/modal, one per Dashboard, backed by the
shared pause and retirement controllers. There is no second dialog, no second pause
controller, no second retirement controller and no occurrence materialization performed
solely to reach management. This is what makes a zero-occurrence recurring definition,
including one whose very first slot failed materialization, fully manageable.

### Schedule edit recovery and conflict behavior

An editable schedule draft OWNS the base revision it was loaded from. Submission always
sends `draft.baseRevision`; the newest authoritative detail revision is never substituted
at submit time. When authoritative detail refreshes:

- a PRISTINE form synchronizes both its values and its base revision, with no conflict;
- a DIRTY form whose base revision no longer matches preserves the user's local values
  verbatim, marks the draft conflicted, disables Save, and shows a localized conflict
  message with an explicit "Reload latest" action;
- nothing is ever silently merged and the expected revision never silently advances.

The explicit reload replaces local values with authoritative values and updates the base
revision. If a submit races the last local check and the backend rejects it as a stale
revision, the same conflict state is surfaced, authoritative detail is reloaded, and the
request is never retried automatically with the newer revision. Exact accepted-command
recovery for an uncertain command still replays the original pending command unchanged.

### Materialization warning UI

Nonfatal, slot-local materialization issues render whenever `issues.length > 0`,
independently of whether the day produced any occurrences. The warning surface is
rendered first and unconditionally; only then does the body resolve to either the Quest
rows or the normal empty-day state. It is valid to show both the warning and
"No Quests for this day". Each warning carries the issue reason text and a Manage series
entry for the affected series. Fatal PZ/backend errors keep their existing unavailable,
invalid, timezone-required and session-expired behavior; a nonfatal issue never becomes
an unavailable state.

### Calendar remains write-free

Calendar is unchanged and remains read-only. It performs no Quest writes, no completion,
no reopen and no schedule edits.

### Future work, not part of this feature

An unmaterialized Calendar projection of recurring occurrences is a separate future
milestone and is not part of Recurring Schedule Defaults V1.

## Verification tooling

`node supabase/tests/verify-generated-migration.mjs` is verification-only by default. It
composes the expected migration in memory, compares it against the checked-in migration,
exits 0 on an exact match and exits nonzero with first-difference diagnostics on a
mismatch. It never modifies files. Regeneration requires the explicit `--write` flag,
which is impossible to trigger accidentally; any other argument exits nonzero without
touching the migration. Documentation and tests distinguish the verify path from the
write path.
