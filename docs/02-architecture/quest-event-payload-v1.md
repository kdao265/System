# Quest event payload V1 — Player/EXP integration contract

Status: Approved contract supplied by the Product Owner; documentation only. No migration, command or ledger implementation is supplied. Branch: `docs/quest-event-payload-v1`.

Authority: [Quest requirements](../01-requirements/quest-engine.md), [Quest domain](quest-domain-model.md), [Quest physical schema](quest-database-schema.md), [Player/EXP requirements](../01-requirements/player-exp.md), [Player/EXP physical design](player-exp-database-schema.md), and the existing [Quest migration](../../supabase/migrations/20260918034836_create_quest_engine.sql). Downstream [Level/reward integration](level-reward-domain-model.md) retains its separate atomic recognition requirements.

## 1. Scope and version

Define only the canonical Player/EXP integration envelope inside `quest_events.payload` for `completed` and EXP-reversing `completion_corrected` events. Do not freeze the whole Quest payload or design unrelated metadata. Existing Quest obligations to retain times, execution snapshots and prior/new outcomes remain; their other JSON paths are outside this envelope.

The enclosing row must have `payload_version = 1` and an object payload. Player/EXP V1 accepts only this version and the applicable shape below. Missing fields, invalid types, unsupported versions and semantic mismatches reject the progression operation and abort its transaction. Do not guess aliases, silently normalize conflicting facts or fall back to another payload field. An incompatible change requires a later payload version and explicit consumer support, not reinterpretation of V1.

## 2. Authority and JSON types

The relational event row is authoritative for `id`, `user_id`, `quest_id`, `occurrence_id`, `execution_cycle` and `event_type`. Its owner must match the authenticated owner and the referenced Quest and occurrence. Payload copies are immutable integrity checks, not competing authorities. Payload IDs cannot redirect an event to another owner, Quest, occurrence or cycle.

| Value | Required JSON type and validation |
| --- | --- |
| `payload`, `payload.exp`, and undo's `payload.correction` | Objects, never arrays, strings or null |
| All UUID values in the envelope | JSON strings parseable as PostgreSQL UUID; compare UUID identity to the referenced relational value |
| Source type and reason | JSON strings exactly matching the literals below |
| `payload.correction.undo` | JSON boolean `true` for an EXP reversal; neither the string `"true"` nor a truthy value qualifies |
| Amount | JSON number, mathematically integral, with exact arithmetic and the sign/equality rules below |

Numeric strings such as `"50"`, fractions such as `50.5`, booleans, missing values and JSON null are invalid amounts. Explicit numeric zero is valid; missing/null must never become zero. A mathematically integral numeric representation such as `50.0` represents the same exact integer, not a fractional reward. Validate the JSON type and integrality before conversion; do not round. Credits are bounded by the existing nonnegative PostgreSQL integer occurrence snapshot; ledger bigint storage and exact negation do not change that bound.

At fresh completion acceptance, the locked occurrence's resolved `reward_exp_snapshot` is authoritative for the amount. The canonical `payload.exp.amount` preserves that accepted reward immutably. A browser amount, definition default, unrelated payload key or later edit to the occurrence is never a replacement authority. Reversal uses the retained original credit and completion, not the occurrence's current reward configuration.

## 3. Completed event envelope

For `event_type = completed`, the following is a concrete example with synthetic receipt IDs and a reward of 50. The enclosing completed row has ID `00000000-0000-4000-8000-000000000101`.

```json
{
  "exp": {
    "source_type": "quest_completion",
    "source_id": "00000000-0000-4000-8000-000000000101",
    "reason": "completion_reward",
    "amount": 50,
    "ledger_entry_id": "00000000-0000-4000-8000-000000000201"
  }
}
```

All these paths are mandatory:

| JSON path | V1 meaning / required equality |
| --- | --- |
| `payload.exp.source_type` | Exactly `quest_completion` |
| `payload.exp.source_id` | UUID equal to this completed event's relational `id` |
| `payload.exp.reason` | Exactly `completion_reward` |
| `payload.exp.amount` | Nonnegative exact integer equal to the locked occurrence's fixed reward snapshot accepted for this completion |
| `payload.exp.ledger_entry_id` | Preallocated UUID of the credit row to be inserted in the same transaction |

