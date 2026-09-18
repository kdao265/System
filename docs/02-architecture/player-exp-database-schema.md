# Player + EXP — V1 physical database design

Status: Proposed design for a later PostgreSQL/Supabase migration and command implementation. No SQL, migration, application change or deployed behavior is supplied.

Branch: `docs/player-exp-foundation`. Authority: [Player/EXP requirements](../01-requirements/player-exp.md), [Quest physical schema](quest-database-schema.md) sections 7, 13–17, [Quest domain model](quest-domain-model.md), [Auth/Profile physical design](auth-profile-database-schema.md), [project context](../PROJECT_CONTEXT.md) and [ADRs](decisions.md).

## 1. Proposed architecture decision — PE-ADR-01

Context: Quest needs atomic credits and compensating reversals before completion can be enabled. The current repository has Auth, Profile and Quest storage but no implemented Player ledger.

Decision for this proposal: one table, `public.exp_ledger`, directly owned by Auth users; immutable entries, generic typed source UUIDs, a same-owner reversal FK, source/reversal uniqueness, and a derived net total. No `players` table, cached aggregate, general adjustment API or new execution-role hierarchy.

Alternatives and impact:

| Choice | Comparison and selected approach |
| --- | --- |
| Separate Player row | Adds provisioning/existence synchronization without any required independent field. Defer; use Auth identity directly |
| Derived versus cached total | Derivation has no duplicated state or extra write lock. A cache requires same-transaction ledger/aggregate changes, per-owner concurrency control and reconciliation. Choose derivation until measured need justifies a separate reviewed design |
| Generic source versus Quest FK | A Quest-only FK strongly enforces existence but couples every source to Quest or requires nullable source-specific columns. Choose generic `source_type` + `source_id`; guarded database append routines must validate exact source existence/kind/owner and preserve retention. This is a deliberate loss of declarative cross-domain FK enforcement, not permission to accept arbitrary UUIDs |
| Existing versus new writer role | Reuse the existing non-login, non-table-owner `quest_command_owner` for this Quest-only milestone, adding only ledger SELECT/INSERT under RLS. Private Player-owned routines encapsulate EXP rules; a second role is unnecessary now |

This is a documented proposal, not an accepted new implementation ADR or authorization to expose commands. Product Owner review precedes later implementation. Existing Quest/Profile semantics and historical migrations are unchanged.

## 2. Table and columns

`public.exp_ledger` represents committed EXP effects; there is no pending/status/updateable row. The conceptual `ExpTransaction` in Quest documents maps to a row here.

| Column | PostgreSQL type | Nullable | Default | Meaning / constraints |
| --- | --- | --- | --- | --- |
| id | uuid | No | Database-generated UUID v4, `gen_random_uuid()` | Primary key; an internal command may preallocate it in the same transaction for immutable receipt references |
| user_id | uuid | No | None | Verified Auth owner, immutable; FK to auth.users.id |
| source_type | text | No | None | Closed V1 discriminator: quest_completion or quest_completion_reversal |
| source_id | uuid | No | None | Completion Event ID for a credit; accepted completion_corrected event ID for a reversal; not a browser request/occurrence ID |
| reason | text | No | None | completion_reward or completion_reward_reversal, paired with source_type |
| amount | bigint | No | None | Signed whole EXP; nonnegative credit or nonpositive exact compensation; no floating point |
| reverses_entry_id | uuid | Yes | NULL | Required on reversal, absent on credit; same-owner FK to original ledger credit |
| recorded_at | timestamptz | No | Database server clock, `now()` | Immutable insertion/transaction recording instant; never user-reported/backdated time |

No updated_at, balance, level, email, display name, timezone, generic mutable JSON, request ID or redundant occurrence/Quest column is required. Source event retains actor, command ID, cycle, occurrence, accepted snapshot and correction facts. A timestamp plus ID gives deterministic presentation order but is not a unique causal/commit sequence; use explicit references for causality.

Quest snapshots remain PostgreSQL integer; bigint ledger storage represents their signed values exactly and leaves numeric headroom without changing Quest reward bounds. The append boundary rejects fractions, overflow or non-integer representations before coercion and derives Quest amounts from the trusted event, never a client number.

## 3. Keys, checks and indexes

