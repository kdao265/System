# Quest command API V1 — atomic completion and completion-undo

Status: Frozen public API contract for the Quest atomic command layer, resolved from the already-approved Quest, Player/EXP and Level/Reward semantics. Documentation only; no SQL, migration or code. Branch: `docs/quest-atomic-command-api-v1`.

Authority: [Quest requirements](../01-requirements/quest-engine.md), [Quest domain model](quest-domain-model.md), [Quest physical schema](quest-database-schema.md), [Quest event payload V1](quest-event-payload-v1.md), [Player/EXP physical design](player-exp-database-schema.md), [Level/reward domain model](level-reward-domain-model.md) and [operator authorization](operator-authorization-v1.md). This document freezes names, parameters, receipts and replay boundaries only; every behavioral rule remains the authority of the documents above.

## 1. Scope

Exactly two public SQL commands for the atomic Quest integration milestone:

- Completion of one eligible Quest occurrence, producing one accepted `completed` event, one EXP credit, mandatory Level recognition and the completed projection in one transaction.
- Undo of the occurrence's current accepted completion, producing one `completion_corrected` event, one exact EXP reversal, one `reopened` event and the advanced-cycle unfinished projection in one transaction.

Failed/cancelled reopen (no EXP reversal), metadata-only corrections and every other Quest lifecycle command remain separate, out-of-scope operations. No optional feature is added.

## 2. Frozen signatures

```sql
public.complete_quest_occurrence(
    command_id uuid,
    occurrence_id uuid,
    expected_execution_cycle integer,
    reported_completed_at timestamptz,
    origin text
) RETURNS public.quest_completion_receipt

public.reopen_quest_occurrence(
    command_id uuid,
    occurrence_id uuid,
    origin text
) RETURNS public.quest_reopen_receipt
```

Both commands take no parameter defaults. Parameter order follows the existing self-owned command convention (`configure_level_reward(command_id, request, origin)`: command identity first, channel last).

## 3. Input semantics

| Parameter | Frozen rule | Source |
| --- | --- | --- |
| `command_id uuid` | Required nonnull client-supplied stable retry identifier. Never the completed/correction event ID and never an EXP receipt ID. Same command on a different subject or with conflicting intent rejects; it never mints a second effect. | schema §10, §13 |
| `occurrence_id uuid` | Sole subject key. `user_id` is never accepted as input: the owner is always `system_internal.request_user_id()`. `quest_id` is never accepted as input: it is derived from the locked `quest_occurrences` row, which is authoritative. | schema §5, §16; payload §2 |
| `expected_execution_cycle integer` | Completion only. Required positive value that must equal the locked occurrence's current `execution_cycle`; any other value is a stale conflict, and an occurrence already completed at this cycle replays its accepted receipt. Reopen takes no cycle input: the server resolves the occurrence's current completed cycle. | schema §13 |
| `reported_completed_at timestamptz` | Completion only. Nullable user assertion of when the work happened; backdated values are accepted and stored verbatim on the event payload and occurrence projection. Never authoritative: the server records `recorded_completed_at` itself. Null means not supplied. | schema §11, AC-25 |
| `origin text` | Required nonnull verified channel from the existing frozen enum `web_ui`, `web_assistant`, `telegram`, `automation`, `mobile`, `internal`, validated by the existing `progression_internal.require_origin`. Attribution only; it never changes intent and a retry may use a different verified origin. | level model §7; level migration `require_origin` |

The commands must not accept `user_id`, `owner_id`, `quest_definition_id`, `amount`, `source_id`, receipt IDs, event IDs or any EXP field: all are derived from the locked rows and the canonical payload contract.

## 4. Frozen receipt types

```sql
CREATE TYPE public.quest_completion_receipt AS (
    command_id            uuid,
    occurrence_id         uuid,
    quest_id              uuid,
    execution_cycle       integer,
    completed_event_id    uuid,
    exp_entry_id          uuid,
    exp_amount            bigint,
    reported_completed_at timestamptz,
    recorded_completed_at timestamptz,
    replay                boolean
);

CREATE TYPE public.quest_reopen_receipt AS (
    command_id              uuid,
    occurrence_id           uuid,
    quest_id                uuid,
    undone_cycle            integer,
    correction_event_id     uuid,
    reopened_event_id       uuid,
    reversal_entry_id       uuid,
    reversed_amount         bigint,
    original_credit_entry_id uuid,
    replay                  boolean
);
```

