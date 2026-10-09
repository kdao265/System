# Architecture and product decisions

These lightweight ADRs record the Product Owner's supplied decisions. Accepted means agreed direction, not implemented functionality. Initial date: 2026-09-17.

For future ADRs use: ID/title, date, status (proposed / accepted / superseded), context, decision, consequences, alternatives, and related issue or requirement. Preserve superseded decisions and link their replacements. Architectural proposals require Product Owner agreement before implementation.

## ADR-001 — Supabase owns application data

**Status:** Accepted.

**Context:** Multiple systems will read and update personal information.

**Decision:** Supabase/PostgreSQL is the application's primary source of truth.

**Consequences:** Persistence and data ownership decisions must preserve this authority. No schema is prescribed here.

## ADR-002 — External services are integrations

**Status:** Accepted.

**Context:** Google Calendar and potentially Notion provide external capabilities.

**Decision:** Treat them as integrations behind an explicit integration layer, not as the primary application database.

**Consequences:** Specify mapping, synchronization and conflict policies before implementation; see [the boundary](integrations.md).

## ADR-003 — EXP and money are separate

**Status:** Accepted.

**Context:** Both gamification and finance track quantities.

**Decision:** EXP progression and financial money are distinct concepts and systems.

**Consequences:** Do not conflate balances, rewards, or penalties. Any relationship requires explicit requirements rather than an implicit conversion.

## ADR-004 — Health means recovery estimates

**Status:** Accepted.

**Context:** Sustainable productivity requires awareness of workload and energy.

**Decision:** Health represents workload, energy and recovery estimates, not medical diagnosis.

**Consequences:** UI language and future algorithms must communicate estimates and avoid diagnostic claims. Estimation formulas remain undecided.

## ADR-005 — Failure does not mandate punishment

**Status:** Accepted.

**Context:** Failure may reflect overload or another justified reason.

**Decision:** Failure need not trigger a penalty. Health/workload can justify waivers. Penalties must not recursively escalate.

**Consequences:** Requirements must distinguish failure, penalty decisions, and waivers. Physical/custom, savings-allocation, and EXP penalties require defined policies; no automatic financial execution is implied.

## ADR-006 — Separate Quest, Activity, Criterion and Evidence

**Status:** Accepted.

**Context:** Doing work, participating in an event, meeting a requirement, and proving it are different concepts.

**Decision:** Quest is something to do; Activity is a real event/activity/project participated in; Criterion is a requirement; Evidence is proof of satisfaction. One activity may satisfy multiple criteria.

**Consequences:** Model their relationships explicitly; do not collapse them into one interchangeable entity.

## ADR-007 — Evidence verification is distinct from progress

**Status:** Accepted.

**Context:** Estimated progress alone cannot prove a requirement was satisfied.

**Decision:** Distinguish verified evidence from estimated progress.

**Consequences:** Specify verification policy and display these concepts distinctly. Completion or an estimate must not silently imply evidence verification.

## ADR-008 — Requirement systems are data-driven

**Status:** Accepted.

**Context:** University training scores, scholarships, Sinh viên 5 tốt and other application criteria can differ.

**Decision:** Represent requirements as data; do not hard-code university or scholarship criteria into UI logic.

**Consequences:** Domain services evaluate configured criteria. Configuration structure and change handling require later specification.

## ADR-009 — Capture ideas before expanding V1

**Status:** Accepted.

**Context:** A broad personal Life OS can continually attract new ideas.

**Decision:** New ideas normally enter the backlog. The Product Owner explicitly decides scope changes.

**Consequences:** An idea or issue is not an automatic V1 commitment; link accepted changes to scope and requirements.

## ADR-010 — Business logic stays outside UI components

**Status:** Accepted.

**Context:** Rules must remain consistent across screens and integrations.

**Decision:** Keep application business logic in domain/application services, not directly in UI components.

**Consequences:** UI renders state and collects input; services own calculations and transitions. Concrete interfaces remain undecided.

## ADR-011 — Propose architecture changes explicitly

**Status:** Accepted.

**Context:** Multiple agents assist a human Product Owner without shared memory.

**Decision:** Agents must document and propose architectural changes before implementing them.

**Consequences:** Record context, alternatives and impact in a proposed ADR; obtain Product Owner agreement, then update requirements and implementation. A conversation alone is not a durable handoff.

## ADR-012 — Quest reopen V2 cycle guard

**Date:** 2026-09-25.

**Status:** Accepted.

**Context:** The historical `reopen_quest_occurrence(command_id, occurrence_id, origin)` command resolves the occurrence's current completed cycle on the server. A delayed request can therefore undo a newer completion after the occurrence has been reopened and completed again. Reopen effects must remain atomic, replayable and compatible with the existing event, EXP ledger and receipt model.

