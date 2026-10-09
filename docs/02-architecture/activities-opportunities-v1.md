# SYSTEM V1 — Activities & Opportunities: Architecture Design

**Status:** APPROVED L0 ARCHITECTURE CONTRACT — PO approved AO-01–09, G-01–06 and the final L0 package; implementation not authorized.
**Date:** 2026-10-10 · **Repository location:** `docs/02-architecture/activities-opportunities-v1.md`.  
**Read-only review baseline:** `kdao265/System@main` `d380133804704552e2ed8969570210663c486dce` checked 2026-10-09. **MUST inspect newest `main` before implementation**; this is not a claim about working-tree state.  
Related: [Requirements](../01-requirements/activities-opportunities-v1.md), [Proposed ADR-024](decisions.md), [Task Contract](../04-development/activities-opportunities-v1.md).

## 1. Architecture invariants and ownership boundaries

1. Exactly two new independent roots, `Opportunity` and `Activity`. No automatic Opportunity↔Activity stage/status propagation.
2. `goal_quest_links` remains sole Goal membership and Goal Progress source; AO uses four **different** contextual link relations, no Quest/EXP writes.
3. Source provenance has Activity 0..1 current source / Opportunity 0..N derived Activities, auditable membership intervals independent from contextual links.
4. Archive-only on AO; no deletion grants/API. Quest Delete tombstones do not cascade to AO links and do not expose protected Quest text through AO.
5. Time precision is authoritative. Exact UTC instant is valid only with sufficient source timezone/offset and server validation. Never invent date/time.
6. All accepted mutations are atomic, owner-scoped, revision guarded, replayable through one immutable AO command namespace; history represents meaningful events, never guessed past events.
7. All AO mutations acquire `progression_internal.lock_owner(actor)` before row locks; cross-domain read/write privilege never expands the Quest/Goal/Calendar execution API.
8. All routes use existing Auth/Profile, Shell, dictionaries and disposable test harness; no local/prod database operations under this L0 task.

## 2. Logical → physical schema: **10 tables** (G-03 approved)

| # | Proposed table | Cardinality / authority |
| --- | --- | --- |
| 1 | `public.opportunities` | Opportunity root, current field state/revision/archive |
| 2 | `public.activities` | Activity root, current field state/revision/archive |
| 3 | `public.activity_source_links` | Activity→Opportunity provenance, ≤1 current source per Activity |
| 4 | `public.opportunity_goal_links` | N:N context, ≤1 current pair |
| 5 | `public.opportunity_quest_links` | N:N context, ≤1 current pair |
| 6 | `public.activity_goal_links` | N:N context, ≤1 current pair |
| 7 | `public.activity_quest_links` | N:N context, ≤1 current pair |
| 8 | `public.opportunity_history` | Immutable significant Opportunity events |
| 9 | `public.activity_history` | Immutable significant Activity events |
| 10 | `system_internal.ao_commands` | Immutable accepted request/receipt keyed `(user_id,command_id)` |

No separate Resource Link table (G-02), no duplicate authoritative `activities.source_opportunity_id`, no Quest/Goal membership migration, no event/EXP table. **Names are design-proposed and may require minor exact signature/constraint refinement at L1 review, without changing the approved ten-table model.**

### 2.1 Root columns and constraints