Field meanings and nullability:

| Receipt field | Type | Null? | Meaning |
| --- | --- | --- | --- |
| `command_id` | uuid | never | Echo of the resolved command's identity |
| `occurrence_id` / `quest_id` | uuid | never | Derived, authoritative subject and definition |
| `execution_cycle` / `undone_cycle` | integer | never | Accepted completion cycle; undone original cycle |
| `completed_event_id` | uuid | never | Accepted `completed` `quest_events.id`; the EXP `source_id` |
| `exp_entry_id` | uuid | never | Credit `exp_ledger.id` (`payload.exp.ledger_entry_id`) |
| `exp_amount` | bigint | never | Exact accepted credit amount (nonnegative, from the locked snapshot) |
| `reported_completed_at` | timestamptz | allowed | User assertion, verbatim; null when not supplied |
| `recorded_completed_at` | timestamptz | never | Server-authoritative completion recording instant |
| `replay` | boolean | never | True when the receipt is a resolved earlier effect, false for fresh acceptance |
| `correction_event_id` | uuid | never | Accepted `completion_corrected` `quest_events.id` |
| `reopened_event_id` | uuid | never | Accepted `reopened` `quest_events.id` of the incremented cycle |
| `reversal_entry_id` | uuid | never | Reversal `exp_ledger.id` (`payload.exp.reversal_entry_id`) |
| `reversed_amount` | bigint | never | Signed exact compensation; always the negation of the original credit (nonpositive) |
| `original_credit_entry_id` | uuid | never | Original credit `exp_ledger.id` referenced by `reverses_entry_id` |

No field carries mutable current state: no occurrence status, no current EXP, no current Level, no highest Level and no reward-configuration copy. Historical receipts stay valid without re-evaluating today's policy or configuration (level model §6).

## 5. Replay and conflict matrix

| Scenario | Required behavior |
| --- | --- |
| Identical retry: same `command_id`, same subject, same accepted effect | Resolve before minting; return the original accepted receipt with `replay = true`. Never re-append events, credits or projection changes. | 
| Same cycle, different `command_id` | Resolve to the same accepted completed event (`uq_completed_cycle`); return the same historical receipt keyed by the original command, with `replay = true`. No second credit exists to return. |
| Conflicting reuse of a `command_id` | Different subject or conflicting intent under an existing command identity rejects (`23505`) without new writes; reuse never reinterprets intent. |
| Stale `expected_execution_cycle` | Mismatch with the locked occurrence rejects as a stale conflict (`23514`); it never completes the new cycle and never revives a reversed credit. |
| Reopen of not-currently-completed occurrence | Rejects; only the occurrence's current completed cycle may be undone. Failed/cancelled reopen is a separate out-of-scope command. |
| Reopen retry after a later legitimate completion | The original undo is resolved history; a stale conflict rejects rather than undoing the new cycle's completion. |
| Replay lookup order | Authenticate, take the frozen lock order (owner → Quest → occurrence), resolve any accepted command effect, then validate cycle/state before minting (payload §5, §6). |

Receipt comparison on replay covers the original accepted facts only; caller-supplied values (including a different `reported_completed_at` or origin on retry) never alter the stored or returned receipt. Origin is attribution, not intent (payload §6).

## 6. Receipt identity semantics

The completion receipt's accepted facts are exactly the accepted completion's immutable facts: the completed event identity, its credit identity and signed amount, both completion times and the cycle. The undo receipt's accepted facts are exactly the undo's immutable facts: correction event, reopened event, reversal identity, signed reversed amount, original credit reference and undone cycle. Event and ledger IDs in receipts are relational identities, not retry keys; the credit source is `completed_event_id` and the reversal source is `correction_event_id` (payload §6).

## 7. Security and execution boundary