| Name / kind | Fields / rule | Guarantee |
| --- | --- | --- |
| pk_exp_ledger | id, primary key | Stable immutable receipt identity |
| uq_exp_ledger_owner | (id, user_id), unique | Same-owner reversal FK target |
| fk_exp_ledger_auth_user | user_id → auth.users.id | Existing Auth identity; DELETE RESTRICT / UPDATE RESTRICT |
| fk_exp_ledger_reversal_owner | (reverses_entry_id, user_id) → exp_ledger(id, user_id) | Target exists and has same owner; DELETE RESTRICT / UPDATE RESTRICT; nullable leading ID skips edge only for credit |
| uq_exp_ledger_source | (source_type, source_id, reason), unique | One effect per global typed source/reason, independent of request or owner changes |
| uq_exp_ledger_reversal | reverses_entry_id, unique partial index when nonnull | At most one compensation per original credit, including zero credits and competing correction IDs |
| ck_exp_ledger_kind | Only the two complete tuples below are allowed | Unknown source/reason combinations cannot bypass deduplication |
| ck_exp_ledger_not_self | Nonnull reverses_entry_id differs from id | Reject direct self-compensation |
| ix_exp_ledger_owner_history | (user_id, recorded_at descending, id), B-tree | Owner timeline, aggregate owner filter and Auth FK reference lookup |

The complete row-kind alternatives for the named CHECK are:

- Credit: source_type `quest_completion`, reason `completion_reward`, amount at least zero, reverses_entry_id null.
- Reversal: source_type `quest_completion_reversal`, reason `completion_reward_reversal`, amount at most zero, reverses_entry_id nonnull.

Required columns are NOT NULL so null-valued CHECK expressions cannot admit an incomplete row. Unique/PK constraints already supply indexes; do not duplicate them. The reversal partial index covers target lookup and FK reverse-reference checks. No JSONB, GIN, balance, occurrence or speculative analytics index is proposed. Plan verification remains later work.

Row CHECKs do not inspect other rows. Target credit kind, exact opposite amount and source-event semantics require the append guard below; a CHECK with a falsely immutable table-reading function is not acceptable. [PostgreSQL constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)

## 4. Source identity and database append guard

Choose generic source columns, with **no FK from source_id to Quest**. The self-reversal and Auth FKs are real constraints; there is no polymorphic FK. No new Quest column or foreign key to the ledger is needed. Existing Quest event payloads may retain preallocated ledger receipt IDs and correction references as already permitted by their contract.

The later migration must provide a mandatory database insert-validation guard, not merely UI checks. It runs under the same RLS-bound command role (SECURITY INVOKER), uses a fixed safe search path/qualified references, and validates the following before accepting a fresh ledger row:

1. Request Auth identity is nonnull and equals row.user_id. Server/database-generated ID and recording time cannot be supplied through a public amount/row endpoint.
2. For a fresh credit insert, source_id resolves under owner RLS to a `quest_events` completed event with its occurrence and cycle. Its payload has the supported version, same event/source identity, exact completion_reward reason and a resolved nonnegative integer snapshot amount. Ledger amount equals that immutable snapshot. Verify event/occurrence/Quest ownership, matching execution_cycle, an eligible unfinished occurrence projection and equality to its fixed reward snapshot. The outer command holds the required Quest locks and inserts the credit before updating the completed projection; ordinary replay returns an existing receipt without reinserting or fabricating a cycle.
3. For a reversal, source_id resolves to a same-owner `completion_corrected` event whose payload explicitly states undo, identifies the original completion and credit, and whose related event/Quest/occurrence match that credit's retained completion source. A reopened event or metadata-only correction is not a substitute source.
4. The target row is an original `quest_completion` / `completion_reward` credit, never another reversal. The new amount is exactly its arithmetic negation, including zero. Target existence/owner are additionally enforced by FK; unique reversal target handles races.
5. Source types/reasons outside this V1 allowlist reject. A mismatch aborts the outer transaction, never rewrites the source or coerces the amount.

Guard validation derives meaning from immutable source facts. It does not require the occurrence to remain completed forever: the coordinated reopen deliberately changes its current projection. Fresh credit acceptance and cycle/state checks belong to the outer command; matching historical retries return existing ledger rows instead of inserting again.

Generic references require a retention contract: completed and correction Quest events are meaningful history and cannot be purged under existing Quest rules. Future source domains must offer equivalent stable identity, owner validation and retained history before being allowlisted. An arbitrary privileged administrator could violate this contract; no normal role is granted that capability. This proposal does not claim a generic UUID gives FK protection.

## 5. Append-only and deletion behavior

After insertion, **every ledger column is immutable**, including ID, owner, amount, source, reason, recording time and reversal target. Reversal does not set a flag on the original row; its state is derived from the linked compensation.

