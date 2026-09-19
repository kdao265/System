# Level + real-life rewards — V1 requirements

Status: Approved design, not implementation. LR-OQ-01 is closed: the Product Owner has approved the initial numerical Level policy.

Owner: Human Product Owner. Branch: `docs/level-reward-foundation`. Date: 2026-09-19.

Sources: [vision](../00-product/vision.md), [V1 scope](../00-product/scope-v1.md), [Player/EXP requirements](player-exp.md), [Player/EXP design](../02-architecture/player-exp-database-schema.md), [Quest requirements](quest-engine.md), [Quest domain](../02-architecture/quest-domain-model.md), [Quest schema](../02-architecture/quest-database-schema.md), [Auth/Profile ownership](../02-architecture/auth-profile-database-schema.md) and [ADRs](../02-architecture/decisions.md). Companions: [domain model](../02-architecture/level-reward-domain-model.md), [physical design](../02-architecture/level-reward-database-schema.md).

## 1. Purpose and task contract

Recognize progression from authoritative EXP and let users plan, unlock and manually redeem meaningful real-life rewards. SYSTEM records eligibility and the user's claim of redemption; it does not purchase, transfer money, make bookings or verify delivery.

This task produces design documents and small context/architecture references only. No SQL, migration, application/Quest command, dependency, deployment/configuration change or Supabase connection is authorized. No staging, commit or push. Review covers consistency, historical retention, idempotency, concurrency, ownership and shared UI/AI commands, followed by link and Git checks.

## 2. Scope and non-goals

Include deterministic Level evaluation, versioned cumulative thresholds, current/highest Level distinction, first-reached milestones, multiple configurable rewards per Level, immutable unlock snapshots and once-only manual redemption.

Do not introduce a players table, EXP balance cache, new EXP source, currency economy, stats, achievements, skill trees, ranking, adaptive AI balancing, automated purchases, Finance transactions or a chatbot implementation. Reward budgets, repeatable rewards, redemption undo, historical reward revocation, arbitrary milestone repair and a general audit platform are deferred.

## 3. Terminology and Level semantics

| Concept | Authoritative meaning |
| --- | --- |
| Current EXP | Exact net sum of committed owner EXP ledger amounts, unchanged from Player/EXP |
| Current Level | Highest Level whose cumulative threshold is met by current EXP under the owner's assigned published policy; derived, never an independently editable field |
| Highest Level reached | Maximum Level in the owner's immutable accepted milestone history; derived from persisted history, not current EXP or a second mutable high-water field |
| Level milestone | First accepted reach of a numbered Level for an owner; permanent across reversals and policy revisions |
| Reward definition | Owner's configuration of one lifetime reward at a required Level |
| Reward unlock | Permanent entitlement with the definition's details snapshotted at acceptance |
| Redemption | Owner's once-only claim that an unlocked reward was taken; not an automated real-world action |

With no approved/assigned policy, return an explicit progression-unavailable state, not a guessed Level. With no accepted milestone, highest Level is absent, not a fabricated zero. Initial policy assignment atomically recognizes the baseline and other met Levels, so an enrolled user has coherent current and highest values.

Current Level may decrease when EXP decreases. Highest Level cannot decrease because milestone rows cannot be removed or rewritten. No Level field is added to Profile, Quest, EXP entries or a new Player identity table.

## 4. Level policy

Choose **versioned data-driven cumulative threshold sets**. A hard-coded formula is easy initially but ties tuning to code and obscures historical interpretation. An unversioned editable threshold list is flexible but rewrites the explanation for prior unlocks. Immutable published versions add explicit provenance without an elaborate rules engine.

Each version lists contiguous numbered Levels and strictly increasing nonnegative integer cumulative EXP thresholds. The initial policy starts at Level 1 with zero cumulative EXP. Current Level is the largest met threshold; at the top configured Level it stays capped without extrapolation or discarding additional EXP.

