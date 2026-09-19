# Level + real-life rewards — proposed physical design

Status: Approved design, documentation only; no SQL or migrations. Sources: [requirements](../01-requirements/level-rewards.md), [domain model](level-reward-domain-model.md), [Player/EXP schema](player-exp-database-schema.md) and [Auth/Profile](auth-profile-database-schema.md). Proposed names describe future storage, not existing tables.

## 1. Storage choice

Seven small relations separate global configuration, owner policy history, milestones, editable plans and immutable evidence. No players table or current EXP/Level cache is proposed. Redemption reuses reward events rather than adding a separate redemption relation. Policy assignment history avoids silently overwriting the policy that explained a recognition.

UUID identifies entities and Auth owners. Times are server-generated timezone-aware timestamps. Levels are nonnegative integers; the approved initial policy starts at Level 1. Revisions/sequences are positive big integers. Thresholds and historical evaluated EXP use exact finite nonnegative integral numeric values, compatible with the ledger's exact aggregate rather than a JavaScript float or a sum constrained to one ledger-entry integer's range. Cost is finite nonnegative decimal numeric, without an invented currency precision rule.

## 2. Proposed relations

| Relation | Fields and keys |
| --- | --- |
| `level_policies` | UUID `id` PK; unique stable text `policy_key`; unique positive integer `version`; `name`; draft/published `status`; `created_at`, nullable `published_at` |
| `level_thresholds` | Composite PK (`policy_id`, `level`); `required_exp`; policy FK; unique (`policy_id`, `required_exp`) |
| `progression_policy_assignments` | UUID `id` PK; `user_id`; `policy_id`; owner `assignment_sequence`; `command_id`; historical `evaluated_exp`; trusted administrative actor reference and verified origin; `recorded_at`; unique (`user_id`, `assignment_sequence`) and (`user_id`, `command_id`) |
| `level_milestones` | UUID `id` PK; `user_id`, `level`, `policy_assignment_id`, `policy_id`; historical `evaluated_exp`; `cause_kind` (`exp_credit` or `policy_assignment`); nullable `cause_ledger_entry_id`; authenticated actor and verified origin; `reached_at`; unique (`user_id`, `level`) |
| `level_reward_definitions` | UUID `id` PK; `user_id`, `required_level`, `title`, nullable `description`, `category`; nullable `estimated_cost`/`currency_label`; `revision`; nullable `archived_at`; `created_at`, `updated_at` |
| `level_reward_unlocks` | UUID `id` PK; `user_id`, `reward_id`, `milestone_id`, `definition_event_id`; snapshotted `required_level`, `definition_revision`, `title`, `description`, `category`, `estimated_cost`, `currency_label`; `unlocked_at`; unique `reward_id` |
| `level_reward_events` | UUID `id` PK; `user_id`, `command_id`, `event_type` (configured/updated/archived/redeemed), `reward_id`; nullable `unlock_id`; configuration `definition_revision` where applicable; versioned canonical `request`; configuration `before`/`after` snapshots where applicable; authenticated `actor_user_id`, verified `origin`; `recorded_at`; unique (`user_id`, `command_id`) |

Canonical requests and before/after snapshots use validated, versioned JSON objects with closed event-specific shapes, not arbitrary audit blobs. Redemption has an unlock reference and request but no configuration before/after snapshot or configuration revision. Configured events have no before snapshot; updated/archive events have both. This narrowly scoped history supports intent comparison, attribution and reconstruction of configuration without a generic audit platform.

Policy assignment requires a verified request actor with active `level_policy_assign` in private `system_internal.operator_grants`, as frozen in the [operator authorization contract](operator-authorization-v1.md). The actor need not equal the recipient owner. Identity comes from `system_internal.request_user_id()`; it alone confers no capability. User reward events require actor=owner in V1. Milestone attribution comes from the validated enclosing EXP or assignment command, not user-submitted provenance. Future delegated actors require reviewed authorization changes, not merely an additional channel label.

