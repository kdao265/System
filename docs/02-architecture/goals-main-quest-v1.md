# Goals / Main Quest V1 finalized architecture

Date: 2026-09-30. Status: **approved architecture, finalized against the Product Owner's
decisions; not implemented**. Branch: `feat/goals-main-quest-v1`.
Related: [requirements](../01-requirements/goals-main-quest-v1.md),
[ADR-020](decisions.md#adr-020---goals-as-main-quests-with-live-derived-progress), ADR-015.

Scope: repository-only audit and documentation. The branch was already selected and the working
tree was clean at the original audit start. Finalization preserves that task's three uncommitted
documentation files. No database was queried; deployment state is not inferred from
checked-in migrations or old handoff claims. This document is the implementation handoff, not
a migration or permission to implement. This finalization changes only the requirements,
architecture and ADR-020; only documentation/link/whitespace checks are authorized.

## 1. Audit findings

| Boundary | Repository evidence | Design implication |
| --- | --- | --- |
| Definitions/occurrences | [Quest storage](../../supabase/migrations/20260918034836_create_quest_engine.sql): `public.quests`, `quest_occurrences`, `quest_recurrence_rules`, `quest_events`; `uq_one_off_occurrence` is unique on quest_id where recurrence_rule_id is null. | Execution belongs to occurrences. The unique index guarantees at most one one-off occurrence, not existence; attach must verify exactly one existing occurrence. |
| Existing parent placeholders | Same migration: `quests.direct_goal_id/project_id`; occurrence `direct_goal_id_snapshot/project_id_snapshot`; mutually exclusive nullable UUIDs with no Goal/Project FK. Creation [currently writes null](../../supabase/migrations/20260926120000_quest_completion_aliases.sql). | Do not assume an existing Goal table or repurpose immutable execution snapshots for mutable grouping. |
| Completion | Latest completion implementation in [completion aliases](../../supabase/migrations/20260926120000_quest_completion_aliases.sql), then entry-guarded by [ADR-015 activation](../../supabase/migrations/20260928100000_activate_private_owner.sql). Accepts draft/scheduled/active, checks expected cycle, records event/ledger/progression, and sets occurrence status completed atomically. | Read current occurrence status, never count completed events or replay receipts. |
| Reopen | Same latest migration replaces [Reopen V2](../../supabase/migrations/20260926000000_quest_reopen_v2.sql): correction + exact compensating EXP, reopened event, cycle + 1, scheduled or draft status, cleared completion times. Legacy V1 EXECUTE remains revoked. | A fresh read after commit must immediately lose that completed contribution; no Goal write hook is needed. |
| EXP | [Ledger](../../supabase/migrations/20260919063117_create_exp_ledger.sql): append-only credit/reversal, source uniqueness and unique reversal. [Progression](../../supabase/migrations/20260920050000_create_level_rewards.sql) is invoked by Quest commands. | Goal commands must receive neither ledger write privileges nor progression-recognition capability. Zero-EXP completed Quests still count as complete. |
| Recurring Quests | [Recurring migration](../../supabase/migrations/20260928181000_create_recurring_quests.sql): create definition/rule, lazily materialize selected day, pause/resume; daily/weekly/monthly public creation. Storage also admits custom recurrence. | Reject recurrence_mode other than one_off, any rule, or occurrence recurrence provenance. Stopping a series does not make it one-off. |
| Calendar | [Calendar migration](../../supabase/migrations/20260929120000_create_schedule_events.sql): stable invoker projection of existing occurrences UNION schedule_events. No materialization in the read. | Membership does not add Calendar rows or change that query. Goals have no Calendar representation in V1. |
| Application | [Quest day reads](../../src/features/quests/data.ts) materialize before day projection. [Completion](../../src/features/quests/completion-action.ts) and [reopen](../../src/features/quests/reopen-action.ts) currently invalidate only dashboard. | A Goal read must be independent of day filtering/materialization. Future application wiring must refresh Goal reads after Quest success/recovery as well as dashboard. |
| Private owner | [Install](../../supabase/migrations/20260928090000_install_private_owner.sql) and activation: `system_private.require_owner()`, restrictive single-owner policies, owner identity from `system_internal.request_user_id()`. | New relations and RPCs need their own guards; the historical activation uses fixed lists and will not secure future objects automatically. |
| Retention | Quest FK chains use RESTRICT; browser has no Quest DELETE, and current public command inventory has no Quest archive/delete RPC. | Retain links; never cascade-delete Quest history. Do not pretend the broader documented Quest archive flow is implemented. |
| Test conventions | [Catalog SQL](../../supabase/tests/calendar-schedule-catalog.sql), [behavior SQL](../../supabase/tests/calendar-schedule.sql), [checkpoint harness](../../tests/helpers/auth-environment.mjs), [owner wire suite](../../supabase/tests/private-owner-wire.mjs), Node `node:test`, [Playwright Quest fixture](../../tests/e2e/quest-fixtures.ts). | Add catalog/behavior at a new checkpoint and extend final owner regression; preserve historical checks. Use existing disposable harnesses only in a later authorized implementation task. |

The project context and architecture overview contain older statements that Quest/progression
application behavior is deferred. Current source and migrations above establish the audited
implementation. This design does not refresh those unrelated documents or assert Cloud parity.

### Explicit reconciliation with older design

[Quest requirements](../01-requirements/quest-engine.md) section 6 uses Main for importance;
sections 7, 19 and AC-14 describe fixed Goal attribution and no new contributions to archived
parents. [Physical design](quest-database-schema.md) sections 8 and 17 anticipate adding FKs to
the placeholder parent fields. Those are not the finalized V1 membership mechanism.

ADR-020 records the approved narrow amendment: Main Quest names the Goal UI entity; a linked
Quest is a Sub Quest and a standalone Quest remains a normal Quest. Existing Quest importance,
priority and historical uses of main remain independent; none infer membership. Current
planning membership lives in links, and progress
is a live query even for an archived Goal. No downstream contribution delivery, snapshot
backfill or freeze-at-archive is used. The old fixed attribution fields and event payloads stay
unchanged. One current Goal per Quest preserves the old single-parent direction. Reject nonnull
legacy Goal/Project attribution at attach rather than silently interpreting it. ADR-020 and this
section explicitly supersede those older integration statements for Goals/Main Quest V1 only.
The older documents are preserved outside this task's three-file scope; future documentation
maintenance can add cross-references without changing this finalized decision.

## 2. Finalized boundaries and correctness decisions

Use two domain relations (`goals`, `goal_quest_links`) and one private immutable command receipt
relation. The latter is the minimum extra persistence for durable retries after intervening
changes; it is not a completion/event-delivery engine. All actual work remains a Quest.

| Question | Decision |
| --- | --- |
| Exact complete fact? | The bound one-off `quest_occurrences.status = 'completed'` in the current read snapshot. No EXP amount, historical event existence, latest receipt, timestamp alone or definition importance inference. |
| Reopen effect? | Existing atomic reopen changes the same occurrence to draft/scheduled. Every subsequent fresh Goal query counts it incomplete. Failed/rolled-back reopen changes nothing. |
| Multiple Goals per Quest? | No simultaneous membership in V1. An archived Goal still holds membership. Restore/detach before attaching elsewhere; no implicit move. Historical detached memberships can span several Goals. |
| Linked Quest archived/deleted? | Keep archived links in progress, expose Quest archival in the row, and do not implicitly detach. Reject new attachments to archived definitions. FK RESTRICT blocks deletion of linked or historically linked Quest/occurrence. No purge operation in V1. |
| Order? | Stable attach-order in V1: integer position on each membership, append after the current maximum, read by position then link ID. Keep the column for later manual reorder; expose no reorder RPC/UI now. |
| Persist completion? | No. Persist only archived_at; derive nonempty all-complete. No completed_at, mutable progress, milestone or reward. |
| Prevent recurring attachments? | Validate definition mode, absence of any rule, and exactly one non-recurring occurrence under the shared owner transaction lock. No public one-off-to-recurring conversion exists; future conversion must reject retained links under the same lock. |
| Preserve history? | Stable Quest/occurrence references, retained membership intervals and immutable accepted Goal command records. Quest events and ledger remain the sole execution/EXP history. Never copy completion state into links or Goal receipts. |

Proposed application module: `src/features/goals` for validated request/response adapters and
application services; owner-gated list/detail UI renders server counts. Reuse existing Quest
controls/providers and recovery services by occurrence ID + execution_cycle. Do not wrap
completion inside a Goal transaction or create `complete_goal`/`complete_subquest` RPCs.
Attachment selects from owned existing one-off definitions/occurrences across all dates,
including unscheduled and completed work; never reuse the day-list as the membership catalog.
Candidate filtering in the adapter is advisory; attach SQL is authoritative.

## 3. Exact additive schema contract

This is a data contract, not executable DDL. Types use existing UUID/text/timestamptz conventions.
All timestamps are server assigned. All listed FK actions are ON UPDATE RESTRICT / ON DELETE
RESTRICT. No dependency, change to a Quest column/index/event envelope, or historical migration edit.

### public.goals

| Column | Type/nullability/default | Constraints/meaning |
| --- | --- | --- |
| id | uuid NOT NULL, no default | PK; caller-generated Goal identity |
| user_id | uuid NOT NULL | FK auth.users(id); assigned from request identity |
| title | text NOT NULL | Non-whitespace, char_length <= 120 |
| description | text NULL | char_length <= 4000 |
| archived_at | timestamptz NULL | Null means available; nonnull means archived |
| revision | bigint NOT NULL DEFAULT 1 | CHECK revision >= 1; increments once per effective Goal mutation |
| created_at | timestamptz NOT NULL DEFAULT now() | Creation time |
| updated_at | timestamptz NOT NULL DEFAULT now() | Last effective Goal mutation; never changed by Sub Quest completion |

Additional UNIQUE (id, user_id), index (user_id, id) for stable owner pagination. No persisted
status, percentage, completed count, completed_at, reward, recurrence, parent Goal or deadline.

### public.goal_quest_links

| Column | Type/nullability/default | Constraints/meaning |
| --- | --- | --- |
| id | uuid NOT NULL DEFAULT gen_random_uuid() | PK; one membership interval |
| user_id | uuid NOT NULL | Assigned owner; FK auth.users(id) |
| goal_id | uuid NOT NULL | Composite FK (goal_id, user_id) -> goals(id, user_id) |
| quest_id | uuid NOT NULL | Composite FK (quest_id, user_id) -> quests(id, user_id) |
| occurrence_id | uuid NOT NULL | Composite FK (occurrence_id, quest_id, user_id) -> quest_occurrences(id, quest_id, user_id) |
| position | integer NOT NULL | CHECK position >= 1; last display position, not a priority/weight |
| attached_at | timestamptz NOT NULL DEFAULT now() | Interval start |
| detached_at | timestamptz NULL | Interval end; CHECK null or >= attached_at |

Indexes (exact definitions for later implementation, not DDL executed in this task):

| Name | Keys / predicate | Purpose |
| --- | --- | --- |
| uq_goal_quest_current | UNIQUE (quest_id) WHERE detached_at IS NULL | One currently attached Goal per globally unique Quest, even if Goal archived; detached history does not participate. |
| ix_goal_links_current_order | (user_id, goal_id, position, id) WHERE detached_at IS NULL | Current membership/detail order. |
| ix_goal_links_goal_owner | (goal_id, user_id) | Retained Goal FK lookups. |
| ix_goal_links_occurrence_owner | (occurrence_id, quest_id, user_id) | Retained occurrence FK lookups. |
| ix_goal_links_quest_owner | (quest_id, user_id) | All retained Quest references. |

Stable attach-order is the smallest V1 contract. Under the owner/Goal locks, a fresh attach uses
COALESCE(max(position) over current links for this Goal, 0) + 1. Duplicate attach changes no
position. Detach leaves gaps and preserves survivors' order; reattachment appends a new link.
No unique position constraint: the serialized commands assign distinct current positions and
reads always tie-break by id. Do not sort by timestamps, title, importance or completion.
Integer overflow rejects the entire attach without effects; there is no implicit compaction.

Keep position and reserve the journal's reorder command type now so future manual reorder needs
no table, column, index or constraint change and no data backfill. It will need a separately
approved RPC/UI and narrowly granted position UPDATE privilege. Deploying that future routine/
grant may use a migration file, but no storage-schema migration is needed merely to enable ordering.
No reorder command, placeholder endpoint, position input, or position UPDATE grant is exposed in V1.

The occurrence reference freezes identity, not completion state. The existing one-off uniqueness
plus attach validation proves a single valid target. Retain detached rows permanently in V1;
reattach inserts a new row. Private trigger guards on this new table prohibit identity/reference/
attached_at edits and prohibit reactivating or editing detached rows. A current row may change
only position or set detached_at once at the storage-guard level; V1 grants UPDATE only on
detached_at, so position cannot be changed through any V1 command. No DELETE grants/policies.

### system_internal.goal_commands

| Column | Type/nullability/default | Constraints/meaning |
| --- | --- | --- |
| user_id | uuid NOT NULL | Owner, FK auth.users(id) |
| command_id | uuid NOT NULL | PK (user_id, command_id) |
| goal_id | uuid NOT NULL | Composite FK (goal_id, user_id) -> goals(id, user_id) |
| command_type | text NOT NULL | CHECK in create, update_metadata, set_archived, attach, detach, reorder; reorder is reserved for future use, never accepted by a V1 RPC |
| request | jsonb NOT NULL | CHECK object; canonical validated input including goal_id and expected_revision when relevant |
| result | jsonb NOT NULL | CHECK object; exact version-1 receipt below, excluding replay |
| recorded_at | timestamptz NOT NULL DEFAULT now() | Accepted transaction timestamp |

Index (user_id, goal_id, recorded_at, command_id). No UPDATE/DELETE grants/policies; an immutable
row trigger rejects UPDATE/DELETE like existing append-only history protections. RPCs validate
the exact command-specific JSON keys/types, and receipt structure, rather than relying solely
on the object CHECK. Retain accepted no-op receipts too. Rejected/rolled-back requests leave no
record. The request/receipt captures membership identities and metadata edits,
not occurrence state, EXP, or computed progress. No retention cleanup in V1.
The reserved reorder type adds no V1 command, handler or privilege; all five mutation RPCs use
their fixed command type. This avoids changing the journal constraint when reorder is later approved.

Goal commands have their own owner-scoped command namespace: the same UUID used for a Quest
command does not bind a Goal command. Within Goals, changing operation, Goal, revision or payload
under a recorded command ID is conflict. No change to the Quest command/alias namespace.

## 4. RPC contracts and transaction semantics

All signatures below are `public`, with named parameters exactly as shown; all return `jsonb`.
No overloads, user_id parameter or caller-supplied timestamps. Mutation parameters without an
explicit default are required, even if description is null.

| RPC | Parameters | Effect |
| --- | --- | --- |
| create_goal_v1 | p_command_id uuid, p_goal_id uuid, p_title text, p_description text | Insert empty Goal at revision 1. A preexisting Goal ID with an unrecorded command is conflict; do not compare against mutable live metadata to infer a replay. |
| update_goal_v1 | p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_title text, p_description text | Replace both metadata fields; identical values are a recorded no-op. |
| set_goal_archived_v1 | p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_archived boolean | Archive/restore desired state; never a toggle. Same desired state is a recorded no-op. |
| attach_goal_quest_v1 | p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_quest_id uuid | Validate eligibility, append membership. Already currently linked to this Goal is a recorded no-op returning that link; another Goal is conflict. Caller cannot nominate an occurrence. |
| detach_goal_quest_v1 | p_command_id uuid, p_goal_id uuid, p_expected_revision bigint, p_link_id uuid | Close that exact membership interval. Already detached is a recorded no-op. Never detach a later reattachment implicitly by Quest ID. |
| get_goal_v1 | p_goal_id uuid | One Goal summary plus ordered current Sub Quests, including archived Goal when requested directly. |
| list_goals_v1 | p_scope text DEFAULT 'unarchived', p_after_id uuid DEFAULT NULL, p_limit integer DEFAULT 50 | Scope unarchived/archived/all; UUID ascending keyset after p_after_id, limit 1..100. Unarchived includes derived-complete. Return summary page and next_after_id. |

Normalize input text once in SQL: trim title/description; blank description becomes null; title
must remain nonblank. SQL enforces character limits; adapters validate input and response types
as an additional boundary. Canonical request is a JSON object of the normalized named arguments
excluding p_command_id (stored separately), with revision serialized as a decimal string.
Exact normalized request equality governs replay; invalid/null identities/revisions/booleans
are not accepted.

Attach requires: same owner; unarchived Goal and Quest; q.recurrence_mode exactly one_off; no
quest_recurrence_rules row even if stopped; exactly one occurrence total whose recurrence_rule_id,
recurrence_revision, source_slot_date and source_timezone are all null; both definition parent
fields and both occurrence parent snapshots null. This SQL validation runs under the shared
owner lock before any link/receipt insert; UI filtering alone never establishes eligibility.
All six existing occurrence statuses are eligible; attaching never changes status. Ineligible or
inconsistent data fails closed. These are cross-table command checks, not fictitious SQL CHECK
constraints. Clients have no direct writes; existing RPCs cannot convert recurrence or insert an
extra one-off occurrence. Any future conversion, purge or repair command must preserve these
invariants and share locking. Administrative bypass is not an application capability.

### Mutation algorithm

1. First executable statement: `PERFORM system_private.require_owner()`. Then derive actor from
   `system_internal.request_user_id()` and validate required arguments without exposing subjects.
2. Acquire existing `progression_internal.lock_owner(actor)` before any row locks. Its stable
   advisory key is already shared by Quest create/complete/reopen/materialize. Grant only this
   lock helper to the Goal executor, never EXP/progression recognition helpers. Goal-only row
   lock order is Goal then links in UUID order; Quest rows are read under the owner lock, not
   locked with FOR UPDATE (which would require unnecessary Quest UPDATE privilege).
3. Look up the owner-scoped command record before live revision/archival/eligibility checks.
   Same command type + canonical request returns retained receipt with replay=true and no effects;
   any difference rejects. Replays after later archive/detach/restore/reopen remain historical.
4. For fresh non-create commands, lock the owned Goal FOR UPDATE and compare expected_revision.
   Mismatch rejects even when the desired value now happens to match. Unknown/inaccessible subject
   gets the same generic not-found error. Check archival (only set_archived allowed when archived),
   referenced link ownership/Goal and operation-specific eligibility.
5. Apply effective Goal/link edits and increment Goal revision exactly once (create starts at 1).
   No-op leaves timestamps/revision unchanged. Insert immutable command record even for a no-op;
   return receipt. Failure at any point rolls back all writes. No Quest/EXP writes or helper calls.

For fresh commands, capture one server operation timestamp with clock_timestamp() after acquiring
the owner lock, and explicitly use it for affected timestamps and the receipt. Do not use a
transaction-start timestamp that predates a membership created while this transaction waited.

An exact duplicate request has the same accepted result despite later edits. A new command with
stale expected_revision is rejected. The caller must refresh and make a new explicit decision;
it must not silently change the revision on a pending request. Revision overflow rejects atomically.
The shared owner lock serializes concurrent attachment to different Goals and existing Quest
transitions; unique active membership remains the database backstop. Reads need no write lock.

### Attach/detach and archived retry matrix

| Request | Outcome |
| --- | --- |
| Exact recorded attach after its link was detached | Historical receipt, replay=true; no reattachment, new position, revision or Quest effect. |
| Exact recorded detach after a later reattachment | Historical receipt, replay=true; never closes the new link. |
| Fresh attach to same Goal with a current link | After current revision, Goal archival and Quest eligibility checks, recorded no-op returning that current link. |
| Fresh attach after detach | New command ID and current Goal revision create a new interval, possibly in another Goal; old detached rows remain. |
| Fresh detach of an already detached link | Recorded no-op after revision/archival/subject checks; does not select a newer link by Quest ID. |
| Fresh metadata/attach/detach against archived Goal | Reject with 23514, including would-be no-ops; restore first. No V1 reorder endpoint exists. Any future reorder must reject archived Goals too. |
| Exact recorded edit retry while Goal is now archived | Return the historical receipt only. Replay is acknowledgment of a prior transaction, not permission for an archived mutation; no data changes. |
| Archive/restore retry | Exact recorded request replays without changing later state. New command/current revision with already desired archive state is a recorded no-op. |

In every case changed intent under a recorded command ID is 23505; unrecorded stale revision is
23514. New attachment to another currently attached Goal is 23505, even if the other Goal is
archived. Only detached rows release membership; no hard deletion or archive-based exemption.

Receipt fields: `{version: 1, command_id: uuid, goal_id: uuid, command_type: text,
revision_before: decimal-string, revision_after: decimal-string, changed: boolean,
link_id: uuid|null, recorded_at: ISO-timestamptz, replay: boolean}`. Creation has before="0".
link_id is populated only for attach/detach. `result` retains all fields except replay, which is
false initially and true on replay. It contains no live Goal representation. Always reread after
success/replay; never use historical revision_after to overwrite a newer displayed revision.

Error contract: 42501 for owner/auth rejection; 22023 for malformed input; P0002 with generic
`Goal subject not found` for unknown/inaccessible Goal, Quest or link; 23505 for command identity
conflict, reused create Goal identity, or membership in another Goal; 23514 for stale revision,
archived edit, ineligible Quest or invariant/overflow failure.
Use fixed sanitized messages for each recognized rejection so adapters distinguish definite
rejection from unknown transport/internal failures. No raw database details in UI/logs.

### Read response contracts

Summary fields: `id`, `title`, nullable `description`, nullable `archived_at`, `created_at`,
`updated_at`, `revision` (decimal string), `total_subquests` and `completed_subquests` (decimal
strings), `is_complete` (boolean), `display_state` (active/completed/archived). No stored or returned
percentage is needed in the RPC. Presentation derives it by the exact rules below; 0/0 is
explicitly 0%, is_complete=false, never undefined, NaN or 100%.

`get_goal_v1` returns `{version: 1, goal: summary, subquests: [...]}`. Each row has `link_id`,
`quest_id`, `occurrence_id`, `position` (integer), `attached_at`, Quest `title`, `quest_archived_at`,
occurrence `status`, `execution_cycle` (integer), `scheduled_at`, `deadline_at`, and nullable
`reward_exp_snapshot` for the existing Quest controls. No detached intervals in this current view.
`list_goals_v1` returns `{version: 1, goals: [summary...], next_after_id: uuid|null}`; query limit+1
to determine continuation, returning the last emitted ID only when another row exists. Every
summary counts all current links regardless of page size. Detail not found uses P0002; list
with no rows returns an empty array. Null/unknown scope or invalid limit is 22023.

Both are STABLE SECURITY INVOKER with `search_path = pg_catalog`, first-statement owner guard,
explicit owner predicates and a single relational snapshot for Goal/counts/rows. Reuse one
canonical private invoker projection definition for summary calculation (no definer view/RLS
bypass); no materialization or durable cache. Its SELECT/EXECUTE privileges must be limited to
the caller roles and its dependency reads remain under RLS.

## 5. Lifecycle, progress and refresh semantics

### Exact progress query semantics

Evaluate the following in one consistent relational read snapshot, after the owner guard and RLS:

1. Select owned Goals, including an archived Goal when the read scope requests it. For each Goal
   g, select links l where l.goal_id=g.id, l.user_id=g.user_id=request_user_id(), and
   l.detached_at IS NULL. Do not filter links by the linked Quest's archive flag, date or status.
2. LEFT JOIN each link's Quest on (quest_id, user_id), and its occurrence on
   (occurrence_id, quest_id, user_id). These joins are one-to-one through existing unique keys.
   Keep the Goal row even if there are no links; do not join Quest events/EXP into this aggregate.
3. `total_subquests = COUNT(l.id)`, not COUNT(*) over the outer join.
   `completed_subquests = COUNT(l.id) FILTER (WHERE o.status = 'completed')`.
   Every other occurrence status counts toward total only. Detached history counts toward neither.
4. `is_complete = (total_subquests > 0 AND completed_subquests = total_subquests)`.
   `progress_percent = CASE WHEN total_subquests = 0 THEN 0 ELSE
   100 * completed_subquests::numeric / total_subquests END` is presentation/read-model data only.
   Use numeric division and round only for display; never derive completion from rounded percent.
5. `display_state = archived if archived_at != null, else completed if is_complete, else active`.
   Empty Goals always have counts 0 and 0, progress 0%, is_complete=false. Archive changes only
   display precedence, not these facts.

Both list and detail reject an inconsistent current reference with 23514 rather than dropping
it from the denominator or returning a misleading success; owner-safe FKs normally prevent this.
Read integrity checks must share the same snapshot as the aggregate. No caller-visible repair
command is needed for normal completion/reopen: the same occurrence's current status is the fact.
No persisted completion transition, percentage, counter, materialized progress view or Goal reward.
Attaching already-completed work counts immediately (an already-100% ratio stays 100%);
detach immediately removes that member from the denominator and, if completed, numerator.

Reopen is visible as soon as its transaction commits to a subsequent fresh database read. An
already open page is not automatically a live subscription: proposed application integration
must invalidate/refetch Goal list/detail after completion, reopen and successful recovery, and
refresh on navigation/focus. Reuse existing Quest services; expand their application refresh
coverage to Goals in the later implementation without changing SQL lifecycle contracts. If a
refresh fails, report stale/unavailable progress with retry rather than claiming the old 3/3 is
current. Unrelated tabs update on focus/refresh; no realtime dependency is proposed.

Archive locks Goal editing, not the underlying Quest engine. Progress can change while archived.
Metadata update, attach, detach and any future reorder require restore first; archival is a
persisted visibility/lifecycle state, not a snapshot. Goal restore exposes the current answer.
Removing the last incomplete link can create derived
complete; removing every link yields active empty. These are arithmetic consequences, not earned
milestones. Moving a Quest is two explicit commands (detach then attach), not an atomic transfer;
failure after detach leaves it standalone and retryable.

Membership intervals and command records retain when planning changed. Quest events retain
completion/correction cycles, so linking already completed work never fabricates original Goal
attribution. V1 does not claim the current count is the count at an earlier timestamp. Exact
historical cross-domain reporting is deferred; timestamps alone are not a promised total ordering
of Goal and Quest events. Historical completion snapshots belong to a future Goal History/Milestone
feature. No backfill of prior membership or completion state.

### Linked Quest archival and deletion

An otherwise archived Quest keeps its current membership and is counted from occurrence status;
an archived completed Quest remains completed in the ratio. Any actual occurrence cancellation
under Quest-owned archival rules counts as incomplete. Goal code does not perform that transition,
infer completion from archival, or detach implicitly. Reject a fresh attach to an archived Quest.
Current public Quest RPCs expose neither archive nor delete; this contract does not add either.
Existing Quest history retention and archive eligibility remain unchanged. New link FKs use
RESTRICT for both current and detached intervals, so hard deletion of either referenced Quest
or occurrence fails rather than erasing history. Ordinary detach never hard-deletes a link;
it permits later membership elsewhere while retaining these deletion protections.

## 6. Security and access-control changes for review

Use a dedicated `goal_command_owner`: NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOINHERIT, NOREPLICATION, NOBYPASSRLS; owns mutation functions, never tables. No memberships for
browser roles, service_role, Quest/progression executors. All five mutation functions are SECURITY
DEFINER with fixed `search_path = pg_catalog` and fully qualified references. Reads stay invoker.

| Principal | Proposed privilege |
| --- | --- |
| authenticated | Owner SELECT on goals/links; EXECUTE on seven public RPCs; no direct mutation. Existing owned Quest SELECT remains unchanged. |
| goal_command_owner | SELECT/INSERT and column UPDATE (title, description, archived_at, revision, updated_at) on goals; SELECT/INSERT and column UPDATE (detached_at) on links; SELECT/INSERT only on private goal_commands. |
| goal_command_owner on existing data | SELECT only on quests, quest_occurrences, quest_recurrence_rules, with new role-specific owner SELECT policies. No Quest UPDATE, INSERT, DELETE or completion RPC execution. |
| goal_command_owner helpers | USAGE public, system_internal, system_private, progression_internal; EXECUTE request_user_id(), require_owner(), is_owner(), lock_owner(uuid), plus narrowly required new Goal helpers. No access to owner_configuration, auth schema, EXP or reward tables/functions. |
| PUBLIC, anon, service_role, other command roles | Explicitly revoke default privileges on all new tables/functions; no new Goal access or executor membership. Internal projection/trigger helpers are not public RPCs. |

Enable RLS before grants on all three new relations. Install permissive row-owner SELECT/INSERT/
UPDATE policies only for their granted operations and roles, plus restrictive `system_single_owner`
FOR ALL USING/WITH CHECK `(SELECT system_private.is_owner()) AND user_id =
(SELECT system_internal.request_user_id())`. Private commands have no authenticated SELECT.
Never grant DELETE, TRUNCATE, REFERENCES, TRIGGER, broad schema CREATE or default PUBLIC EXECUTE.

Existing restrictive Quest policies enumerate four roles and will not apply to the new role.
Add separate role-specific restrictive owner policies to quests, quest_occurrences and
quest_recurrence_rules as well as the new permissive SELECT policies. Do not broaden historical
policy role lists or assume a new SELECT grant is enough. These additive read policies are the
explicit access-control change; catalog and token-level regression must prove they remain
single-owner. Install new-table guards immediately, without a second activation window or new
owner bootstrap. Missing/mismatched owner configuration must fail closed.

Future pages/actions use the existing server-only owner gate and user-session Supabase client;
no service key or caller-supplied owner. Composite FKs prevent cross-owner associations even if
RPC validation regresses. Goal revisions and command IDs never authorize a caller. Owner-only
read access to archived data remains intentional; non-owner RPC entry fails before replay lookup.

## 7. Test plan (proposed, not run)

Trace to GM-AC-01..10. Use synthetic data and the existing disposable test lifecycles only after
implementation is separately authorized. Do not reuse developer Local/Cloud or change old suites
to accommodate regressions.

### Catalog SQL

Proposed `supabase/tests/goals-main-quest-catalog.sql`: assert exact columns/types/defaults,
same-owner restrictive FKs, partial unique membership, indexes, RLS and permissive/restrictive
policy roles; no writable percentage/status; immutable receipt/link guards; role flags, table
nonownership and no role memberships. Assert seven signatures, JSON contracts, safe search
paths, five definer/two stable-invoker routines, first-statement guards, exact ACLs, revoked
anon/service_role/default PUBLIC privileges and limited Quest SELECT. Pin existing Quest/
completion/reopen/EXP/recurrence/Calendar routine source/ACLs, excluding the specifically added
read policies from an otherwise unchanged baseline. Verify Goal executor cannot call any
completion, EXP append, progression recognition or materialization helper.

### SQL behavior and concurrency

Proposed `supabase/tests/goals-main-quest.sql`, BEGIN/ROLLBACK with ON_ERROR_STOP and synthetic
owner configuration, following Calendar fixtures. Use real create/complete/reopen RPCs for
normal lifecycle assertions; admin fixtures only for currently unexposed failed/cancelled,
Quest archival and malformed legacy data.

- Empty Goal, create/update validation, exact replay, conflicting request identity and no-op receipts.
- 0/3 -> 1/3 -> 2/3 -> 3/3, then reopen -> 2/3, recomplete -> 3/3. Include zero-EXP completion,
  stale cycles and historical completion replay after reopen (must remain 2/3).
- Completed-before-attach, incomplete/failed/cancelled counts, detach complete/incomplete/last
  member, repeat detach of old interval after reattach, two-Goal rejection and standalone move.
- Stable attach-order, append/gaps, unchanged survivor positions after detach, reattachment at
  end, no duplicate position/link on retry, no position UPDATE or reorder RPC; stable pagination
  and all-link counts. Empty Goal is explicitly 0%, is_complete=false in every archive state.
- Archive/restore with replay across intervening restores, blocked archived edits, underlying
  Quest completion/reopen while Goal archived, archived Quest stays counted, fresh attach refused.
- Daily/weekly/monthly/custom, paused/stopped rules, inconsistent one_off + rule, missing or
  invalid occurrence, nonnull legacy attribution: reject without partial effects.
- FK delete restrictions even on detached links; immutable history; no silent denominator shrink.
- Force failure after first intended write and assert whole transaction rolls back including receipt.
- Compare Quest definitions/occurrences/events/aliases, recurrence counters, EXP rows and
  progression/reward rows before/after Goal-only operations: identical. During lifecycle tests
  only normal Quest effects occur once, with exact original reversal and normal new-cycle credit.

Add a disposable two-session concurrency test using the existing concurrency-runner pattern:
two Goals attaching the same Quest (one wins), same command twice (one effect), same revision
different commands (one effective change), attach racing completion/reopen, archive racing
attach, and attach racing detach. Assert final valid counts, no deadlocks and no lost updates.

### Private-owner/security integration

Extend `supabase/tests/private-owner-wire.mjs` and final `private-owner-catalog.sql` inventory
with the new objects/role and exact expected policy counts; do not assume the old total of 16.
Three new tables add three `system_single_owner` policies; the three role-specific Quest read
guards use distinct names. Verify full inventory rather than weakening existing assertions.
Exercise all seven RPCs via real owner/non-owner/anonymous tokens, missing owner configuration,
and owner switch/mismatch. Assert direct writes denied, direct non-owner SELECT empty, public
RPCs 42501, private command storage inaccessible, foreign references hidden and impersonated
request arguments ineffective. Preserve ADR-015 historical activation source hashes and all
existing regression groups, including Calendar projection and completion aliases.

### Node and Playwright

Node tests: validate requests, bigint decimal strings, receipts and read shapes; check ratio and
empty-state presentation without embedding membership rules in UI; owner action guards, unknown
outcome retry using identical payload/command/revision, stale rejection, read refresh failures,
archive controls, candidate filtering and shared Quest lifecycle use. Static migration boundary
tests follow `tests/recurring-migration.test.mjs` with this design's explicit new-object scope.

Playwright: existing real owner login and one-worker disposable fixtures; create Goal and attach
three existing one-offs; complete each using ordinary controls; verify counts, reload and EXP;
reopen 3/3 -> 2/3; verify order after detach/reattach; archive, change Quest elsewhere, restore; exclude
recurring candidates and verify server rejection through integration tests; lost committed
response and exact retry; non-owner/anonymous route/action denial. Mobile at 360/390/412 px:
no overflow, readable count and archived state, keyboard/focus and touch controls for attach/detach.
Retain the existing Quest/recurrence/Calendar suites as regressions, without Calendar feature edits.

Existing validation commands for that future work: `node --test tests/*.test.mjs`,
`node supabase/tests/private-owner-wire.mjs`, `node tests/auth-smoke.mjs`, `npm run test:e2e`,
`npm run lint`, `npx tsc --noEmit`, `npm run build`. No `npm test` or new tool/dependency assumed.

## 8. Migration and rollout plan

1. Architecture agreement is recorded in ADR-020 with the final product decisions. Await a
   separate implementation task; this finalization expressly prohibits implementation. Preserve
   the approved old-doc amendments and fixed event contracts.
2. In a later authorized task, create one timestamped additive migration after the current
   Calendar migration. Create role, three tables, checks/indexes/triggers, policies, helper grants
   and seven RPCs transactionally. Revoke defaults before exposing entry points; notify PostgREST
   to reload schema. No existing data backfill or Quest migration rewrite.
3. Keep legacy attribution unavailable. Preflight an authorized target for nonnull placeholder
   attribution and malformed one-off data; stop for explicit reconciliation, never rewrite
   completed snapshots or infer membership. This task performs no such database preflight.
4. Register new catalog/behavior tests at the new migration checkpoint in the existing disposable
   harness. That harness defers ADR-015 activation until fixture provisioning; new restrictive
   policies exist immediately, so pre-bootstrap tests must assert denial or install their own
   rollback-only synthetic owner fixture. After bootstrap, run new tests and final security matrix
   with activation present. Retain every historical suite at its original checkpoint.
5. Implement the application feature and Goal read refresh wiring only after backend contract
   validation. Keep old application versions compatible; no Goal route uses missing RPCs.
6. Review diff, security changes, tests and PR before merge. In a separately authorized rollout,
   apply backend before application exposure, verify existing app/database owner UUID agreement,
   run owner/non-owner smoke and verify unchanged Quest/EXP/Calendar behavior. No deployment or
   target connection is authorized by this plan.
7. Roll back feature exposure/application first if needed; retain tables, membership and receipts
   so retries/history survive. Do not drop Goal data or alter Quest ledger history as rollback.

## 9. Final decisions and limitations

All nine final product decisions are reconciled. No unresolved product/architecture decision
remains: empty=0%/false; current derived completion; archived edit protection and live progress;
one current Goal enforced structurally; independent importance/priority; unweighted progress;
server-enforced one-off eligibility; stable attach-order with retained position; retained
detached membership. Approval includes the explicit old-attribution amendment in ADR-020.
Manual reorder is deferred as the smallest V1 public contract; seven RPCs expose five mutations
and two reads. Implementation authorization remains outside this documentation-only task.

No deployed-data audit was performed. Existing reserved parent data, if any, requires a separately
authorized reconciliation decision. Goal ordering is within each Goal only; Goals themselves use
stable identity pagination. No permanent Goal accomplishment history, deletion, as-of report,
atomic move, cross-device instant push or new reward policy is included.

## 10. Design-task validation and handoff

Only this architecture, the finalized requirements and ADR-020 are changed. Tracked ADR diff and both
new documents were read separately; branch/status confirmed the requested branch and only these
three documentation files. Documentation checks cover local link targets/anchors, trailing
whitespace and git diff --check. Application, SQL, Node test suites and browser tests were not run
for this documentation-only task; section 7 is a future plan. Stop at the finalized report; no production
source, migration, database, dependency, commit, push or deployment work follows automatically.