The approved initial policy is `level_policy_v1` (version 1). Level 1 starts at 0 cumulative EXP; for integer Level L >= 1, `100 * (L - 1)^2` defines its initial cumulative threshold. Persist explicit thresholds for every Level in the published range. Runtime derives current Level from the assigned policy's persisted thresholds; it must not hard-code this formula, invert it or extrapolate missing rows. Future balancing introduces a new policy version with explicit threshold data.

| Level | Initial cumulative EXP |
| --- | --- |
| 1 | 0 |
| 2 | 100 |
| 3 | 400 |
| 4 | 900 |
| 5 | 1600 |
| 10 | 8100 |
| 20 | 36100 |
| 30 | 84100 |
| 50 | 240100 |
| 100 | 980100 |

These are representative thresholds, not a sparse set of the only supported Levels. `level_policy_v1` publishes explicit thresholds for Levels 1 through 100 inclusive. Level 100 requires 980100 cumulative EXP and is the highest published Level in V1, not a permanent SYSTEM cap. Future progression may extend the published range through a successor policy version, preserving published-version immutability. Existing top-configured-Level behavior remains unchanged; excess EXP is retained without runtime extrapolation.

Published versions cannot be edited/deleted. Draft versions may be prepared through a controlled administrative boundary; normal users/AI cannot lower thresholds or assign themselves an easier policy. Assignment is explicit and recorded per owner; publishing alone changes nobody's policy. Later tuning publishes a new version, retaining existing Level numbering/baseline and existing Levels, optionally extending the top. A controlled reassignment recalculates current Level and recognizes any newly met milestones atomically; prior milestones/unlocks survive even if the new curve is harder. Reaching the same numbered Level under another version does not grant it again.

## 5. Milestone recognition

Persist a first-reached record for every configured Level at or below the accepted current Level that the owner has not previously reached, not merely Levels that already have rewards. Record accepted policy, evaluated EXP, source and authoritative recognition time.

For a gain from Level 4 to 7, recognize 5, 6 and 7 in one transaction. A decline to 4 and later return to 7 produces no duplicate milestones. No inference from a client-reported Level or a page visit can create a milestone.

Initial assignment recognizes thresholds met by the authoritative EXP at enrollment; it does not reconstruct pre-policy historical peaks. Before an approved policy was assigned the progression system had accepted no Level milestones. Once enabled, every EXP mutation must participate in the atomic progression protocol, so a short-lived legitimate peak cannot be lost between a credit and reversal.

## 6. Reward configuration

A definition has owner, stable ID, required Level, title, optional description, category, optional estimated cost/currency label, lifecycle marker, revision and server timestamps. Categories are `treat`, `purchase`, `experience`, `custom`. Title must be nonblank; blank optional description becomes null. No invented product text-length or spending limit is introduced.

Estimated cost is an optional finite nonnegative decimal paired with a nonblank currency/unit label; either both are present or both absent. It is descriptive planning information, never a balance, debit, currency conversion, budget reservation or Finance transaction. No cost is inferred from the category.

Allow multiple distinct definitions at one Level. Required Level must exist in the owner's assigned policy. Configuration requires enrollment; it cannot silently activate a policy. Distinct intentional definitions are independent rewards, even with the same title. Retrying the same create intent must return the original definition.

## 7. Unlock semantics and late configuration

An active definition unlocks once when its required Level has an accepted milestone. One definition has at most one lifetime unlock. Snapshot its required Level, revision, title, description, category and complete estimated-cost pair; retain the qualifying milestone and configuration event references.

**Late configuration is supported:** creating or editing a still-locked active definition to a previously reached Level immediately unlocks it in that same command, even if current Level has since fallen below that Level. The command response must state that this happened. No future EXP gain or read request is needed to catch it up. This is an intentionally configured new reward, not another grant of an existing reward.

Milestone recognition unlocks all matching active definitions. An archived definition never receives its first unlock. Uniqueness, not a frontend flag, prevents repeated grant after retry, regain, a new policy version or a new Quest completion cycle.

## 8. Redemption and lifecycle

Use a separate immutable **redeemed event within the small reward-command history**, rather than mutating the unlock snapshot. A unique redemption target makes claiming once enforceable. The event records server time, authenticated actor and verified entry channel. Replays return the original receipt; a new request ID cannot redeem the same unlock again.