Fresh acceptance verifies matching event/occurrence/Quest ownership and identity, matching execution cycle, a completion-eligible unfinished occurrence and a resolved reward snapshot. A missing/null snapshot blocks acceptance. Credit insertion precedes changing the occurrence projection to completed. The source guard must validate this envelope as well as the existing relational/state checks; merely finding an event with the right UUID or owner is insufficient.

The resulting credit mapping is exact:

| Ledger column | Required value |
| --- | --- |
| `id` | `payload.exp.ledger_entry_id` |
| `user_id` | Event `user_id`, matching authenticated owner |
| `source_type` | `payload.exp.source_type` = `quest_completion` |
| `source_id` | Event `id` = `payload.exp.source_id` |
| `reason` | `payload.exp.reason` = `completion_reward` |
| `amount` | `payload.exp.amount` |
| `reverses_entry_id` | Null |

`recorded_at` remains database-authoritative under the ledger design. The command allocates receipt IDs; browser-supplied receipt/source IDs do not establish authority.

## 4. Completion-corrected undo envelope

Only an explicit completion undo may source a reversal. This example corrects the completed event and credit above. The enclosing correction row has ID `00000000-0000-4000-8000-000000000102` and `related_event_id = 00000000-0000-4000-8000-000000000101`.

```json
{
  "correction": {
    "undo": true,
    "original_completion_event_id": "00000000-0000-4000-8000-000000000101"
  },
  "exp": {
    "source_type": "quest_completion_reversal",
    "source_id": "00000000-0000-4000-8000-000000000102",
    "reason": "completion_reward_reversal",
    "amount": -50,
    "original_credit_entry_id": "00000000-0000-4000-8000-000000000201",
    "reversal_entry_id": "00000000-0000-4000-8000-000000000202"
  }
}
```

All these paths are mandatory for the reversing case:

| JSON path | V1 meaning / required equality |
| --- | --- |
| `payload.correction.undo` | JSON boolean `true` |
| `payload.correction.original_completion_event_id` | Original completed event UUID; equal to correction row's `related_event_id` |
| `payload.exp.source_type` | Exactly `quest_completion_reversal` |
| `payload.exp.source_id` | UUID equal to this correction row's `id` |
| `payload.exp.reason` | Exactly `completion_reward_reversal` |
| `payload.exp.amount` | Exact integral negation of the original credit's amount, including zero |
| `payload.exp.original_credit_entry_id` | UUID of the retained original credit |
| `payload.exp.reversal_entry_id` | Preallocated UUID of the new reversal row |

The related event must be `completed`, have a valid V1 completion envelope, and belong to the same owner, Quest and occurrence. The correction's execution cycle equals the original completed event's cycle being undone. Fresh completed-reopen validates that this is the applicable current completed cycle; the later `reopened` event uses the incremented cycle under the existing Quest contract. Historical retries do not compare old receipts to a later mutable occurrence cycle as though they were fresh commands.

The original credit must have the same owner, source type `quest_completion`, source ID equal to the original completed event ID, reason `completion_reward`, and no reversal target. Its ID must equal both `payload.exp.original_credit_entry_id` on the correction and `payload.exp.ledger_entry_id` on the original completion. Its amount must match the original completion's `payload.exp.amount`. Reject missing or inconsistent original receipts, partial reversals, reversal-of-reversal and self-reversal. Never substitute today's occurrence snapshot.

| Reversal ledger column | Required value |
| --- | --- |
| `id` | `payload.exp.reversal_entry_id` |
| `user_id` | Correction event `user_id`, matching authenticated owner |
| `source_type` | `quest_completion_reversal` |
| `source_id` | Correction event `id` = `payload.exp.source_id` |
| `reason` | `completion_reward_reversal` |
| `amount` | `payload.exp.amount` = exact negation of original credit amount |
| `reverses_entry_id` | `payload.exp.original_credit_entry_id` |

`related_event_id` is therefore a mandatory relational cross-check for an undo; the payload cannot replace it. A `reopened` event is not a reversal source. Metadata-only corrections do not mint EXP compensation. A correction with undo other than boolean true, missing references or a malformed envelope cannot qualify for reversal. This contract does not require unrelated metadata-only corrections to carry an EXP envelope, nor prescribe their other payload fields.

## 5. Receipt preallocation and atomic ordering

Resolve accepted retries before allocating fresh IDs. For a fresh completion:

1. Authenticate and lock the Quest definition, then occurrence, under the existing lock order.
2. Validate the expected execution cycle, transition eligibility and fixed reward snapshot.
3. Preallocate distinct completed-event and credit-ledger UUIDs inside the command.
4. Insert the completed event with its V1 envelope and preallocated credit receipt.
5. Append the validated credit with that exact receipt ID.
6. Update the completed occurrence projection.
7. Commit the event, credit and projection together.

For a fresh completed reopen:

1. Authenticate and acquire the same Quest/occurrence locks.
2. Resolve the original completed event and its exact immutable credit; validate the applicable cycle.
3. Preallocate correction-event and reversal-ledger UUIDs inside the command.
4. Insert the correction with `related_event_id` pointing to the original completion, boolean undo true, original credit reference and new reversal receipt.
5. Append the exact compensation using the preallocated reversal ID.
6. Append the reopened lifecycle event and update execution cycle/projection according to Quest; correction uses the old cycle and reopened uses the new cycle.
7. Commit all effects together. Do not make the occurrence executable before successful compensation.

Failure at any step rolls back every effect. Receipt preallocation is mandatory for these V1 envelopes; it is not an independently committed receipt reservation or later payload patch. When Level/reward progression is enabled, its owner lock precedes the unchanged Quest lock order and its mandatory milestone/unlock writes join the same transaction, as [already specified](level-reward-domain-model.md#5-atomic-recognition-and-lock-order). This envelope adds no Level state or new progression semantics.

## 6. Idempotency and extra fields

Completed event ID is the credit source; correction event ID is the reversal source. Ledger credit/reversal IDs are receipts, not source IDs, command IDs or occurrence IDs. Resolve accepted events and matching receipts before minting IDs. A different request/command UUID cannot justify another credit for the same completion or another reversal of the same credit.

Existing global source uniqueness permits at most one credit per completion source; reversal-target uniqueness permits at most one compensation per original credit. Verify receipt mappings on replay and return the original accepted facts. A missing or conflicting receipt is an integrity failure, not an invitation to backfill using current configuration. A legitimate later completion uses the new execution cycle and a new completed event/credit; it cannot resurrect the old entitlement. Zero credits and zero compensations use exactly the same receipt and uniqueness rules.

Quest may carry additional approved non-EXP payload fields. Player/EXP ignores unrelated keys, including extensions that do not replace the canonical fields; those keys cannot change amount, source, ownership, receipt identity or undo meaning. Every canonical path above retains its fixed V1 type and meaning. Extra keys cannot compensate for a missing required path or override a failed cross-check. Incompatible meanings require `payload_version > 1`; V1 consumers reject unsupported versions.

## 7. Review and migration readiness

| Review question | Resolution |
| --- | --- |
| Exact JSON paths defined? | Sections 3 and 4 define every canonical path |
| JSON types defined? | Section 2 requires objects, UUID/string literals, boolean undo and integral numbers |
| Reward authority clear? | Locked accepted occurrence snapshot, then immutable completion/credit for history |
| Completed identity clear? | Relational completed event ID; payload source must match |
| Original credit clear? | Correction's original credit UUID cross-checked against completion receipt and credit source |
| Compensation receipt clear? | Correction's reversal UUID equals new ledger row ID |
| Related-event role clear? | Mandatory reference to the same-owner/Quest/occurrence completed event in the old cycle |
| Metadata correction can reverse accidentally? | No; explicit valid undo envelope is mandatory |
| Zero values safe? | Numeric zero creates real credit/reversal receipts; null/missing reject |
| Retry can duplicate credits? | No; accepted receipt resolution plus existing global source uniqueness |
| Retry can duplicate reversals? | No; accepted receipt resolution plus unique original-credit target |
| Relational authority preserved? | Yes; conflicting payload copies reject |
| Historical Quest migration needs modification? | No; existing object payload, version, related-event and identity/cycle columns support this contract |
| Player/EXP payload blocker resolved? | Yes; source guards no longer need to invent JSON paths or receipt mappings |

No unresolved contract-design blocker remains for Player/EXP migration preparation. Later implementation must enforce this contract in the mandatory database insert guard and controlled commands; the existing generic JSON-object check alone does not enforce it. Ledger migration, command integration and local behavior/RLS/concurrency tests remain implementation work. This task performs documentation/link/whitespace and Git review only, with no database reset or remote access.