**Decision:** Add the versioned command `reopen_quest_occurrence_v2(command_id, occurrence_id, expected_execution_cycle, origin)`. Under the existing owner, Quest-definition and occurrence row locks, a fresh request must match the locked occurrence cycle or reject with `23514` before mutation. A recorded command replays its historical receipt after later cycles, but its supplied cycle must match the originally recorded cycle; when a valid positive cycle and an accessible subject reach replay validation, a different cycle or subject rejects with `23505`. Invalid cycles or inaccessible subjects may be rejected earlier by input and ownership validation.

Revoke `authenticated` EXECUTE on the historical V1 function while retaining its database definition and historical receipts. Grant `authenticated` EXECUTE only on V2. V2 preserves the existing exact EXP reversal, event ordering, cycle advancement, projection reset and `quest_reopen_receipt` shape.

**Consequences:** Browser callers must use V2 and provide the cycle observed from the occurrence read. Historical V1 migrations remain unchanged; the additive migration owns the new function and the V1 permission hardening. Accepted command receipts remain valid across later cycles without reapplying their effects.

**Alternatives:** Keeping V1 browser execution would preserve compatibility but leave stale requests unsafe. Replacing or editing the historical migration would alter already-applied deployment history. A server-side current-cycle lookup without a caller expectation would not distinguish a delayed request from an intentional current request.

**Related:** [Quest command API V1 and V2 appendix](quest-command-api-v1.md), [Quest Reopen V2 migration](../../supabase/migrations/20260926000000_quest_reopen_v2.sql).

## ADR-013 — Durable completion aliases

**Date:** 2026-09-26. **Status:** Accepted by the Product Owner's backend implementation request.

**Context:** Completion returns the alternate caller command ID for a same-cycle
replay without recording that identity. A lost response followed by reopen leaves
that caller unable to replay. The historical contract's original-command wording
also differs from deployed SQL, tests and receipt validation.

**Decision:** Preserve the deployed RPC signature and ten-field caller-ID receipt.
Atomically register alternate command IDs in a private, immutable, owner-scoped
alias relation referencing the canonical completed event. Resolve recorded bindings
before live-cycle validation. Creation and Reopen V2 reserve the same Quest command
namespace. Add an authenticated, business-data-read-only resolution RPC distinguishing
recorded, unrecorded_superseded, unrecorded_current and conflict outcomes. Never
backfill unrecorded historical identities or claim they previously succeeded.

**Alternatives:** Definitive rejection plus reconciliation avoids alias storage but
changes successful deployed behavior and makes duplicate submissions user-visible.
Returning the original command ID alone breaks existing receipt validators and
does not recover a lost alternate response. Durable aliases preserve compatibility.

**Consequences:** New private storage and narrow collision checks are required;
accepted Quest/EXP history and progression behavior remain unchanged. Legacy
uncertainty requires future frontend reconciliation. Database migration survives
application rollback. This accepted amendment supersedes only the conflicting
same-cycle command-ID wording; the historical text remains for traceability.