Lifecycle is derived: an active definition with no unlock is LOCKED; a retained unlock with no redemption is UNLOCKED; an unlock with its redemption event is REDEEMED. Archived is a definition-planning state, not revocation of an unlock. Redemption accepts the unlock ID and ownership, never an arbitrary “set status” operation.

Redemption neither writes EXP nor changes Level nor creates a Finance entry. Current Level is not rechecked as an eligibility requirement once unlocked. No backdated redemption time or redemption undo is included in V1.

## 9. Editing, cancellation and retention

Before unlock, the owner may edit fields, including required Level, with expected revision and an immutable before/after command record. Re-evaluate eligibility in the same transaction. An edit to an already reached Level can immediately unlock.

After unlock, freeze reward content/required Level; reject edits with a controlled explanation. An intentional new reward uses a new definition. This simple V1 rule avoids editing promises already earned or maintaining unused future versions of a one-time reward. Unlock snapshots remain useful as durable, self-contained history.

Cancellation archives a definition permanently in V1; do not hard-delete even locked definitions or their command history. Archived locked rewards cannot unlock; archived unlocked/redeemed rewards retain their evidence and can still be read. An unredeemed historical unlock remains redeemable after definition archival. Restore/repeat and retroactive revocation are deferred.

## 10. EXP reversal

Quest's original credit/reversal semantics stay unchanged. A valid reversal can lower current EXP and current Level; it never removes a milestone, lowers highest Level, cancels an unlock or undoes redemption. A legitimate later completion has its own EXP credit but does not regrant previously reached milestones or previously unlocked definitions.

For illustration only: current Level 5 → 4 after reversal leaves highest Level 5 and its rewards intact; returning to 5 creates no second grant. Under the initial policy, a reversal from 1600 to 1500 EXP illustrates this transition: Level 5 starts at 1600 and Level 4 at 900 cumulative EXP.

## 11. Authorization and shared application commands

Auth identity remains authoritative. Resolve owner from authenticated context; do not trust submitted owner IDs, Level, totals, milestone receipts or channel claims. Owner-scoped RLS protects definitions, milestone history, unlocks and reward command history. Browser/assistant clients cannot directly mutate those tables. Policy publication/assignment is a distinct controlled administrative operation, not a user reward command. Assignment specifically requires the authenticated request actor's active `level_policy_assign` capability under the [operator authorization contract](../02-architecture/operator-authorization-v1.md). No default grant, self-promotion or automatic enrollment is allowed; authorized operators may assign another owner only through the controlled command.

Web UI, SYSTEM web assistant, Telegram, n8n and future mobile adapters must call the same application/domain commands with the same authorization, validation, revision and idempotency rules. No React-only calculation or chatbot-specific table-write shortcut is permitted. Any future automation must carry a separately authenticated, owner-scoped authorization; a channel name does not confer power.

Read operations (`getProgressionStatus`, `listLevelRewards`, `getRewardHistory`) do not create milestones or grants. Write commands (`configureLevelReward`, `updateLevelReward`, `cancelLevelReward`, `redeemLevelReward`) perform the controlled mutations. Private progression recognition is invoked only by trusted policy/EXP transactions, never a caller-supplied Level endpoint.

Command envelopes support a stable command ID, expected revision where relevant, authenticated actor and adapter-verified origin (`web_ui`, `web_assistant`, `telegram`, `automation`, `mobile`, `internal`). Preserve only small structured context, not secrets or chat transcripts. A future confirmation layer may authorize the exact canonical write intent and expected revision before execution; implementing that layer or assuming confirmation already exists is outside this task.

## 12. Atomicity, failures and retries

For progression-enabled users, Quest occurrence completion + accepted Quest event + EXP credit + all newly reached milestones + eligible reward unlocks commit in the same database transaction. Projection/event/EXP guards remain intact. If any new mandatory effect fails, the transaction fails; do not acknowledge partial completion. Reversal/reopen retains its atomic EXP compensation and uses the same owner serialization, leaving historical milestones/unlocks untouched.

