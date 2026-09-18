# Player + EXP — minimum V1 foundation

Status: Design proposal for later implementation, based on the requested foundation and approved Quest contract. No ledger or Quest command is implemented by this document.

Owner: Human Product Owner. Branch: `docs/player-exp-foundation`.

Sources: [project context](../PROJECT_CONTEXT.md), [vision](../00-product/vision.md), [V1 scope](../00-product/scope-v1.md), [Quest requirements](quest-engine.md) (CR-02–04, CR-07, AC-23, AC-26, AC-38, AC-41), [Quest domain model](../02-architecture/quest-domain-model.md) (INV-07–08, INV-12, INV-16), [Quest physical design](../02-architecture/quest-database-schema.md) (sections 13, 16–17), [Auth/Profile requirements](auth-profile.md) and [accepted ADRs](../02-architecture/decisions.md). Companion: [Player/EXP physical design](../02-architecture/player-exp-database-schema.md).

## 1. Purpose and task boundary

Provide the smallest auditable EXP foundation needed before atomic Quest completion and completed-work reopening can be enabled. Player describes the authenticated owner's progression; EXP is a game progression measure, never money.

This task delivers these requirements and a physical database design, with small context/architecture cross-references. It does not write SQL, modify migrations or application code, install dependencies, connect to Supabase, or stage/commit/push. Validation is document consistency, contract/security review, relative-link checks and Git review; database acceptance tests below are future work.

## 2. Scope and non-goals

Include owner identity, an append-only ledger, Quest completion credits, full compensating reversals, source idempotency, current EXP and audit/security boundaries. Explicit zero rewards are included.

Defer stats, Level formulas, skills/classes/equipment, currencies, achievements, ranking/social features, spending, manual EXP grants, Penalty deductions, balancing formulas and automatic difficulty scaling. No new UI, scheduler, delivery queue or generalized reward engine is designed. Future EXP sources require their own approved rules; generic source columns do not authorize arbitrary grants.

## 3. Player identity

**No `public.players` table is needed now.** Ledger ownership references `auth.users.id` directly. Every authenticated identity has a conceptual Player and an initial current EXP of zero, even with no ledger rows. Do not create a zero-balance seed row, duplicate Auth identity, copy credentials/email, or extend Profile with EXP fields.

Profile owns display name and timezone; neither is Player identity or proof of EXP authority. Its provisioning remains unchanged. No timezone requirement is introduced for ledger recording or aggregation. A later Player table, if justified by actual Level/stats storage, can use the same Auth ID without changing ledger ownership.

Retained EXP history blocks Auth hard deletion. Do not cascade-delete or anonymize ledger history as an implicit account-erasure policy. Any future erasure workflow requires a separate retention decision, consistent with Quest's retained history.

## 4. EXP earning

| ID | Requirement |
| --- | --- |
| PE-FR-01 | Supabase Auth owns identity; EXP entries belong to the verified owner |
| PE-FR-02 | Each accepted Quest Completion Event creates exactly one immutable credit with the approved source tuple and snapshot amount |
| PE-FR-03 | A credit amount is the resolved nonnegative integer reward, including zero; no late reduction or invented formula |
| PE-FR-04 | Undo preserves the credit and appends one full same-owner compensating entry linked to it |
| PE-FR-05 | Replays/concurrent retries cannot duplicate credits or reversals, even with new request IDs |
| PE-FR-06 | Current EXP is the server/database sum of committed signed ledger amounts; no cached balance or frontend authority |
| PE-FR-07 | Quest projection, completion event and EXP credit commit together; completed reopen and reversal also commit together |
| PE-FR-08 | Owners may read their history; browser clients cannot append or mutate ledger entries |
| PE-FR-09 | Errors preserve atomicity and history; source/ownership mismatches fail safely rather than being silently accepted |

For Quest completion, preserve this exact contract:

| Field | Value |
| --- | --- |
| source_type | `quest_completion` |
| source_id | Accepted `completion_event_id` (`quest_events.id`, event type `completed`) |
| reason | `completion_reward` |
| amount | That completion's fixed `reward_exp_snapshot` |

The occurrence snapshot is authoritative when accepting completion; the immutable completion payload preserves it afterward. Neither a browser amount, mutable definition default, current occurrence edit, request ID nor occurrence ID substitutes for this source/amount. A null reward blocks completion; it is not converted to zero. Explicit zero creates a real ledger row for the same audit and retry guarantees.