**Related:** [Completion Alias contract](quest-command-api-v1.md#11-completion-alias-v1-amendment),
[backend task and rollout](../04-development/completion-alias-v1.md).

## ADR-014 - Private Auth V1 application boundary

**Date:** 2026-09-28. **Status:** Accepted by the Product Owner's PR #35 implementation request.

**Context:** SYSTEM is a private single-owner application. Existing SSR Auth accepts
any valid Auth user, and the original signup flow is public.

**Decision:** Preserve Supabase Auth, SSR cookie refresh and RLS. Add a server-only
`SYSTEM_OWNER_USER_ID` UUID allowlist at the shared server identity boundary and
password login. Fail closed on absent/invalid configuration; all protected actions
use that boundary. Disable website signup and its action, and keep operational
Supabase public/anonymous signup disabled. Buffer login cookies until identity is
accepted. Logout and owner timezone onboarding retain their current behavior.

**Alternatives:** Email matching, UI-only checks and proxy-only gates cannot enforce
server authorization. A new identity provider is unnecessary. A database singleton
is not part of the approved application implementation; see ADR-015.

**Consequences:** Every environment needs the server UUID. Existing database RLS
still isolates users rather than enforcing one SYSTEM owner. No domain rule or
privileged browser credential is introduced. [Scope, audit and validation](../04-development/private-auth-v1.md).

## ADR-015 - Single-owner database enforcement

**Date:** 2026-09-28. **Status:** Accepted and implemented. Both stages are applied to
Cloud (Production) on 2026-09-28: Local/Remote migration history is synchronized, 15
restrictive single-owner policies and 14 public-RPC entry guards are active, exactly one
configured owner remains, and final Production smoke testing passed.

**Context:** Valid non-owner tokens can bypass Next.js and invoke permitted Supabase
queries/RPCs on their own data. Disabling signup does not remove this access.
PostgreSQL cannot read the server environment variable.

**Decision:** Add an administrator-controlled private singleton owner configuration
and narrow authorization predicate. Add restrictive policies to existing RLS,
plus public-RPC entry guards (including owner-only assignment actor and target).
Preserve the current identity helper, ownership isolation, capabilities, provisioning
and business rules. See the [migration scope and test plan](../04-development/private-auth-v1.md#database-hardening-follow-up)
and the [database hardening record](../04-development/private-auth-database.md).

**Alternatives:** Application-only checks leave direct APIs accessible. Deleting or
banning all other users does not establish a durable database invariant or instantly
revoke issued access tokens. A gateway hook alone does not cover other SQL entry
paths. Rewriting every business routine or managed Auth helper creates wider risk.

**Impact:** Two additive migrations (`20260928090000_install_private_owner.sql` for
stage one and the promoted `20260928100000_activate_private_owner.sql` for stage two
activation) plus a separately approved environment-specific bootstrap; missing
bootstrap deliberately denies application database access. App and database UUIDs must
agree. The Product Owner authorized implementation, the stage-two promotion and the
Production rollout on 2026-09-28. The hardening is implemented, promoted into the
migration path, fully validated on disposable resources, and applied to Production
(Cloud) on 2026-09-28 with Local/Remote migration history synchronized and the final
Production smoke testing passed. See the
[database hardening record](../04-development/private-auth-database.md).

## ADR-016 - Disposable Playwright browser foundation

**Date:** 2026-09-28. **Status:** Accepted within the Product Owner's explicit
Playwright implementation request; no application architecture change.

**Context:** Browser coverage must exercise Private Auth V1 without contacting
Production or the developer's existing Local project. Shared owner mutations must
be deterministic.

**Decision:** Extend the existing disposable auth helper with an opt-in isolated
application copy/build. Playwright worker fixtures own that same verified tmpfs
Supabase lifecycle. Use real UI authentication, one worker, no saved session state,
and separate desktop lifecycle/mobile anonymous specs. Add `@playwright/test` as
a development dependency for real browser assertions and failure diagnostics.

**Alternatives:** Reusing a running app/Local Supabase risks real data; a second
Supabase CLI environment duplicates existing safety logic; API-created browser
sessions would omit the requested login flow. Parallel shared-owner mutations and
retries against dirty state would hide ordering defects.

**Impact:** Each project worker builds its own application and provisions fresh
fixtures, increasing runtime but preserving isolation. No production dependency,
RLS, schema or domain rule changes. The existing checkpoint workflow is preserved;
a separate browser workflow adds coverage. See [lifecycle and task contract](../04-development/playwright-e2e.md).

## ADR-017 - Personal Beta PWA installability and static-only cache strategy

**Date:** 2026-09-28. **Status:** Accepted within the Product Owner's explicit PR #37
(Personal Beta / PWA V1) implementation request. Authentication, RLS and domain
semantics are unchanged.

**Context:** SYSTEM is a private single-owner app that should be usable daily from a
phone as an installed web app. Current Chromium/Android installability expects a web app
manifest with suitable icons *and* a registered service worker that handles fetches.
The usual PWA pattern (app-shell cache, offline fallbacks, background sync) conflicts
with an authenticated private app whose HTML, Server Action/RPC responses, session
cookies and Supabase traffic are user-specific and must stay network-authoritative.

**Decision:** Add the Next.js-native installability layer only: `app/manifest.ts`,
root-layout metadata/viewport (`viewport-fit: "cover"`, theme color, Apple tags), an
original committed icon set, and one deliberately minimal service worker. The worker
caches nothing except an explicit allowlist of versioned static assets (the manifest and
the icon set), lets every other request fall through untouched, activates immediately
(`skipWaiting` plus `clients.claim`), deletes superseded caches on activation, and is
served `no-store` so a new revision is always fetched. No offline shell, no offline
Quest/EXP mutation, no background sync, no push and no external analytics.

**Alternatives:** Shipping no service worker reduces Android installability to a
bookmark/shortcut, which does not meet the goal. Cache-first HTML or an offline app
shell would serve stale authenticated UI and stale data to a single-owner app. A generic
PWA/Workbox plugin adds a dependency and broad default cache rules beyond SYSTEM's
needs. Caching Supabase/API responses would persist user data in device Cache Storage
and break network-authoritative reads.

**Impact:** Security boundaries are untouched and no code path branches on display mode,
so RLS, owner authorization and session handling behave identically in a browser tab and
an installed app. Because application code, HTML and data are never cached, an installed
app cannot be stranded on stale code and a revision bump discards old static caches;
users may still see the previous icon/manifest for one navigation until the worker
updates. Offline use is not supported and shows the browser's normal offline error,
which the Product Owner accepted for V1. The existing disposable Playwright harness is
extended rather than duplicated with installability and phone-layout checks. See the
[Personal Beta PWA guide](../04-development/personal-beta-pwa.md).

## ADR-018 - Recurring Quest definitions materialize lazily on read

**Date:** 2026-09-29. **Status:** Accepted / Implemented in the repository. The Product
Owner accepted ADR-018 and its versioned application extension for PR #39. Database,
creation/recovery, day materialization and pause/resume UI are implemented and validated
on `feat/recurring-quests-v1`; no deployment, commit, push or PR operation was performed.

**Context:** RR-01 to RR-07 require a reusable recurring definition plus one occurrence per
eligible slot, each with its own lifecycle, completion and reward entitlement. Migration
one already stores everything this needs — `quest_recurrence_rules`, `quests.recurrence_mode`,
`quests.materialized_occurrence_count`, the occurrence origin columns and the partial unique
index `uq_recurring_slot` — but no routine creates or generates a recurring definition, so a
recurring Quest is currently unreachable. Section 18 of the schema document states the write
contract and explicitly does not specify a scheduler. Creating a second engine, a second
completion path or a second EXP source would duplicate frozen pipeline guarantees.

**Decision:** Add one additive migration that contributes two receipt types and four routines
and nothing else: `create_recurring_quest`, `materialize_quest_day`, `set_quest_recurrence_pause`
and `list_recurring_quests`. A recurring definition writes the same `quests` row, the same
single rule, and two definition events (`created` and `recurrence_changed`), then produces no
occurrence. `materialize_quest_day(date)` is the only generation trigger: it lazily creates at
most one unscheduled `draft` occurrence per eligible rule for one profile-local day, so a
recurring occurrence is an ordinary occurrence that completes, reopens and is credited through
the unchanged completion command and EXP ledger.

Generation is gated on the profile-local today or later. A past day that was never materialized
is skipped, never backfilled, and consumes no `occurrence_limit`, which is section 18.2 read
literally and satisfies AC-33. Determinism is layered: the shared owner advisory lock, then the
Quest row `FOR UPDATE` around the limit check and counter increment, then `ON CONFLICT DO
NOTHING` against `uq_recurring_slot` with `ROW_COUNT` deciding whether the cumulative counter
moves. Slots carry a calendar `source_slot_date` and never an invented instant, because
section 18.4 forbids a manufactured deadline and the frozen `ck_occurrence_schedule` check
requires an instant before a status may be `scheduled`. No cron, worker, queue or precreation
horizon exists.

`public.list_day_quest_occurrences(date)` is left byte-identical. The promoted ADR-015
activation migration pins its exact source hash and the historical day-read suites assert its
catalog shape, so recurrence enters the read path through a sibling routine instead. The four
new routines carry `system_private.require_owner()` in their own bodies because the deferred
activation migration guards only its frozen pre-existing RPC list.

**Alternatives:** A scheduler or precreation horizon would create occurrences nobody asked for
and contradicts RR-03 and AC-33. Editing the day-read projection would break a hash-pinned
migration. A separate recurring completion command would fork the completion and EXP contract
that AC-41 already pins. Materializing explicitly requested past days would manufacture an
obligation per missed slot, which RR-05 forbids. Emitting a Quest Event per generated slot would
require widening the frozen `ck_event_type` vocabulary with a synthetic kind.

**Consequences:** Recurring Quests reuse the existing occurrence, completion, reopen and EXP
pipeline unchanged, so AC-35, AC-38, AC-40 and AC-41 hold without new machinery. Materializing
a slot writes no Quest Event: provenance lives in the occurrence origin columns, the cumulative
counter and `created_at`, while definition changes do write `created`, `recurrence_changed` and
`recurrence_stopped`. The Product Owner also accepted the application extension for PR #39:
the existing Dashboard creates One-off/Daily/Weekly/Monthly Quests, materializes the selected
day before its ordinary read, labels recurring occurrences, and lists definitions with
pause/resume. One-off creation keeps the exact v2 storage contract. Recurring creation uses
an exact v3 envelope under the same origin-wide lock; recovery inventories both, preserving
command identity without converting or widening v2. Replacing v2 or silently adding fields
to its shape would strand or reinterpret uncertain one-off commands, so both are rejected.
Pause/resume persists exact account/Quest/command/state snapshots before dispatch, retains
uncertain results and refreshes authoritative state after confirmed receipts. Server actions
verify the expected account, and all SQL routines retain ADR-015 owner enforcement and RLS.

The application integration regression proved that creation replay must survive later pause
and Profile-timezone changes. The narrow migration fix compares immutable creation request
fields and validates the recorded timezone as provenance, without requiring current pause or
timezone values to equal their creation state. Historical events and occurrences are untouched.
No new engine, schema, privileges or calendar semantics were introduced by this correction.

Daily uses each eligible Profile-local date; Weekly uses selected ISO weekdays; Monthly uses
the chosen day or the shorter month's last day and retains the chosen day for later months.
Dates are inclusive. Unmaterialized slots follow current Profile timezone; existing provenance,
completion and EXP remain fixed. Arbitrary schedule editing/versioning is deferred. Future
Calendar/chatbot consumers must reuse these same server commands and occurrence identities,
not independently generate slots or rewards. See the [application/recovery and validation
record](../04-development/recurring-quests-v1.md).

**Related:** [Quest engine requirements](../01-requirements/quest-engine.md) (RR-01..RR-07,
AC-32, AC-33, AC-39, AC-40), [Quest database schema](quest-database-schema.md) section 18,
[Recurring Quest migration](../../supabase/migrations/20260928181000_create_recurring_quests.sql),
[behavior suite](../../supabase/tests/recurring-quests.sql) and
[catalog suite](../../supabase/tests/recurring-quests-catalog.sql).

## ADR-019 - The Calendar is a read-only projection over two owning tables

**Date:** 2026-09-29. **Status:** Accepted - Product Owner approved PR #40: all-day and timed events, existing recurring Quest projection, last-write-wins editing and `/calendar`. No Schedule Event recurrence.

**Context:** [Calendar/Schedule requirements](../01-requirements/calendar-schedule.md) CS-04 to
CS-07 require one ordered view that mixes two kinds of thing that already have different owners and
different lifecycles: Quest occurrences owned by the Quest Engine, and non-Quest time blocks that do
not exist yet. ADR-018 closes with an explicit constraint on this consumer: future Calendar work
"must reuse these same server commands and occurrence identities, not independently generate slots or
rewards." Migration one already freezes the occurrence contract (`status` plus
`scheduled_at`/`deadline_at`, `ck_occurrence_schedule`, `source_slot_date`, `uq_recurring_slot`), and
ADR-015 freezes one activation pattern for every new owner table. The open question is where calendar
semantics may live without creating a second scheduler, a second completion model or a second
ownership path.

**Decision:** Store no calendar. Keep two owning tables — `public.quest_occurrences` (unchanged) and
a new additive `public.schedule_events` (owner id, title, start, optional end, all-day flag, category
label, note, timestamps) — and add one read RPC, `get_calendar_events(date_from, date_to)`, that
`UNION ALL`s the two sources into one ordered set of calendar entries and returns only the columns a
day or week grid needs. The RPC is `SECURITY INVOKER`-scoped through existing owner policies with `system_private.require_owner()` before any row access, matching the routine boundary that `list_recurring_quests` and
`list_day_quest_occurrences` already use. Writes go through three owner-scoped idempotent commands
(`create_schedule_event`, `update_schedule_event`, `delete_schedule_event`) on `schedule_events`
only. No Quest row, event kind, reward, ledger row, rule or `materialize_quest_day` behavior changes;
the Calendar never materializes.

`schedule_events` follows ADR-015 unchanged: RLS enabled, owner policies keyed on the verified
request identity, a dedicated NOLOGIN/NOBYPASSRLS `schedule_command_owner` owns the three SECURITY DEFINER writes but not the table. Authenticated has owner-bound SELECT and RPC EXECUTE; direct writes and anonymous/service-role access are revoked. No `private_owner` role is introduced: this is the existing Quest command-role pattern. The read side reuses the Profile timezone already required by onboarding; the
projection returns timed instants and authoritative all-day date bounds. Existing Quest time/date utilities interpret timed input and display in the Profile zone. Untimed recurring occurrences use their existing `source_slot_date`, without inventing a time or copying an occurrence.

**Alternatives:** (a) A dedicated `calendar_entries` table that copies Quest occurrences into itself
would give one simple query but create a second source of truth that must be reconciled on every
completion, reopen, reschedule and materialization, and it would break CS-AC-04 by construction.
(b) Extending `quests` with a non-Quest kind would let the Calendar reuse the Quest machinery, but
every Quest read, status check, reward rule and archive predicate would then have to exclude a kind
that can never complete — the exact duplicated-engine risk ADR-018 rejected. (c) Generating
occurrence rows for classes and shifts and simply marking them non-rewarding would put appointments
inside the completion and EXP pipeline and make "did I attend" a Quest decision. (d) A database view
instead of an RPC cannot enforce the ADR-015 entry guard the way the existing RPCs do, and would
widen the exposed column surface. (e) Client-side merging of two separate reads needs no SQL, but it
duplicates ordering, midnight-spanning and range logic in the browser, contradicting ADR-010.

**Impact:** One additive migration, one new owner-activated table with its own policies and indexes,
four new RPCs granted to `authenticated` only, one new feature folder under `src/features/`, one new
protected route, and one new behavior/catalog test pair registered in `tests/helpers/auth-environment.mjs`
at the new migration checkpoint. The `system_single_owner` policy and RPC-guard counts in ADR-015 grow by
exactly the new table and new guards and must be re-verified, not restated. `quest-completion-resolution-wire.mjs`
already asserts migrations one to ten only and is stale since migration eleven (IDEA-003); this ADR
neither fixes nor further breaks it. The new role receives only an owner-bound Profile timezone read policy; existing policies, the frozen event
payload, the completion command and the EXP ledger are unchanged. Schedule Event recurrence is explicitly out of V1; future design requires its own approval.

**Related:** [Calendar/Schedule requirements](../01-requirements/calendar-schedule.md) (CS-01..CS-12,
CS-AC-01..CS-AC-07, OQ-1..OQ-6), [ADR-015](#adr-015--single-owner-database-enforcement),
[ADR-018](#adr-018--recurring-quest-definitions-materialize-lazily-on-read),
[Quest database schema](quest-database-schema.md) sections on occurrence scheduling and read patterns,
[coding guidelines](../04-development/coding-guidelines.md) and
[testing](../04-development/testing.md).

**Correctness details:** the four RPC names/signatures remain intact. Instant parameters transport all-day dates in the current Profile zone; SQL stores authoritative `start_date`/exclusive `end_date`, and the projection emits null all-day clock values. Missing end means one day; a provided end denotes the last included date. Events without an end appear only on their start day. Removal retains a `removed_at` tombstone against late create retries without introducing attendance, completion, reward or EXP state. Identical updates are no-ops; concurrent updates remain last-write-wins. No historical migration is changed. See [implementation and validation](../04-development/calendar-schedule-v1.md).

## ADR-020 - Goals as Main Quests with live derived progress

**Date:** 2026-09-30. **Status:** Accepted architecture, finalized under the Product Owner's
approval and nine final product decisions. Not implemented; this task does not authorize implementation.

**Context:** Goals must group existing one-off Quests without another task/completion engine.
Existing Quest definitions have importance and unused parent UUID placeholders; occurrences
own execution state and fixed parent snapshots. Older requirements describe contribution delivery
and suppress new progress for archived parents. Those semantics need an explicit amendment for
the requested current-membership ratio; they are not silently inherited by a new Goal table.

**Decision:** Present a Goal as a Main Quest, a linked Quest as a Sub Quest and a standalone Quest
as a normal Quest. Importance, priority and historical uses of main remain independent; never
infer membership from them. Link an existing one-off definition and
its unique existing occurrence as a Sub Quest, with at most one current Goal per Quest. Keep
standalone Quests. Derive completed/total from current links and current occurrence status;
nonempty all-complete is derived, never persisted. Persist archival only. Archived Goals retain
membership and display live counts but reject Goal edits until restored. Quest completion,
Reopen V2, EXP and Calendar contracts remain unchanged. Exact derived completion is
`total_subquests > 0 AND completed_subquests = total_subquests`; empty means 0%, completed=false,
including when archived. Percentage is unweighted read/presentation data, never mutable storage.
The current occurrence's completed status is authoritative, so ordinary completion/reopen changes
the next consistent read without a Goal repair command. Attaching completed work counts
immediately; detaching removes the member from the denominator and, if completed, numerator.

Use `public.goals`, retained membership intervals in `public.goal_quest_links` and private
immutable `system_internal.goal_commands` receipts for durable idempotency. Revision-guard Goal
mutations; replay accepted requests before checking live revisions. A dedicated RLS-bound Goal
executor gets only Goal writes and owner-bound Quest reads, not Quest/EXP mutation capability.
Every public entry point follows ADR-015, with restrictive policies installed on new objects.

Enforce cardinality with partial unique index `uq_goal_quest_current` on quest_id WHERE
detached_at IS NULL. Archived Goals retain current membership; detached rows do not block
attachment elsewhere. Normal detach closes an interval, never hard-deletes it. Exact accepted
attach/detach retries return historical receipts without recreating or closing later membership.
Fresh metadata/attach/detach requests reject while archived, including would-be no-ops. Restore
first; archive/restore is desired-state and idempotent. Recorded retries while archived perform
no mutation. Historical completion snapshots are deferred to a future Goal History/Milestone feature.

V1 exposes stable attach-order only: stored position, append after the current maximum under
locks, deterministic position then link ID reads, preserved survivor order after detach, and
reattachment at the end. Manual reorder is deferred; there is no V1 reorder RPC, input or column
UPDATE grant. Position and a reserved journal command type already support future reorder without
a table/column/index/constraint change or backfill; the future RPC and authorization grant need
separate approval and must reject archived Goals. No V1 RPC accepts the reserved reorder type.
This leaves seven public RPCs: create, update metadata, set archived, attach, detach, get and list.

Attach SQL validates one_off definition, absence of any recurrence rule and exactly one existing
occurrence with null recurrence provenance under the shared owner lock. Recurring/stopped/paused
series and their occurrences reject server-side. Existing archived Quest links remain counted by
occurrence status; fresh attach rejects archived Quests. Retained restrictive FKs block deleting
referenced Quests/occurrences even after detach. No Quest archive/delete flow is introduced.

**Explicit amendment:** For Goals/Main Quest V1, membership replaces the unimplemented
fixed-parent contribution integration described in Quest requirements sections 7/19 and AC-14,
Quest domain model sections 10/21, and Quest physical design sections 8/17. Main Quest UI terminology
names the Goal, independently of existing `importance = main`. Archived Goal counts remain live.
Do not populate or rewrite legacy parent fields, snapshots or completion event payloads; reject
nonnull legacy attribution during attach pending reconciliation. Broader Projects and historical
contribution reporting remain deferred. This accepted amendment takes precedence for Goals V1;
older documents are retained as history outside the three-file finalization scope.

**Alternatives:** Reusing direct_goal_id would mix mutable grouping with frozen occurrence
attribution and require wider Quest command changes. Many-to-many membership is unnecessary for
V1 and conflicts with the earlier single-parent direction. Persisted completion/percentage or
event-driven counters require synchronization and reopen compensation. Two tables with only
desired-state writes cannot safely replay an earlier attach/archive after a later detach/restore;
immutable receipts add storage while preserving later intent. A separate task engine duplicates
the accepted Quest lifecycle and is excluded. Exposing manual reorder now adds an unnecessary
command/UI surface; stable attach-order with position retained is the smaller V1 contract.

**Consequences:** Progress can decrease after reopen or attach, increase after detach, and change
while archived. No permanent Goal completion milestone or EXP is implied. Retained links block
Quest/occurrence deletion even after detach. Additive role-specific read policies are required
because existing restrictive Quest policies enumerate their roles. Application refresh coverage
must include Goals after existing Quest actions; historical migrations and Calendar are unchanged.

**Related:** [Finalized requirements](../01-requirements/goals-main-quest-v1.md),
[audited schema/RPC/security/test/rollout architecture](goals-main-quest-v1.md), ADR-012, ADR-013,
ADR-015, ADR-018 and ADR-019. No implementation, migration or database action is authorized here.

## ADR-021 - Recurring retirement retains exact occurrence state

**Date:** 2026-10-03. **Status:** Accepted by Product Owner for Recurring Quest Archive/Delete V1; implementation on `feat/recurring-quest-archive-delete-v1`, not deployed.

**Decision:** Archive is reversible retirement via `quests.archived_at`. Preserve the recurrence rule, stopped_at, revision, materialized count and every existing occurrence/status/cycle/provenance. Existing active projections and guards hide/freeze archived occurrences. Restore clears archived_at and retains prior Pause/running state. Running series can materialize eligible today/future slots again, without past backfill, duplicate slots or reclaimed capacity.

Permanent delete requires an already archived definition and sets deleted_at. It preserves all rows, event/command history, completion aliases, credits/reversals, milestones and unlocks. Completed recurring occurrences do not require Reopen: the definition has no reward entitlement. Any desired correction must happen before permanent deletion. Fresh Pause/Resume and occurrence commands reject retirement; accepted historical receipts remain recoverable before lifecycle checks. One-off deletion prerequisites are unchanged.

**Alternatives:** Clean-auto-cancellation would alter retained occurrence status, complicate restore, and misclassify reopened drafts and completed future slots without a larger audit classifier. Keeping archived occurrences actionable would require changing shared projection and guard semantics. Both are rejected for this V1. This decision supersedes the older recurring archive cancellation/unfinished-work design in Quest requirements and schema/domain notes.

**Impact:** One additive migration; recurring-specific RPCs and archived read; no new dependencies, table columns, RLS policies or EXP source. Existing RLS-bound command role and shared owner/Quest lock order serialize retirement with generation, completion, Reopen and Pause. The new migration retains explicit owner guards on replaced commands and applies after the historical owner-activation checksum boundary. Browser tombstone history remains hidden. Account-level retirement recovery uses a separate versioned namespace so old one-off pending contracts remain exact.

**Validation and rollout:** See [Recurring retirement handoff](../04-development/recurring-quest-archive-delete-v1.md). Apply the new migration before deploying its UI; do not rewrite prior migrations. No Cloud operation is authorized by this ADR.

## ADR-022 - SYSTEM-owned versioned timezone rules

**Status:** Accepted by Product Owner on 2026-10-04; backend and frontend implementation
complete on `feat/recurring-schedule-defaults-v1`.
Supersedes the uncommitted live-provider/attestation design. See [ADR-022](adr-022-transition-derived-timezone-catalog.md)
for immutable side-by-side releases, pinned recurring authority, fail-closed integrity,
source provenance and independent acceptance gates. The frontend adds recurring creation
schedule defaults, Quest-ID series management, base-revision schedule edit recovery and the
materialization warning surface; Calendar stays write-free. See the
[resolver handoff](../04-development/recurring-schedule-resolver-v2.md). Deployment remains unauthorized.

## ADR-023 - Library books with private ownership and revision-guarded edits

**Date:** 2026-10-07. **Status:** Product decisions accepted by the Product Owner's
Library V1 L0 request; detailed contract recorded for L0 sign-off. Not implemented.
This documentation task does not authorize L1, migration, code or deployment.

**Context:** The repository has conceptual Knowledge/books intent but no Library
implementation. PR #54 supplies the SYSTEM shell and presentation foundation.
Goals and Calendar supply owner-guarded command/security precedents, while Quest
recovery exists for progression and exact historical-command semantics that books
do not need. The Product Owner explicitly includes manual covers, summary and
responsive BookCards, superseding the earlier discovery audit's deferral/list-row
recommendations.

**Decision:** Introduce one future `public.books` table. Use immutable UUID identity
and verified request-derived user_id; required trimmed title, optional author and
manual optional HTTPS cover_url; text + CHECK status with want_to_read, reading and
finished; summary/content_notes/lessons as nullable bounded plain-text columns.
No note child tables, ISBN or title/author uniqueness. Preserve book identity and
readability independently of cover loading; missing/broken covers use local/CSS
fallback. Never fetch/proxy covers server-side or integrate an external book API.

Use archived_at independently of status: archive preserves all content/status;
restore clears archival and preserves content. Archived books remain readable but
require restore before editing. Finished does not imply archived; any valid status
can transition to any other. V1 is archive-only, with no hard-delete API/UI/runtime
grant. Database-owned revision starts at 1 and advances with updated_at only on
actual mutations. Edit/status/archive/restore check expected revision atomically,
rejecting stale writes before no-op handling.

Create uses a stable UUID retained across uncertain transport retries. Repeated
create cannot duplicate or overwrite an existing book; no upsert update. There is
no Quest command ledger, durable receipt, cycle, alias, EXP/progression lock or
generic recovery coordinator. Recovery reads current state and preserves in-memory
drafts for explicit review; any pending-create reload storage contains minimum
identity metadata only. No autosave, persistent note drafts or offline editing.
Confirmed database success with failed UI invalidation means saved/refresh-required.

Follow ADR-014/015 and the Goals/Calendar security boundary: both row ownership and
configured-single-owner restriction, guarded public RPCs with fixed safe search_path,
RLS-bound reads and a dedicated NOLOGIN/NOBYPASSRLS Library write executor that does
not own books. Do not reuse the Quest executor. Install new policies/guards in a
new additive migration; historical migrations remain immutable.

Use `/library`, `/library/new` and a separate `/library/[id]` detail/edit route.
Library becomes the real fourth SystemShell destination, including nested active
state, EN/VI copy and proxy coverage while preserving Dashboard's Calendar/date
behavior. One semantic responsive cover-led BookCard uses a desktop/tablet grid
and compact mobile layout. Long text is detail-only, excluded from collection
payloads. Reuse PR #54 primitives/tokens/reduced motion; L3 includes mobile and
accessibility. Add no alternate routes, dependencies or second visual system.

**Alternatives:** Status enums add no benefit over the existing CHECK convention.
Normalized notes, provider catalogs and social/analytics features exceed the
approved small knowledge-capture scope. Last-write-wins can erase long notes;
revision guards prevent that without the complexity of historical receipts.
Hard deletion breaks retention and complicates late create retries. Modal or
split-only long-form editing is weaker on mobile than the approved detail route.
Direct authenticated writes and reused Quest permissions weaken the focused
new-domain boundary. A list-only collection does not meet the approved cover-led
BookCard direction.

**Consequences:** One future domain table and focused list/detail/create/update/
set-archived commands, independent of Quest and EXP. Reads stay bounded; long text
and external-image failures cannot burden the collection contract. An uncertain
write is resolved from current state, not claimed as historical replay. Revision
conflicts require explicit review. Owner RLS and privilege/catalog tests, Unicode/
URL validation, response-loss tests, EN/VI and desktop/mobile journeys are required.
Future quotes/tags/notes/sessions/providers can reference stable book/owner identity
without being implemented now. Database rollout precedes UI rollout under separate
authorization; frontend rollback retains book data.

**Related:** [Requirements](../01-requirements/library-v1.md),
[architecture and technical refinements](library-v1.md),
[L0-L4 handoff and validation plan](../04-development/library-v1.md), ADR-010,
ADR-014, ADR-015, ADR-017, ADR-019 and ADR-020. Text/URL limits and detailed
command/pagination/reload parameters are recorded in the L0 contract for sign-off.