Current EXP, current Level, highest Level and display statuses can be derived afterward from committed facts. Notifications and chatbot replies can be delivered afterward and may fail without rerunning the command. Durable milestone/unlock recognition may not be deferred to a page load, polling job or notification consumer: a reversal could erase the intervening peak.

Serialize EXP changes, policy assignment and reward configuration/redemption for each owner. Different Quest locks alone do not protect an owner-wide aggregate. After waiting for the owner lock, evaluate against a fresh database snapshot. The domain model specifies the lock/transaction order and race outcomes.

Retries of accepted commands return matching receipts; conflicting reuse rejects. Source uniqueness from Quest/EXP remains unchanged. Database uniqueness separately protects owner/Level milestones, definition unlocks and unlock redemptions. Missing expected atomic history is an integrity error, not permission to repair it using today's configuration or accept a forged source.

## 13. Acceptance criteria for later implementation

| ID | Given / When / Then |
| --- | --- |
| LR-AC-01 | No assigned published policy returns progression unavailable; no numerical Level or threshold is invented |
| LR-AC-02 | Under an approved policy, current Level is deterministically derived from exact current EXP, including equality to a threshold, zero EXP and the configured cap |
| LR-AC-03 | Accepted progress from Level 4 to 7 records first reaches for 5, 6 and 7 and unlocks every eligible active definition once |
| LR-AC-04 | Reversal lowers current Level but preserves highest Level, milestones, unlocks and redemptions; regaining the same Levels creates no duplicates |
| LR-AC-05 | Multiple definitions at one Level receive distinct unlocks; replaying one create command cannot produce another definition |
| LR-AC-06 | A late-created/edited active reward at a reached Level unlocks immediately even if current Level is lower |
| LR-AC-07 | Before unlock, revision-checked edits are audited; after unlock, content edits reject and snapshots remain unchanged |
| LR-AC-08 | Archive before unlock prevents unlocking; archive after unlock retains the grant and allows its once-only redemption |
| LR-AC-09 | Concurrent redemption with same/different command IDs records one redemption; no EXP/Finance changes occur |
| LR-AC-10 | Failure injected at event, credit, milestone or unlock insertion rolls back the complete Quest transaction; lost-response retry returns existing facts |
| LR-AC-11 | Concurrent completions on different Quests and a racing reversal are serialized per owner, so accepted intermediate peaks are recorded and never lost |
| LR-AC-12 | Policy publication alone changes no user; reassignment derives current Level under the new version while preserving historical milestones and unlocks, without duplicate same-Level grants |
| LR-AC-13 | Foreign-owner IDs, forged totals/Levels/channel, direct writes and unscoped automation reject safely without disclosure |
| LR-AC-14 | Web/AI adapters produce identical domain results for identical authorized commands; reads have no mutation side effects |
| LR-AC-15 | Reward edit/archive racing milestone recognition has a single audited order: either the old definition unlocks and freezes, or the edit/archive commits first and governs eligibility |
| LR-AC-16 | Historical policy, EXP evidence, snapshots and command receipts remain readable and immutable; account deletion does not cascade through history |
| LR-AC-17 | Invalid/nonfinite/negative cost or incomplete cost/currency pair rejects; redemption remains manual and nonfinancial |
| LR-AC-18 | Initial assignment records only its accepted current-state milestones, not invented pre-policy peaks; repeated assignment intent is idempotent |

## 14. Product Owner decision and implementation gates

**LR-OQ-01 - CLOSED: initial numerical progression curve approved.** The Product Owner selected Level 1 at zero EXP and `100 * (L - 1)^2` to define the initial `level_policy_v1` threshold set. Section 4 records the approved examples and persisted-data requirement. The curve and initial published range of Levels 1 through 100 are resolved; no Level/Reward design or migration-preparation decision remains open.

No numerical-curve design blocker remains. Production Level recognition/unlocks must remain disabled until the explicit threshold set is published and assigned and integrated transaction/RLS tests pass. The approved Level/Reward semantics remain unchanged. Future balancing values are later policy versions, not additional V1 schema blockers.