## 5. Reversal and correction

Undoing completion appends a reversal of the original credit's exact amount. It never edits/deletes that credit. The reversal has its own ledger ID, source type `quest_completion_reversal`, source ID equal to the accepted `completion_corrected` Quest event ID, reason `completion_reward_reversal`, and `reverses_entry_id` pointing to the original ledger credit. The correction event must explicitly undo that original Completion Event for the same owner/Quest/occurrence.

A positive credit has an equal negative reversal; a zero credit has a zero-valued reversal, still distinguished by reason and link. Sign alone cannot identify a zero reversal. There are no partial reversals, second reversals of the same credit, reversal-of-reversal, or discretionary amount adjustments in this foundation.

Metadata-only corrections do not reverse EXP. Reopening failed/cancelled work with no granted completion credit creates no reversal. Archive, source default edits and Profile changes create no ledger effects. Missing or inconsistent credit during completed reopen is an integrity failure: do not reopen or fabricate a replacement credit.

A later legitimate completion after an accepted reopen creates a new Completion Event and new credit. Further compensation must target that new credit, not reverse the old one again. More general independent compensation policies are deferred and cannot bypass this rule.

## 6. Idempotency and replay

Enforce credit source uniqueness at the database level on `(source_type, source_id, reason)`. All three are required, and the V1 source/reason combinations are closed. Do not include user_id as an escape hatch that would allow one source to be credited to two owners. Owner validation precedes receipt disclosure; UUID knowledge conveys no authority.

Reversal source uniqueness applies to its correction-event tuple. Additionally, at most one row may reference a given nonnull `reverses_entry_id`; changing the correction event/request ID cannot reverse the same credit again. The original-credit link is same-owner and must target a credit, never a reversal.

Retries return the original receipt only when owner, source, reason, amount and reversal target agree with the accepted facts. A conflicting payload is rejected. An already-reversed original remains reversed; a late completion retry must not append a replacement credit. A changed request ID is not proof of a new transition.

Quest's existing `(occurrence_id, execution_cycle)` completion uniqueness and expected-cycle/locking rules remain authoritative. Ledger source uniqueness does not independently prevent someone from inventing a new Quest event/cycle; only the controlled Quest command may accept one. Together these rules ensure at most one unreversed entitlement per occurrence.

## 7. Current EXP and negative values

**Choose derived current EXP:** add all committed ledger amounts for the authenticated owner on the server/database, returning zero for an empty history. Include original credits and their compensations. Do not both exclude reversed credits and subtract reversals, which would double-deduct.

“Total EXP” in this foundation means this same net current total, not a second lifetime-earned or spendable balance. No total/current column, cache, materialized view or separate Player row is required. A cached total would add coordinated writes, drift/reconciliation and concurrency requirements without a demonstrated V1 need. The physical design compares both options.

Individual reversal rows can be negative; **current EXP cannot become negative in supported V1 operations**. Each nonnegative credit has at most one exact full reversal and there are no other debit sources, so each credit/reversal pair contributes zero or a nonnegative amount. This follows from enforced pairing, not from frontend clamping or an unsafe read-then-write balance check. A detected negative aggregate is an integrity error, not zero or permission to insert a repair grant. Future penalties/spending must separately decide debt/floor policy before enablement.

Keep arithmetic exact and integer-valued through storage, aggregation and transport. Display code may format the authoritative result but must not reconstruct the balance from a paginated history or use floating-point rounding as authority.

## 8. Atomic Quest command boundary

One future authenticated database command, in the same PostgreSQL transaction, must validate ownership/expected cycle, lock Quest then occurrence, accept the completed event, append its ledger credit, and update the occurrence projection. It commits all effects or none. The browser submits the domain intent, not separate “complete” and “award EXP” calls.

Completed reopen similarly preserves the old event/credit, appends a completion-correction event and exact reversal, appends the reopened event, increments the execution cycle and clears completion projection atomically. Do not make the occurrence executable before that transaction succeeds. Event/ledger IDs may be preallocated within the transaction so their immutable references are written once without later patching history.

If validation, ledger append, permissions, uniqueness, database availability or a commit fails, do not acknowledge partial completion/reopen. On an ambiguous response loss, resolve the existing command/cycle and ledger receipts; retry the complete transaction only when no accepted result exists. Preserve committed history. Downstream Goal/Project delivery is separate and cannot cause EXP to be replayed.