The initial policy record uses immutable `policy_key = level_policy_v1` and `version = 1`; its UUID remains the relational identity for assignments and threshold foreign keys. The approved initial policy is `level_policy_v1` (version 1). Level 1 starts at 0 cumulative EXP; for integer Level L >= 1, `100 * (L - 1)^2` defines its initial cumulative threshold. Persist explicit thresholds for every Level in the published range. Runtime derives current Level from the assigned policy's persisted thresholds; it must not hard-code this formula, invert it or extrapolate missing rows. Future balancing introduces a new policy version with explicit threshold data. Representative cumulative thresholds are Level 1 = 0, Level 2 = 100, Level 5 = 1600, Level 10 = 8100 and Level 50 = 240100; see the [requirements examples](../01-requirements/level-rewards.md#4-level-policy). `level_policy_v1` publishes explicit thresholds for Levels 1 through 100 inclusive. Level 100 requires 980100 cumulative EXP and is the highest published Level in V1, not a permanent SYSTEM cap. Future progression may extend the published range through a successor policy version, preserving published-version immutability. Existing top-configured-Level behavior remains unchanged; excess EXP is retained without runtime extrapolation.

The formula specifies preparation of initial data, not a generated-column rule or universal constraint on future versions. Highest Level remains derived from immutable milestone history and is never recalculated downward after an EXP reversal.

## 3. References and invariants

All owner IDs reference `auth.users`. Historical owner/source references restrict deletion; do not cascade-delete milestones, definitions, unlocks, events, assignments or published policies. UUID ownership is enforced by composite keys/FKs and command checks, never ID unpredictability.

- Add unique identity keys needed for composite references: (`id`, `user_id`) on owner relations; (`id`, `user_id`, `policy_id`) on assignments; (`id`, `user_id`, `level`) on milestones; (`id`, `user_id`, `reward_id`) on unlocks and reward events.
- Milestone (`policy_assignment_id`, `user_id`, `policy_id`) references its assignment; (`policy_id`, `level`) references its threshold. An EXP-caused milestone references the same-owner ledger entry; an assignment-caused milestone has no ledger reference. Guards verify the cause, accepted policy, aggregate and threshold. Assignment/ledger references remain after reversal.
- Unlock references a same-owner definition, a same-owner milestone at exactly its required Level, and a configuration event for that same definition. Guards verify the configuration revision and complete snapshot against the accepted definition/event. Redemption's composite unlock reference verifies owner and reward together.
- A partial unique constraint on redeemed events' `unlock_id` enforces one claim per unlock. Only redeemed events have an unlock target. Configured/updated/archived events reference the definition and its resulting revision; enforce one configuration event per definition/revision.
- Definitions/events/unlocks retain restrictive references. Creation order is definition, configured event, then optional unlock; redemption occurs later. No definition pointer to its unlock is needed, avoiding a creation dependency cycle.
- Category is one of `treat`, `purchase`, `experience`, `custom`. Title is nonblank; optional blank description normalizes to null. Cost and nonblank currency/unit label are present together or both absent; cost must be finite and nonnegative. Apply the same validation to snapshots.
- Definitions are checked against the assigned policy's Level range at create/edit, not a mutable global Level list. Successor policies retain those Levels. Locked content updates require expected revision; all updates increment revision. Archive is permanent; after unlock only archival is allowed. No hard delete is exposed.

Policy publication validates contiguous numbering, strict threshold ordering, zero baseline, completeness and compatibility with earlier published numbering/ranges. Row checks alone cannot prove these cross-row properties. Serialize draft edits/publication on the policy row; the trusted publication operation and guards enforce them. Published policy/threshold updates and deletes reject. Assignment accepts only a published policy; latest owner sequence is authoritative. Same assignment command ID/policy returns the original assignment; changed policy with the same command ID conflicts.

Runtime inserts are guarded against arbitrary milestones, snapshots and invalid redemptions. Immutable tables reject UPDATE/DELETE/TRUNCATE through both privileges and applicable guards, following the existing EXP pattern. Definitions permit only validated transitions. Publication and assignment are separate administrative operations, not arbitrary owner table writes.

## 4. Transaction serialization

Use a transaction-scoped PostgreSQL advisory lock with a stable, namespaced owner-UUID mapping shared by every participating command. Lock collisions may serialize different owners but never authorize cross-owner access; all queries still filter/validate the full UUID. The lock is taken before existing Quest definition then occurrence locks, and before reward definition locks. Never acquire it only inside a late recognition helper after taking Quest locks. No transaction may invert this order.

Use READ COMMITTED and perform authoritative reads in subsequent statements after acquiring the lock, so a waiter sees preceding committed owner changes as well as its own inserts. Do not combine lock waiting and aggregate evaluation into one statement with a pre-wait snapshot. The implementation must verify the command/helper execution preserves this statement-snapshot behavior. See PostgreSQL's [transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html) and [advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS) documentation.