Revoke UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER privileges from runtime roles; grant no corresponding mutation policies. Add a rejecting BEFORE UPDATE/DELETE guard and a rejecting statement-level TRUNCATE guard as defense in depth for accidental later grants. Give application roles no ownership, DDL, trigger-disable or role-administration capability. There is no trivial-draft purge exception for EXP rows, even when amount is zero.

Auth-user deletion is restricted by any retained entry; never cascade or null ownership. Profile cascade behavior remains independent and cannot erase ledger rows. There is no operational ledger cleanup/repair/delete API. Owner/superuser administration is a trusted migration/recovery boundary outside ordinary RLS and append-only guarantees; any emergency repair needs a separate reviewed plan preserving evidence.

## 6. Current EXP read model

Derive current EXP as the sum of all committed signed amounts belonging to the verified owner, mapping an empty set to exact zero. A future authenticated SECURITY INVOKER database read function can expose this aggregate, with no user_id argument and an explicit owner filter plus RLS. It must reject an absent Auth identity, use a fixed safe search path, and have EXECUTE only for authenticated callers; no definer/table-owner view is required. This is part of later read implementation, not SQL supplied here.

PostgreSQL sums bigint inputs as numeric. Keep that exact result; define API transport as a decimal integer string rather than a potentially lossy JavaScript Number. Do not sum a limited/paginated REST result in the browser or downcast the aggregate to integer/bigint without a reviewed bound. [PostgreSQL aggregate functions](https://www.postgresql.org/docs/17/functions-aggregate.html)

A same-owner statement sees a consistent committed snapshot; no cached current_exp row, per-user balance lock, initial seed or frontend calculation is needed. Totals can change after the read because another transaction commits. If a response needs a total and detailed history from the same instant, compute both within one database snapshot rather than assuming separate HTTP reads are simultaneous.

Negative ledger rows are permitted only as exact full compensations of unique nonnegative credits. Therefore valid V1 history has nonnegative net EXP without a cross-row balance CHECK. Never clamp an inconsistent negative sum or block a valid reversal based on a stale cache. Future debit sources require a new approved negative-total policy and appropriate concurrency design.

## 7. RLS, grants and routine boundary

Enable RLS before access. The table owner remains a migration/administration role, not a runtime routine owner. Reuse `quest_command_owner` as defined in the existing Quest migration: NOLOGIN, non-superuser, NOBYPASSRLS and not table owner. Do not grant its membership to authenticated, anon or application login roles.

| Principal | Ledger permissions / policies | Routine access |
| --- | --- | --- |
| PUBLIC / anon | None | Revoke default EXECUTE on private append and aggregate routines |
| authenticated | SELECT only; policy requires nonnull auth.uid() equal to user_id | Later exposed, validated Quest commands and own-total read only; never direct append helper |
| quest_command_owner | SELECT and INSERT only; SELECT USING and INSERT WITH CHECK require nonnull auth.uid() equal to user_id | Own/invoke controlled Quest commands and private EXP append helpers |
| Table owner / migration administrator | Setup/review boundary, not application credential | No browser or general application use |

The role already has owner-scoped Quest event/occurrence SELECT and controlled Quest writes. No new Quest RLS policy or broader Quest permission is needed for ledger source validation. Ledger grants include necessary schema USAGE; use existing auth.uid() execution access. The private helper schema (proposed `exp_internal`) is not API-exposed and grants no CREATE to runtime clients.

Player/EXP owns the semantics of private credit/reversal append helpers. They execute as invokers of the RLS-bound Quest command role. Revoke PUBLIC/anon/authenticated EXECUTE and schema access; grant only the command role what it needs. Exposed Quest routines use the already-approved SECURITY DEFINER pattern owned by that non-table-owner role, preserve authenticated request context, revalidate ownership and derive source/amount internally. Fix search paths, qualify object references, and grant only explicit command EXECUTE to authenticated.

The role can technically INSERT ledger rows, so the mandatory insert guard and uniqueness constraints remain essential even outside the preferred helpers. It has no UPDATE/DELETE/TRUNCATE privileges. No arbitrary owner parameter, `add_exp(amount)` RPC, service-role fallback or RLS bypass is allowed. New non-Quest writers would need separately reviewed, equally scoped grants and source adapters.

RLS limits ownership, not reward legitimacy; only the validated command and append guard establish the latter. Table owners normally bypass RLS, which is why the routine role must remain separate. [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)

## 8. Atomic completion and retry algorithm

All steps run inside one future database transaction in the existing PostgreSQL backend; no HTTP call to a second EXP service and no independently committed append helper.

1. Resolve Auth owner; reject unowned/unknown targets without revealing another owner's facts. Use Quest's lock order: definition, then occurrence. Every competing lifecycle command follows that order.
2. Resolve known command/event and expected execution_cycle before minting IDs. An already accepted cycle returns its original event/ledger receipt after consistency checks, even if the request UUID differs. An old cycle cannot act on reopened work. Conflicting command reuse rejects.
3. For a fresh eligible transition, validate resolved occurrence reward and all Quest-side guards. Allocate completed-event and credit UUIDs inside this operation if bidirectional immutable payload receipts are needed.
4. Append the completed Quest event with its fixed snapshots and approved `(quest_completion, event ID, completion_reward, snapshot amount)` contract. Invoke the private EXP credit helper; the insert guard validates the source and the unique source key prevents duplication.
5. Update the occurrence completed projection and recording/reported times according to Quest. Commit event, credit and projection together. Helper failure propagates and rolls everything back.

On a source uniqueness conflict, do not overwrite or blindly report success. Resolve the committed receipt under owner authorization and compare all semantic fields. A duplicate insert path may use conflict handling only to return an exactly matching receipt; no update-on-conflict ledger mutation is allowed. A mismatching receipt aborts. A row inserted by a concurrent transaction may require a new statement snapshot after waiting; do not assume the conflicting row is visible in the same statement. Serialization/deadlock retries rerun the complete command and resolve existing sources first.

If an accepted historical Quest event lacks its ledger credit, normal replay fails as an integrity incident instead of performing opportunistic backfill or minting another event. In a correct integrated deployment such a split cannot commit. Account/receipt identity and data remain exact across lost responses. A committed credit that is now reversed is still the original receipt, with its compensation visible; returning it never awards again.

## 9. Atomic completed reopen and compensation

1. Authenticate and acquire the same Quest/occurrence locks. Resolve matching prior command/correction before checking whether this is a fresh completed reopen. Reject stale/conflicting new intent.
2. Resolve the current completed event and its exact original ledger credit. Verify same owner/Quest/occurrence/cycle and retained amount. A missing/mismatched credit is an integrity failure; do not reopen.
3. Preallocate correction/reversal IDs if necessary, then append `completion_corrected` with undo=true, related original Completion Event, original credit and compensation receipt. Append the ledger reversal with source_type `quest_completion_reversal`, source_id that correction event, reason `completion_reward_reversal`, and the negative original amount.
4. Append `reopened` (same Quest command ID, new execution cycle as specified by Quest), increment execution_cycle and clear current completion fields; enforce the chosen unfinished-state guards. Commit all changes together. If any step fails, completed state and unreversed credit remain.

The correction event is the reversal source; the reopened event is the lifecycle result. Their distinct IDs must not create two reversal entitlements. A repeat correction returns the original compensation. Another correction UUID attempting the same target is rejected as new work or resolves the already accepted semantic reopen without appending another correction/reversal. Source uniqueness plus global unique reversal target prevent double subtraction.

Ledger rows are immutable, so no ledger row UPDATE lock/UPDATE grant is required: Quest locks serialize lifecycle transitions, and the unique target index handles competing compensation inserts. Validation reads the original immutable credit. Failed/cancelled reopen and metadata-only correction follow Quest without a ledger write.

Later recompletion uses a new event C2, not C1. Its snapshot may still be 50 even if the definition default is now 80. If the unfinished occurrence was explicitly edited under Quest rules, C2 uses its newly fixed value while C1 and its reversal stay unchanged. The existing occurrence/event-cycle constraints and commands, not an occurrence-based ledger key, ensure at most one unreversed entitlement.

## 10. Concrete history example

Aliases below represent distinct UUIDs, not executable rows or SQL. All belong to owner U and occur through accepted Quest transactions.

| Ledger ID | source_type | source_id | reason | amount | reverses_entry_id | Net after commit |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | quest_completion | C1 (completed, cycle 1) | completion_reward | 50 | null | 50 |
| L2 | quest_completion_reversal | X1 (completion_corrected, undo C1) | completion_reward_reversal | -50 | L1 | 0 |
| L3 | quest_completion | C2 (completed, cycle 2) | completion_reward | 50 | null | 50 |

Five retries of C1 still reference L1. After X1, a late C1 request does not resurrect its credit. Retrying X1 returns L2. A different correction source cannot compensate L1 again. C2 has an independent credit and could later have one independent reversal of L3. With amount zero, the same three entries and links exist with zero amounts and unchanged totals.

## 11. Enforcement ownership and future sources

| Invariant | Enforcement |
| --- | --- |
| Required values, approved kinds/signs, no self-reference | NOT NULL and row CHECKs |
| Unique receipt/source/compensation | PK, global source UNIQUE and partial unique reversal-target index |
| Existing owner and same-owner original credit | Restrictive Auth/self FKs plus RLS |
| True completed/correction source, exact snapshot/negation, no reversal-of-reversal | Mandatory database insert guard and private append helpers |
| One accepted completion per cycle, legitimate new cycle, no second live entitlement | Existing Quest constraints plus locked atomic commands |
| No acknowledged partial completion/reopen | One outer database transaction; errors never swallowed |
| Immutable history | Narrow grants, absent mutation policies, rejecting mutation guards and retained source-domain history |
| Net nonnegative EXP | Nonnegative credits and at most one exact compensation each; no other V1 debits |

Future EXP sources can allocate stable domain event UUIDs in their own namespace, define a closed source/reason pair and validation/retention contract, and extend guards/checks through a new migration. They must also define compensation identity and a same-transaction integration path (or separately approved consistency design). Adding an enum label/string alone is insufficient. No general payload blob, external unverified source, penalty deduction or arbitrary manual adjustment is enabled now.

## 12. Migration and enablement gates

Later work must verify PostgreSQL/Supabase role/UUID support, existing Quest source payload versions and RLS grants locally. Create the ledger, constraints, indexes, guards, private routines and policies before exposure; add no client write privileges during staging. Existing historical migrations are not rewritten.

The current Quest schema may precede this ledger, but the ledger table alone does not enable completion. Implement and test the coordinated Quest completion/reopen commands before allowing either operation. Preflight must detect any unexpected already-completed Quest history without ledger receipts; resolve it through a separately reviewed reconciliation plan, not automatic rewards/backfill during rollout.

Future verification must exercise every [PE acceptance criterion](../01-requirements/player-exp.md#11-acceptance-criteria-for-later-implementation), including real concurrent same/different-ID retries, transaction fault injection at each write boundary, response loss, zero/max-Quest-integer amounts, FK/guard failures, role-membership/EXECUTE audits, cross-user attempts and forbidden mutation/TRUNCATE. Test aggregate precision above JavaScript's safe integer range using controlled fixtures. No such database tests were run by this design task.

## 13. Requested decisions resolved

| Question | V1 choice |
| --- | --- |
| 1. Players table necessary? | No; conceptual Player is the Auth owner |
| 2. Ledger primary identity? | Database UUID id |
| 3. Quest credit identity? | quest_completion + completion_event_id + completion_reward |
| 4. Duplicate credit prevention? | Global source UNIQUE plus Quest cycle/state/command validation |
| 5. Reversal representation? | New immutable exact compensating row, correction-event source, same-owner original-credit link |
| 6. Duplicate reversal prevention? | Unique reversal source and at most one nonnull reversal target |
| 7. Current EXP? | Derived exact server/database sum; empty is zero |
| 8. Negative EXP? | Negative rows only for full reversals; supported net total never negative; future debit policy deferred |
| 9. Who inserts? | RLS-bound quest_command_owner through validated private EXP helpers and mandatory insert guard |
| 10. Who updates/deletes? | No normal application/runtime role; history is append-only, including zero entries |
| 11. Atomicity? | One PostgreSQL transaction for Quest projection/event/credit; analogous transaction for correction/reversal/reopen |
| 12. Future non-Quest sources? | Generic typed UUID namespace, but only after explicit validation/retention/privilege extensions |
| 13. EXP command failure? | Abort the entire Quest operation; retry resolves stable accepted receipts, never partial success |
| 14. Level boundary? | Future derived progression policy; no approved formula, thresholds, initial Level or persisted Level introduced |

No unresolved design blocker remains for this minimum proposal. Approval, local platform verification and integrated command implementation are enablement gates. Level policy, penalties/spending, more general compensation and account erasure remain explicitly deferred.

## 14. Documentation review

Reviewed against Quest CR-02–04/CR-07, AC-23/AC-26/AC-38/AC-41 and physical sections
13/16/17. The approved credit tuple, cycle identity, full compensation, zero reward,
unchanged snapshots and completion enablement gate are preserved. Review covered
same/different-ID retries, cross-user sources, self-awards, historical mutation,
duplicate reversal, stale completion after reopen and legitimate recompletion.

Relative documentation links and whitespace were checked; `git diff --check`
passed. Git review contains only these two new design documents and the two small
context/overview cross-references. No existing Quest documents, application files,
package files or migrations changed. No packages, SQL, database connections or
runtime tests were needed for this documentation-only task. Future acceptance tests
above are specified, not reported as executed.