Both commands are `SECURITY DEFINER` with a fixed `search_path = pg_catalog`, owned by `quest_command_owner` (the dedicated non-login, non-superuser, NOBYPASSRLS routine-owner role created by the Quest migration). Migration-time temporary membership grants ownership; it is revoked so no browser role retains it. `EXECUTE` is granted to `authenticated` only, revoked from `PUBLIC`, `anon`, `service_role`, `quest_command_owner`, `progression_command_owner` and `level_policy_assignment_owner` (level migration ACL pattern; schema §16; operator authorization §5). Identity resolution is always `system_internal.request_user_id()`; no caller-supplied identity, receipt ID or target-session state is accepted. Receipt types receive no special grants: any authenticated caller can read a returned composite value.

## 8. Frozen transaction ordering

Both commands run in one PostgreSQL transaction and roll back completely on any failure (schema §17; payload §5; level model §5).

**`complete_quest_occurrence`** must, in order: authenticate; obtain the owner-wide progression lock, then lock the Quest definition and the occurrence `FOR UPDATE`; resolve replay per section 5; validate the occurrence is in `draft`/`scheduled`/`active` with a resolved nonnull `reward_exp_snapshot` and `expected_execution_cycle` equals its current cycle; preallocate the completed-event and credit UUIDs; insert the `completed` event with `payload_version = 1` (canonical EXP envelope, reported/recorded completion times and the occurrence's seven execution snapshots); append the credit with the preallocated receipt via `exp_internal.append_quest_event(event_id)`; obtain mandatory Level recognition via `progression_internal.recognize_after_exp(entry_id, origin)`, whose missing/invalid assignment fails the whole command (level model §2); then update the projection to `completed` with the server `recorded_completed_at`; return the receipt.

**`reopen_quest_occurrence`** must, in order: authenticate; take the same lock order; resolve replay; require the occurrence's current `completed` state and resolve its current-cycle completed event and unreversed credit; preallocate the correction-event and reversal UUIDs; insert the `completion_corrected` event on the old cycle with `related_event_id` targeting the completed event and the canonical undo envelope; append the exact compensation via `exp_internal.append_quest_event(correction_event_id)`; append the `reopened` event on the incremented cycle with `related_event_id` targeting the correction; then clear the completion projection (`recorded_completed_at`/`reported_completed_at`/`failure_reason` null per the occurrence CHECK) and set the occurrence's `execution_cycle` to the incremented value with status `scheduled` when a retained `scheduled_at` or `deadline_at` exists, otherwise `draft`; return the receipt. Reversals perform no Level recognition: the existing EXP helper returns early for `quest_completion_reversal`, milestones and unlocks are never deleted, and current Level derives from the ledger on read (level model §5).

## 9. Frozen decisions review

| Freeze point | Resolution |
| --- | --- |
| Command names | `complete_quest_occurrence`, `reopen_quest_occurrence` |
| Parameter order/names/types | Section 2, exact |
| `quest_definition_id` | Derived from the locked occurrence; never input |
| `user_id`/owner | Always `system_internal.request_user_id()`; never input |
| `expected_execution_cycle` | Required for completion; equal to current cycle; stale rejects; absent from reopen |
| `command_id` | Required stable retry identity; distinct from event/receipt IDs |
| `reported_completed_at` | Nullable verbatim user assertion; never authoritative |
| `origin` | Required; existing frozen channel enum via `require_origin` |
| Return types | `public.quest_completion_receipt`, `public.quest_reopen_receipt`, exact |
| Receipt fields/nullability | Section 4 tables, exact |
| Immutable accepted facts | Sections 4 and 6 |
| Identical retry | Original receipt, `replay = true`, no new effects |
| Same-cycle/different-command replay | Same historical completed event; original receipt |
| Conflicting command reuse | Reject without new writes |
| Completion receipt semantics | Completed event + credit + both completion times + cycle |
| Undo receipt semantics | Correction event, reopened event, reversal identity, signed amount, original credit |
| Signed amounts | `exp_amount` nonnegative; `reversed_amount` exact negation, nonpositive |
| Mutable current state | Never part of a receipt |
| Definer/EXECUTE boundary | Section 7, exact |

No business rule is introduced by this document: every row above restates an already-approved semantic with a frozen API shape.