Quest completion and compensated reopen remain disabled until schema, append guards, controlled commands and concurrency/RLS verification are implemented together. This documentation does not remove that gate.

## 9. Authorization and auditability

Normal authenticated clients may read only their own ledger/history and derived current EXP. Anonymous clients have no access. Neither browser code nor a general “add EXP” endpoint may insert entries, supply arbitrary sources, change ownership, or UPDATE/DELETE/TRUNCATE history.

The existing RLS-bound non-login Quest command role may append through the future private Player/EXP routines described in the physical design. These routines resolve and validate trusted source events and amounts. No table-owner execution, BYPASSRLS fallback, client role membership or service-role credential is introduced. Owner policies alone cannot prevent self-awards, so direct client INSERT remains closed.

Each entry explains owner, signed amount, reason, stable source, authoritative recording instant and reversal target. Retained Quest source events supply actor, occurrence, cycle, correction and reported-time context; ledger timestamps are not backdated. No secrets or mutable balance snapshots belong in audit records.

## 10. Failure behavior

Duplicate matching requests return the accepted receipt; mismatches and foreign/unknown sources reject safely. A ledger outage or failure blocks the whole Quest transaction. An absent ledger row for an already committed accepted completion is an integrity incident requiring controlled investigation, not browser repair or a second completion event. Reconciliation may identify inconsistent history but is not a new unrestricted grant path.

No operation swallows an append error and commits Quest anyway. Owner failures must not reveal another user's ledger/source. Exact representation/overflow failures reject rather than round. Database administrator corruption is outside normal application permissions and requires a separately reviewed recovery procedure.

## 11. Acceptance criteria for later implementation

| ID | Given / When / Then |
| --- | --- |
| PE-AC-01 | New Auth user with no entries has current EXP 0 without a Player/seed row |
| PE-AC-02 | Accepted completion C1 with snapshot 50 commits one `(quest_completion, C1, completion_reward, 50)` credit with matching owner |
| PE-AC-03 | Five/concurrent retries, including different command IDs for the same cycle, retain one event, one credit and total 50 |
| PE-AC-04 | A ledger failure at any completion write/commit point leaves no committed partial event, projection or credit; response-loss replay returns the committed receipt |
| PE-AC-05 | Undo after default changes 50 to 80 preserves +50, adds exactly -50 linked to it and reopens atomically; retry leaves net 0 |
| PE-AC-06 | Another correction ID cannot reverse C1's credit twice; foreign-owner, wrong-amount, self and reversal-of-reversal targets reject |
| PE-AC-07 | Recompletion C2 after reopen adds its independent credit; stale C1 requests cannot re-credit or complete C2's cycle; only one unreversed entitlement exists |
| PE-AC-08 | Explicit zero creates one credit and, if undone, one linked zero reversal; missing/negative/fractional reward input rejects |
| PE-AC-09 | Empty, credited, reversed and recompleted histories yield exact net totals; no frontend calculation, cache drift, clamp or double deduction |
| PE-AC-10 | Anonymous/other-owner reads and direct client INSERT/UPDATE/DELETE/TRUNCATE fail; guessed IDs and caller-supplied owner/amount cannot self-award |
| PE-AC-11 | Ledger history/ownership/timestamps stay immutable; Auth deletion with retained entries is restricted; archival never reverses or deletes entries |
| PE-AC-12 | Unknown source types/reasons, unaccepted/foreign Quest events and same-source conflicting amounts reject with no partial effects |
| PE-AC-13 | Concurrent undo/recompletion and failed transactions preserve original history and at-most-one unreversed entitlement; uniqueness conflicts are resolved only after semantic validation |
| PE-AC-14 | Metadata correction and failed/cancelled reopen without a credit create no debit; compensation failure leaves completed work closed |
| PE-AC-15 | With no approved Level formula, EXP works without a stored Level or fabricated Level value |

## 12. Level boundary and remaining gates

Level belongs to a later progression policy derived from authoritative current EXP, with an approved formula/version and explicit behavior when EXP decreases after reversal. No formula, initial Level, thresholds or persisted Level is invented here. Stats/achievement eligibility remains separately owned.

No unresolved minimum ledger design blocker remains in this proposal; the physical design resolves the fourteen requested questions. Product Owner review, migration/platform preflight and atomic-command implementation/testing are still required before production enablement. Level, new source/debit policies and account erasure are deferred feature gates, not reasons to weaken the Quest completion contract.