Compute assignment sequence and recognize milestones under this lock. Policy publication uses only its configuration lock and never waits for owner locks; assignment reads an already-immutable published version. Owner reads need no write lock but obtain EXP, current policy and milestone maximum in one consistent snapshot.

The enclosing Quest transaction inserts event/credit, recognizes missing milestones and unlocks, and finishes the completed projection before commit. A failure anywhere rolls back all effects. Reopen/reversal uses the same owner lock and existing exact compensation. Reward create/edit/event/immediate unlock, archive/event, and redemption/event each commit atomically. Uniqueness remains mandatory even with serialization; locks alone are not durable idempotency keys.

## 5. Ownership and privilege intent

Enable RLS on every relation. Anonymous roles get no access. Authenticated users may read published policies/thresholds and their own assignments, milestones, definitions, unlocks and events. Draft policy access is administrative. Normal users have no direct INSERT/UPDATE/DELETE/TRUNCATE grants, only narrowly exposed command execution.

Propose a non-login, non-table-owner, non-superuser, NOBYPASSRLS `progression_command_owner` for future controlled reward commands and private recognition. Give only required owner-scoped SELECT, INSERT on evidence/definitions and validated UPDATE on definitions; no history mutation/deletion. It needs an explicitly reviewed owner-scoped SELECT grant/RLS policy on the EXP ledger, never ledger INSERT/UPDATE. Existing `quest_command_owner` retains its EXP authority unchanged and receives only execution of the private recognition helper. That helper validates same-owner accepted source evidence and derives the aggregate; it does not accept an arbitrary EXP amount or Level.

Security-definer commands must use a fixed safe search path, qualified objects, verified authentication and restrictive execution grants; private helpers are not callable by browser/AI roles. Policy assignment uses the contract's restricted `level_policy_assignment_owner` executor and private capability check, with role-specific RLS for its required target reads and assignment/milestone/unlock inserts. It does not broaden ordinary owner policies or grant grant-management, EXP-write or redemption authority. Bootstrap starts with zero grants and requires an explicit database-administrator data operation; no automatic enrollment occurs. `level_policy_assign` does not authorize policy publication or threshold editing; those remain trusted administrative configuration operations, with no additional V1 application capability or public publication command. The owner lock must be acquired by the outer trusted command, including administrative assignments.

The application verifies entry-point attribution before calling commands; a raw public database caller must not be able to claim a trusted assistant/automation origin. Future channel adapters and credential delegation are implementation work. This document proposes privilege changes only; no grants, RLS policies or roles are changed now.

## 6. Indexes and history reads

Primary/unique keys cover policy version, threshold ordering, latest assignment sequence, first owner/Level reach, command replay, sole definition unlock and sole redemption. Add owner-leading indexes for definition listings (archive state, required Level, ID), unlock history (time, ID) and event history (reward ID, recorded time, ID), plus supporting indexes for restrictive reference lookups where not already covered. Existing EXP owner/source indexes remain authoritative for aggregation/evidence lookup. Avoid redundant indexes that duplicate an existing key; validate plans when implemented.

Return exact numeric evidence without floating-point loss. Treat timestamps as audit/display data, not ordering for current policy or source uniqueness. Assignment sequence selects current policy; unique IDs and source contracts define identity. Historical joins remain available because referenced configuration and source facts cannot be removed.

## 7. Review and deferred work

The design closes duplication with database uniqueness plus matching-intent receipts; closes reversal loss with immutable first-reach/unlock history; and closes missed cross-Quest peaks with owner serialization and atomic recognition. Content freezing plus snapshots protects historical promises. UI/AI share controlled commands. Threshold versions allow tuning without schema changes.

Implement the requirements' acceptance matrix later, including direct-write/foreign-owner denial, policy publication validation, cost validation, exact numeric boundaries, duplicate command IDs, large jumps, concurrent edit/archive/redemption, cross-Quest races, transaction fault injection and response-loss replay. These tests are not run or claimed by this documentation task.

LR-OQ-01 is closed by the approved initial curve. No numerical-curve or threshold-specific schema blocker remains. No Level/Reward design or migration-preparation blocker remains. Production enablement still requires the explicit published/assigned threshold set for Levels 1 through 100, coordinated migration/commands and successful integration/RLS tests. Automated purchases, Finance linkage, repeated rewards, historical revocation, redemption undo and AI confirmation implementation are deferred.