**Shared root columns:** `id uuid PRIMARY KEY` (caller-retained for create), `user_id uuid NOT NULL` (from verified owner identity), `revision bigint NOT NULL DEFAULT 1`, `archived_at timestamptz`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`. Composite unique `(id,user_id)` and FK owner→`auth.users(id) ON UPDATE/DELETE RESTRICT`; row-local `revision >= 1`. Creation starts at revision 1, no caller-controlled metadata/timestamps. No title uniqueness. Updates increment once only on effective changes; no-op preserving revision/updated_at, but record a no-op receipt. Archive/restore desired boolean, never toggle, preserve all fields and linked history.

**`opportunities`:**

| Type category | Fields | Structural/data invariants |
| --- | --- | --- |
| Text | `title`, `category`, `organization`, `description`, `eligibility_notes`, `benefits_notes`, `notes`, `priority` | Exact enums and code-point limits in Requirements §7 |
| Workflow | `tracking_stage`, `selection_outcome`, `entry_mode`, `selection_applicability` | Four stages, six outcomes, six entry modes, three applicability states; defaults saved/unknown/unknown/unknown |
| Close metadata | `closed_reason`, `closed_note` | Only stage closed; `other` requires note; seven-reason enum |
| Time | `application_deadline jsonb`, `deadline_at_utc timestamptz`, `program_start/end jsonb`, `applied_at jsonb`, `decision_at jsonb` | Strict partial/date/instant consistency; source time not converted without certainty |
| Resources | `resource_links jsonb` | Strict bounded array, default `[]`, max 30 |

**`activities`:**

| Type category | Fields | Structural/data invariants |
| --- | --- | --- |
| Text | `title`, `category`, `organization`, `role`, `description`, `contributions`, `outcomes`, `lessons`, `notes`, `confirmation_note` | Exact enums/Unicode limits in Requirements §7 |
| Participation | `status` | One of six statuses; transitions only in guarded command, not writable via metadata patch |
| Dates | `planned_start`, `planned_end`, `actual_start`, `actual_end` JSONB | Partial Date; pending/cancelled-before-start cannot have known actual dates; terminal/history semantics guarded |
| Confirmation | `participation_confirmed_at timestamptz` | Set by database when user confirms upcoming plan, not an invented real-world start date |
| Resources | `resource_links jsonb` | Identical strict G-02 array |
| Provenance | No root `source_opportunity_id` column | Derived in detail from current `activity_source_links` interval |

DB CHECK constraints defend stored end-state shape; transition permissions and temporal relations crossing fields must also be checked within command transaction on both before and after states. Date/URL validators must fail closed and avoid accidental SQL NULL = pass behavior (`COALESCE`/explicit boolean). All text is plain text, no HTML execution.

### 2.2 Link tables, indexes and immutable intervals

All five relationship tables have `id uuid PRIMARY KEY`, `user_id uuid NOT NULL`, typed `source_id`, typed `target_id`, `attached_at timestamptz NOT NULL`, nullable `detached_at timestamptz`, `CHECK(detached_at IS NULL OR detached_at >= attached_at)`. Use explicit typed column names shown below, with `(id,user_id)` composite FK to the appropriate root/Goal/Quest; `ON UPDATE RESTRICT ON DELETE RESTRICT`. Child owner is server-derived; all references must share the same owner.

| Table | Endpoints | Unique current predicate |
| --- | --- | --- |
| `activity_source_links` | `(activity_id,user_id) → activities`; `(opportunity_id,user_id) → opportunities` | UNIQUE `(activity_id)` where `detached_at IS NULL` |
| `opportunity_goal_links` | `(opportunity_id,user_id) → opportunities`; `(goal_id,user_id) → goals` | UNIQUE `(opportunity_id,goal_id)` where current |
| `opportunity_quest_links` | `(opportunity_id,user_id) → opportunities`; `(quest_id,user_id) → quests` | UNIQUE `(opportunity_id,quest_id)` where current |
| `activity_goal_links` | `(activity_id,user_id) → activities`; `(goal_id,user_id) → goals` | UNIQUE `(activity_id,goal_id)` where current |
| `activity_quest_links` | `(activity_id,user_id) → activities`; `(quest_id,user_id) → quests` | UNIQUE `(activity_id,quest_id)` where current |

For link view/history indexes include owner/source/attached_at/link_id; for target lookup include target/owner. Detached intervals are never reopened or deleted by ordinary commands; reattach gets new link ID. Detached current link command addresses **exact `link_id`**; no detach-by-target-ID that can accidentally close a newer attachment. Existing `goal_quest_links` is unchanged. On Quest Delete, `quests.deleted_at` tombstone preserves FK; Quest Engine's existing condition about current Goal membership still applies, **no AO context prerequisite**.

### 2.3 History tables

`opportunity_history`: `id`, `user_id`, `opportunity_id`, `command_id`, `event_type`, `before_value jsonb`, `after_value jsonb`, optional `reason`, `recorded_at`, `event_seq` (or equivalent within-command uniqueness). `activity_history` substitutes `activity_id`. `(subject_id,user_id)` references corresponding root, and `(user_id,command_id)` references AO accepted-command ledger if writing order/deferred FK supports atomic insertion. Multi-event command allowed, each `(user_id,command_id,event_seq)` unique; no direct UPDATE/DELETE. Significant events include `stage_changed`, `stage_corrected`, `outcome_recorded`, `outcome_corrected`, `deadline_changed`, `dates_corrected`, `activity_transition`, `status_corrected`, `source_changed`, `context_attached/detached`, `resource_links_changed`, `archived/restored` when effective. Do not fabricate events during historical imports; initial state is creation. Plain metadata updates need not make an excessive full-row audit log, but accepted command payload/receipt is still immutable.

**Privacy:** history may contain AO-owned before/after field values; never copy Quest title/description/reward/status or secret deleted Quest data into link/history/receipt snapshots. Goal/Quest references use only allowlisted IDs and link identities. All history reads owner-guarded, paginated and date/id ordered.

### 2.4 Accepted command ledger

`system_internal.ao_commands`: `user_id`, `command_id` PK pair, exact `command_type`, `subject_kind`, `opportunity_id uuid NULL`, `activity_id uuid NULL`, `canonical_request jsonb`, `result jsonb`, `recorded_at`. **Exactly one** subject FK must be populated and match `subject_kind`; composite owner FKs to root. Accepted no-ops also retained; failed/rolled-back commands leave no success record. No UPDATE/DELETE and no direct client read; one AO command ID cannot mean two different AO requests. Result is immutable; `replay` is response metadata added on exact lookup, not a persisted modification. Need design safe FK transaction ordering for **Create** (root and receipt inserted atomically within same transaction) and history→receipt insertion, potentially using deferred FK or deliberate write ordering; no visible partial commits.

## 3. Strict JSONB contracts: G-01 and G-02

### 3.1 PartialDate

Canonical tagged variants (illustrations, not executable source):

```json
{"precision":"unknown"}
{"precision":"year","year":2025}
{"precision":"month","year":2025,"month":9}
{"precision":"day","year":2025,"month":9,"day":15}
```

**Exact keys** per variant, numeric integral Gregorian calendar year/month/day with explicit supported year bounds to be documented in SQL/TS parity suite; reject extra keys, `null` in required properties, invalid leap days, impossible months, and inappropriate timezone/clock values. Unknown is not today or null timestamp; empty optional input normalized to canonical Unknown. In PATCH, omitted key means preserve, explicit Unknown clears. Partial-date comparison uses possible civil-day intervals; reject if earliest possible start > latest possible end, allow uncertainty-overlap and equal-day. If actual known dates contradict lifecycle, reject; no actual date derived from `created_at` or `status_changed_at`.

### 3.2 DeadlineSpec

Conceptual JSON shapes:

```json
{"precision":"day","year":2026,"month":11,"day":15,"source_time":"23:59","source_time_state":"unresolved"}
{"precision":"instant","source_date":"2026-11-15","source_time":"23:59","source_zone":"America/New_York","source_offset_minutes":-300}
```

Variant 1 means a known civil deadline day with a published clock time **whose timezone has not been resolved**; `deadline_at_utc` MUST be null. Month/year/unknown similarly have no UTC instant. Variant 2 must resolve exactly one UTC instant; `deadline_at_utc` stores server-verified timestamp corresponding to local date/time/zone/offset. Day-only with no clock remains date-only even if a source timezone is noted. The serializer must not classify a clock+unknown timezone as an exact instant.

Exact offset with no IANA zone is permissible as sufficiently precise. For IANA zone, server verifies validity, offset agreement and local-time roundtrip. At DST gap reject; at fold require offset/sufficient disambiguation; never silently pick an occurrence. Reject impossible timezone, offset ranges or zone/offset contradiction. Store source wall time, original zone if given and resolved offset to preserve provenance; Profile timezone later changes *display conversion only*. UTC column consistency validated by database-side function/command in the same transaction, not trusted from client-provided `deadline_at_utc`. Avoid using recurring Quest ADR-022 internal resolver as an implicit public dependency; choose and freeze independently testable AO source of zone rules before L1 SQL.

`application_deadline` may change without changing stage/outcome. Date-only past label must not assert organizer portal closed where zone is unknown; month/year no exact countdown. Time edits have before/after temporal history, including source time/zone/offset/UTC. Never mutate existing deadline UTC because the runtime timezone database version or Profile timezone later changes. A deliberate edit creates a new version.

### 3.3 Resource Links

```json
[
  {"id":"550e8400-e29b-41d4-a716-446655440001","label":"Website chương trình","url":"https://example.org/program"},
  {"id":"550e8400-e29b-41d4-a716-446655440002","label":"Hướng dẫn","url":"https://example.org/guide"}
]
```

Require `jsonb_typeof='array'`, 0..30 entries; exactly id/label/url per item, ID UUID canonical/unique in array, nonblank label ≤120, URL ≤2048 Unicode code points; HTTPS absolute, no credentials/userinfo/control chars/unsafe host/schemes. Use consistent allowlist with Library's established manual cover URL semantics but do not equate URL with image. No DNS, HTTP, metadata fetch, external HTML rendering or automatic rewrite. Duplicate URL allowed; distinct IDs preserve user intent. Array order authoritative for display. Entire collection updated under root revision and AO command receipt. Failed link validation rolls back all edits.

### 3.4 Unicode consistency

TypeScript/PgSQL must agree on trimming boundary Unicode whitespace, CRLF/CR normalization for multiline fields, code-point counts (PostgreSQL `char_length`, JS `Array.from` or iterator), no silent Unicode normalization/composition or truncation. Reject embedded NUL/invalid lone surrogate. SQL functions value-only and scope-locked; all root constraints server-side even when action validation exists. Conformance corpus includes Vietnamese, emoji, NBSP, nonstandard Unicode whitespace and URL escapes.

## 4. Command and read RPC surfaces (G-03)

**Typed, narrowly scoped public RPC names approved as architecture direction; actual PostgreSQL argument names/defaults/return schema require last-line implementation review.** No generic open-ended `execute_command` endpoint, no user_id or caller timestamps accepted.

### 4.1 Opportunity mutation RPC

| Entry | Logical args | Behavior |
| --- | --- | --- |
| `create_opportunity_v1` | `command_id, opportunity_id, fields` | Required title, defaults or explicit historical stage/outcome, known typed fields; revision 1; receipt |
| `update_opportunity_v1` | `command_id, opportunity_id, expected_revision, changes` | Allowlisted metadata, `entry_mode`, resource links, planned/program dates, deadline; **not** stage/outcome/applicability correction through generic update |
| `set_opportunity_stage_v1` | `command_id, opportunity_id, expected_revision, stage, details` | Stage actions, Close reason/note, explicit Reopen target, correction vs new stage; immutable events |
| `record_opportunity_outcome_v1` | `command_id, opportunity_id, expected_revision, outcome, details` | Outcome + applicability changes atomically when needed, decision date, new_decision vs correction flag |
| `set_opportunity_archived_v1` | `command_id, opportunity_id, expected_revision, archived` | Desired-state Archive/Restore |

### 4.2 Activity mutation RPC

| Entry | Logical args | Behavior |
| --- | --- | --- |
| `create_activity_v1` | `command_id, activity_id, fields` | Title + explicit confirmed participation intent or historical import; no invented transition |
| `update_activity_v1` | `command_id, activity_id, expected_revision, changes` | Allowlisted metadata, dates, contributions, links values; not lifecycle status |
| `transition_activity_v1` | `command_id, activity_id, expected_revision, action, details` | Start/Pause/Resume/Complete/EndEarly/CancelBeforeStart with state guards |
| `correct_activity_status_v1` | `command_id, activity_id, expected_revision, target_status, correction` | Explicit correction, associated actual dates updated atomically; audit |
| `set_activity_archived_v1` | `command_id, activity_id, expected_revision, archived` | Desired-state Archive/Restore |

### 4.3 Relationship mutations

| Entry | Logical args | Behavior |
| --- | --- | --- |
| `set_activity_source_v1` | `command_id, activity_id, expected_revision, expected_source_link_id, desired_opportunity_id, note` | Attach/unset/replace provenance atomically; null expected link means expected none; null target means detach |
| `attach_ao_context_v1` | `command_id, source_kind, source_id, expected_revision, target_kind, target_id` | Exactly four allowlisted source-target combinations; validate same owner/one-off/unarchived, no side effects |
| `detach_ao_context_v1` | `command_id, source_kind, source_id, expected_revision, target_kind, link_id` | Close one exact current or already-detached membership interval; no target-ID-based destructive detach |

No caller-selected arbitrary table or dynamic SQL identifiers. Source root revision guards link edits. Duplicate current attach can be a recorded no-op with current revision; a stale unrecorded request still rejects. Source replacement from A→B closes A and inserts B with one revision advance/one transaction. Detach link ID already detached can be no-op if current revision and subject authorized; never detach L2 after L1.

### 4.4 Reads

| Entry | Contract |
| --- | --- |
| `get_opportunity_v1(opportunity_id)` | Owned detail + derived Activities/source/context projections; immutable current values and revision |
| `list_opportunities_v1(scope,filters,cursor,limit)` | Bounded metadata (no long notes), deterministic sort |
| `get_activity_v1(activity_id)` | Owned detail + current source/context references, deleted Quest sanitized |
| `list_activities_v1(scope,filters,cursor,limit)` | Bounded metadata, deterministic sort |
| `list_ao_history_v1(subject_kind,subject_id,cursor,limit)` | Owner-checked immutable significant event page |
| `search_ao_link_candidates_v1(source_kind,source_id,target_kind,query,cursor,limit)` | Owner-checked eligible Goal/one-off Quest; no deleted/archived candidates, server rechecks attach |
| `resolve_ao_command_v1(command_id)` | Read-only receipt lookup after verifying owner/subject visibility; if no receipt, outcome remains uncertain while original request may be running |

Reads are side-effect-free (no Quest materialization). Default list page 50/max 100; stable `(created_at DESC,id DESC)` for root lists; history `(recorded_at DESC,id DESC)`; cursor must be validated/allowlisted and query lengths bounded at L1. Filter title/organization text, category, stage/outcome/status, active/archived, known/unknown deadline. List DTO must exclude long notes/resource URLs unless there is a specifically validated preview field. Correctly handle current Quest status only when permitted; never expose deleted content even as stale snapshot.

## 5. Command execution, receipts and concurrency

### 5.1 Exact accepted replay

`system_internal.ao_commands` has primary key `(user_id,command_id)`. Canonical normalized request includes subject kind/identity, operation, expected revision when relevant and exact command-specific field values; command ID stored separately. Steps for **every mutation**, in one transaction:

1. `system_private.require_owner()` at RPC entry, resolve verified actor; reject malformed IDs/operation before leaking any rows.
2. Normalize/validate command keys and input; acquire `progression_internal.lock_owner(actor)` **before any row lock**.
3. Locate accepted receipt for `(actor,command_id)` and compare canonical request, subject, command type. Identical ⇒ return immutable historical result plus response `replay:true`; mismatch ⇒ command identity collision (e.g. `23505`). Replay does not recheck stale revision/archived/target deleted and performs **no write**.
4. Fresh command: lock AO source/root `FOR UPDATE` (for create, use retained UUID identity and insert/create collision handling). Check expected positive revision **before** no-op; assert source editable unless archive/restore. For link attach read Goal/Quest/Opportunity target eligibility under already-held shared owner lock. Avoid target row `FOR UPDATE` requiring broader privilege.
5. Check final state/data constraints and allowlisted action; no cross-domain mutation. Execute root and link edits, update root revision once if effective, set database operation time after lock, append significant history events.
6. Store immutable accepted receipt (including valid no-op). The FK/history insert sequence must ensure entire operation either commits or rolls back; source/link/history/receipt cannot partially commit.
7. Return versioned typed receipt with subject, `revision_before/after` decimal strings, `changed`, command/event/link identity as needed, `replay:false`. Client checks exact envelope and binding, not SQL message content.

For separate simultaneous requests against the same owner, advisory lock serializes the commands. A stale unrecorded action rejects even if values now match. Every repeated command ID is scoped to AO only; no collision with separate Quest/Goal command namespaces. Revision overflow rejects atomically. Recorded no-ops do **not** advance root revision or create fake domain transition event.

### 5.2 Retry and old-link examples

C1 attach Quest X to Activity (creates link L1), C2 detach L1, C3 reattach Quest X (creates L2). Late retry C2 returns original receipt, cannot detach L2. A **new** detach C2′ using L1 + stale expected revision is rejected; even with current revision, it is a no-op on L1 and cannot target L2. Link unique partial index ensures at most one active same-pair membership. Identical retry of a Create after subsequent updates returns historical create receipt, **not** current field state; UI performs a fresh read for current truth.

### 5.3 Browser/request outcome tri-state

`confirmed`: receipt/ack binds to attempted command. `rejected`: explicit validated server refusal. `unknown`: transport/parsing/uncertain response, no claim of rollback. Keep mounted draft and original command/payload/expected revision; prefer read-only resolve, then exact retry **only while original payload is still available and authenticated account still matches**. No silent rebasing to current revision.

`sessionStorage` per-AO namespace stores **only** version + verified owner ID + command ID + subject kind/ID + minimal operation identity, no form fields/URLs/notes/canonical payload. After reload: query receipt read-only; if absent, show unresolved and require deliberate user action to reconstruct a **new** intent; do **not** replay unknown original command without exact payload. Missing receipt at one observation doesn't prove rollback; an original in-flight request could still commit. Strict metadata validation, namespace isolation from Quest/Library, blocked handling for storage corruption/unavailability and account changes. Confirmed commit followed by cache invalidation failure is **saved / refresh needed**, not unsaved.

### 5.4 Error responses

Application layer uses localized typed envelopes: `success`, `validation_error(field,code)`, `conflict(stale_revision|archived|identity_reused|eligibility_changed|review_required)`, `not_found`, `unauthorized`, `onboarding_required`, `infrastructure_failure`, `unknown`. Error mapping may use SQLSTATE but never expose raw foreign subject contents, SQL traceback, internal schema or protected deleted Quest values. Read errors are not mistaken for absent receipts or confirmed mutation failures.

## 6. Cross-domain locking, RLS and tombstone-safe reads (G-04)

### 6.1 Owner lock and target races

All AO mutations use existing `progression_internal.lock_owner(actor)` (a transaction-scoped advisory lock) before any row lock, matching current Quest and Goal commands. New AO command executor receives EXECUTE on **that lock helper alone**, not recognition/EXP helpers. Sequence across compliant writers: owner lock → AO root row FOR UPDATE (when exists) → target eligibility SELECT → link/history/receipt changes. Never acquire AO row lock and then owner lock. Because existing Quest/Goal commands use owner lock first, an AO Attach vs Quest Delete/Goal Archive race has only valid orders:

- AO Attach wins owner lock: validates active target and inserts link; subsequent Quest Delete may tombstone, retaining link with safe placeholder, if Quest's *own* Delete guards pass.
- Quest Delete wins: target `deleted_at` present, fresh attach rejects.
- Goal Archive wins: fresh attach rejects; attach wins first: link stays when Goal later archives.
- Source Opportunity Archive wins: fresh new source attach rejects; source wins first: current link retained when source later archives.

Owner lock is only a guarantee for compliant existing/future writers; direct unauthorized table writes remain denied. Testing must use **actual concurrent PostgreSQL sessions**, not serial fake calls. This owner-wide serialization is accepted for private V1; revisit only under new ADR if throughput needs demand it.

### 6.2 Privileges and RLS

Create dedicated `ao_command_owner`: `NOLOGIN`, `NOBYPASSRLS`, no inherited broad privileges, no persistent role borrowing. AO root and link/history/receipt tables have RLS, permissive same-owner policies plus **restrictive configured single-owner** policies applying to authenticated and executor roles as needed. RPC entry guards use `system_private.require_owner()` and `system_internal.request_user_id()`. Runtime user cannot set `user_id`, role/privilege, created_at or revision; direct root/link DML to authenticated denied. Command executor writes AO only, can read eligible Goal/Quest metadata with column-level minimum grants and role-specific policies, cannot UPDATE/DELETE or invoke Quest/Goal/EXP/Calendar commands.

Existing restrictive SELECT policy `quests_hide_deleted_from_browser` applies to **authenticated** role and does not automatically apply to AO executor. Implement specific `ao_command_owner` policies (including restrictive single-owner) with minimal column grants; privileged read may observe `deleted_at` only to derive placeholder/attach rejection, not export title/description of Deleted. For current nondeleted Quest title, only allowlisted projection fields may be supplied. RLS doesn't make `SECURITY DEFINER` output safe by itself; deliberately sanitize every return path, history, receipts, errors and list candidates. No `SELECT *`/`to_jsonb(q)` of a deleted row in output. Do not snapshot mutable Quest names into AO history/link events.

Historical private-owner activation migration enumerated then-existing roles; add a **new additive migration** with new role-specific access rules, not rewrite old activation SQL. Enforce credential/configured-owner at browser action and SQL boundaries independently. Anonymous and non-owner should be unable to invoke reads or mutation; inaccessible UUIDs produce uniform not-found where appropriate.

### 6.3 Deletion/archival matrix

| Target state | Existing context link | Fresh attach | Display |
| --- | --- | --- | --- |
| Goal active | Keep | Allow same-owner | Normal Goal label |
| Goal archived | Keep | Reject | Archived label if owner-readable |
| One-off Quest active | Keep | Allow if fully eligible | Normal Quest label/status per owner read |
| One-off Quest archived | Keep | Reject | Archived label if owner-readable |
| One-off Quest deleted | Keep | Reject | Neutral `Quest đã xóa` placeholder only; no restore/navigation into protected data |
| Recurring/stopped recurrence Quest | No new V1 link | Reject | Not a picker option |
| Source Opportunity archived | Keep old source interval | Reject newly set/replaced source | Source detail remains available if owner-readable |
| AO root archived | Keep all links/source/history | Reject fresh edits/link changes until Restore | Read-only root |

Quest Delete remains governed by its existing one-off/recurring guards and active `goal_quest_links` constraint; **no AO context check** is added. Deletion tombstone maintains FK RESTRICT viability. Archive is not delete. Existing Quest RLS remains authoritative for normal authenticated reads; privileged AO projections must be no more informative for deleted items.

## 7. UI, routes and localization (G-06)

Six Next App Router routes: `/opportunities`, `/opportunities/new`, `/opportunities/[id]`, `/activities`, `/activities/new`, `/activities/[id]`, plus route-level error/loading components or equivalent safe states. No `/growth` page V1. Extend existing `SystemShell` current discriminant and `AppHeader` navigation to group Activities/Opportunities under Growth, preserve selected nested destination, no second shell. Extend typed EN/VI dictionaries, `LocaleProvider`, localized errors/status/date labels. Reuse `Panel`, `SectionHeader`, `Notice`, `Button`, field styles/tokens, reduced-motion and semantic affordances; avoid broad redesign of Dashboard/Quest/Calendar/Library.

- **Opportunity list:** active/archived; title/organization search, category, stage/outcome, deadline known/unknown; bounded cursors. Detail: Overview, Application/Selection, Deadline/Program Dates, Resources, Related Goals/Quests, resulting Activities, History.
- **Activity list:** active/archived; title/organization, category, six status filters; bounded cursors. Detail: Overview, Participation Lifecycle, Planned/Actual Dates, Contributions/Outcomes/Lessons, Source Opportunity, Related Goals/Quests, History.
- **Create Opportunity:** title only required; defaults, progressively disclose details. **Create Activity:** title and explicit upcoming-confirmed / ongoing-confirmed / historical terminal intent; do not auto choose upcoming.
- **Source creation:** Creating Activity from Opportunity may prefill name/organization for review only, not ongoing synchronization. No source status gate that requires Accepted; direct access can create Upcoming after confirmation.
- **Deadline UX:** precision selector, only known components enabled; unresolved clock clearly labeled, no exact countdown; when instant known distinguish source/local zone.
- **History/links:** own paginated timeline; limited candidate picker, server eligibility recheck; archived root readonly; deleted Quest placeholder. Status-correction and Close/Reopen confirmations separate from normal edits.
- **Accessibility:** keyboard focus, explicit labels, error alerts and status messages, minimum 44px targets, reduced motion, mobile 360/390/412, tablet 820, desktop 1024/1280; no horizontal scrolling from long URLs or titles.
- **Privacy/cache:** protected Server Components/actions with Auth/Profile; private `Cache-Control: no-store`; service worker stays on static-only allowlist and never caches HTML/Server Actions/RPC. No external HTTP calls from backend for user-supplied URLs.

## 8. Migration sequence and rollback posture (no execution authorized)

1. **Preflight on fresh main (future):** `git status`, inspect `origin/main`, migration list, privilege/RLS catalog, typed Action conventions, existing test checkpoint order. Don't edit historical migrations or freeze old hashes silently.
2. **Additive L1 migration proposal:** 10 AO tables, FK/index/constraints, strict validation functions, role + grants/RLS, typed RPC, immutable trigger/receipt protection, minimal read projections. No destructive migration/backfill of old domain data.
3. **Database guard/cross-boundary tests:** apply only in disposable environment, test migration from empty baseline and after historical checkpoints, verify old RPC identity/signatures/grants unchanged. New AO checkpoint installed **after Library V1** in normal and private-owner harness paths, preserving historical ADR-015 assertions before newer roles are added.
4. **L2 UI/application:** scoped AO routes, model/adapters and UI. Extend shell/dictionaries/styles only as needed, never alter Quest completion or EXP logic.
5. **L3 relationships UX:** provenance + typed context candidate/attach/detach, deleted Quest safe projection and loss/recovery UX; L4 full regression and review.
6. **Rollback planning:** additive tables/roles mean release can be feature-flagged or withheld before exposing UI; do not propose destructive rollback of accepted historical AO rows/receipts. If migration fails in disposable tests, repair future migration draft, not production history. Any real deployment/rollback requires separate explicit authorization and verified backup/preview strategy.

## 9. Acceptance, traceability and test matrices

| Group | Required evidence | Requirements/Decisions |
| --- | --- | --- |
| Schema/catalog | 10 tables, exact FKs, active uniqueness, role ACLs, restrictive owner policies, no direct DELETE, immutable histories/receipts | AO-FR-13–17,21–23; G-03/04 |
| Opportunity model | Four stages/six outcomes, six entry modes/three applicability values, hard rejection only for invariants, seven close reasons, reopen/correction/history | AO-AC-01–06; G-05 |
| Activity model | Six statuses, legal transitions/corrections, historical import without synthetic events, no automatic date/status behavior | AO-AC-07–10 |
| Temporal | Strict unknown/year/month/day, date range validation, source wall + UTC instant, DST gap/fold/offset, no guessed timezone | AO-AC-11–13; G-01 |
| Resource/text | ≤30 links, ≤120 label/≤2048 HTTPS URL, Unicode ≤field limits, invalid array rollback, no fetch | AO-AC-19–20; G-02 |
| Relationships | Source 0..1, four N:N, same-owner FK, detached intervals, archived target/source guards, exact link replay | AO-AC-14–17; G-03/04 |
| Security | Anonymous/non-owner, direct authenticated DML, definer ACL, deleted Quest forbidden title/status/reward through all DTOs/history/errors, no broad executor privileges | AO-AC-16,23; G-04 |
| Concurrency | Two-session attach/delete, attach/archive, source/archive, same-pair race, stale revisions, late detach after reattach, no-op/collision replay | AO-AC-21–22; G-03/04 |
| Recovery | Lost response after committed command, same ID replay, refresh-failure success, read-only resolution after reload, storage/account-change blocked, draft retention | AO-AC-21–22; G-06 |
| UI | Six routes, Growth navigation, EN/VI, semantic keyboard access, responsive 360/390/412/820/1024/1280, no horizontal overflow | AO-AC-23; G-06 |
| Regression | Before/after snapshots of Quest/EXP/Goal Membership/Calendar/Library and auth behavior, existing tests unchanged | AO-AC-24 |

**Planned commands only, NOT run here:** `npm run lint`, `npx tsc --noEmit`, `npm run build`, `node --test tests/*.test.mjs`, `node supabase/tests/private-owner-wire.mjs`, `node tests/auth-smoke.mjs`, `npm run test:e2e`. Target only disposable Auth/PostgREST/tmpfs PostgreSQL harness; never existing Local/Cloud datasets. Record actual results/skips; do not claim success before execution.

## 10. SQL/API precision checks remaining for L1 preflight (not unapproved new product scope)

The **directions G-01–G-06 are PO-approved**; the items below are mechanical details to prove before migration, not permission for agents to invent new business meaning:

- Verify SQL function signatures, parameter defaults, exact serialized DTOs, safe enum constraints and `jsonb` function failure behavior against fresh main; preserve approved names/semantics or request change approval.
- Resolve exact Gregorian year range and timezone rule provenance/runtime versions with SQL+TypeScript fixtures. If deterministic timezone resolution can't be proven, **stop and escalate** rather than silently assume Profile timezone or reuse ADR-022 resolver.
- Specify event-type enum names/sequence/FK insertion ordering such that accepted command, history and root changes are one transaction; ensure read DTOs never leak protected Quest snapshots.
- Decide exact conflict/not-found SQLSTATE-to-typed-error mapping and canonical request comparison; never infer accepted command from current-state coincidence.
- Verify indexes/query plans under realistic, disposable fixture distributions; honor max 100 pagination and avoid raw SQL query injection.
- Validate AO link guards against every current Quest Archive/Delete path (one-off and recurring), not only a happy path. Test executable owner lock order and role-specific SELECT policies.
- Validate account-change/sessionStorage error states and PWA no-cache behavior in actual browser tests; preserve existing Quest/Library recovery namespaces.

Any discovery requiring **new domain scope**, additional table beyond approved 10, cross-domain write privileges, data retention exception, or behavior conflicting with Requirements must return to PO for an amended architecture decision. Current authorization is one docs-only commit; no code, migration, database operation, PR, merge or deployment.