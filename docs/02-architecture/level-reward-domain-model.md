# Level + real-life rewards — domain model

Status: Approved design, not implemented or migration authorization. See [requirements](../01-requirements/level-rewards.md), [physical design](level-reward-database-schema.md), [Player/EXP](player-exp-database-schema.md) and [Quest domain](quest-domain-model.md). LR-OQ-01 is closed: the initial numerical policy is approved.

## 1. Boundaries and entities

Auth supplies identity; Profile remains personal metadata. Player/EXP supplies the exact signed ledger sum and immutable credit/reversal evidence. Quest retains its completion eligibility, event identity, execution cycles and compensation rules. Progression consumes those facts inside their transaction; it cannot manufacture EXP or approve a Quest completion.

| Entity | Responsibility and mutability |
| --- | --- |
| Level policy and thresholds | Global versioned configuration; drafts editable, published versions immutable |
| Policy assignment | Append-only owner enrollment/reassignment history; latest sequence selects the active published version |
| Level milestone | Immutable first accepted owner/Level reach, with policy and evaluation evidence |
| Reward definition | Owner configuration; editable while locked and active, content frozen after unlock, permanently archivable |
| Reward unlock | Immutable entitlement and configuration snapshot, linked to the qualifying milestone |
| Reward event | Immutable configure/update/archive/redemption receipt and small command audit history |

No players table, mutable EXP balance, persisted current Level or separate mutable highest-Level field is needed. Historical evaluated EXP is evidence, not a current balance cache. Highest Level is the maximum persisted milestone Level.

## 2. Policy evaluation

**ADR-LR-01 — Versioned progression with immutable milestone history. Date: 2026-09-19. Status: Accepted.** Context: EXP reversals and future tuning must not erase earned rewards. Decision and alternatives are below; consequences are additional policy/history storage and coordinated owner serialization in sections 1 and 5. Related requirement: [Level policy](../01-requirements/level-rewards.md#4-level-policy). Product Owner approval is recorded by this design; implementation is a separate task.

Choose versioned cumulative threshold data rather than a hard-coded formula or an editable unversioned list. Evaluation selects the greatest configured Level with threshold at or below authoritative current EXP. Equality qualifies; excess EXP above the last threshold is retained while Level stays capped. Exact integer arithmetic is required; JSON transports EXP and thresholds as decimal strings where JavaScript number precision is insufficient.

Published policies have a contiguous nonnegative integer Level range, strictly increasing nonnegative integer thresholds and a zero threshold at the baseline. The approved initial policy is `level_policy_v1` (version 1). Level 1 starts at 0 cumulative EXP; for integer Level L >= 1, `100 * (L - 1)^2` defines its initial cumulative threshold. Persist explicit thresholds for every Level in the published range. Runtime derives current Level from the assigned policy's persisted thresholds; it must not hard-code this formula, invert it or extrapolate missing rows. Future balancing introduces a new policy version with explicit threshold data. Representative thresholds are Level 2 = 100, Level 5 = 1600, Level 10 = 8100 and Level 50 = 240100; see the [requirements examples](../01-requirements/level-rewards.md#4-level-policy). `level_policy_v1` publishes explicit thresholds for Levels 1 through 100 inclusive. Level 100 requires 980100 cumulative EXP and is the highest published Level in V1, not a permanent SYSTEM cap. Future progression may extend the published range through a successor policy version, preserving published-version immutability. Existing top-configured-Level behavior remains unchanged; excess EXP is retained without runtime extrapolation. A successor preserves numbering and existing Levels and may extend the top. Policy publication does not reassign users. An authorized administrative assignment records the policy and recognizes met milestones in the same owner transaction. A harder replacement may lower current Level; an easier replacement may recognize previously unreached Levels. Neither repeats a numbered milestone.

Without assignment, progression is unavailable. Initial enrollment recognizes the then-current EXP, including the baseline; it does not reconstruct peaks before progression existed. Once progression is enabled, an EXP command with missing/invalid assignment fails safely. Enabling progression requires coordinated deployment of every credit/reversal path and assignment of an approved policy; no best-effort fallback silently skips recognition.

## 3. Shared command boundary

All adapters call application services; services validate authenticated context and invoke one controlled database transaction per write. No adapter, including a chatbot, writes tables directly. The service delegates authoritative invariants to database commands/guards so browser bypass cannot evade them.

| Operation | Input and result |
| --- | --- |
| `getProgressionStatus` | Owner context; one consistent read of EXP, assigned policy, current Level and highest milestone |
| `listLevelRewards`, `getRewardHistory` | Owner-scoped filtered reads; never grant or repair history |
| `configureLevelReward` | Stable command ID and validated fields; returns definition/event and any immediate unlock |
| `updateLevelReward` | Definition ID, expected revision and changes; rejects archived/unlocked definitions; returns receipt and any immediate unlock |
| `cancelLevelReward` | Definition ID and expected revision; archives, retaining all history and existing eligibility |
| `redeemLevelReward` | Unlock ID and stable command ID; returns the unique manual redemption receipt |
| Private progression recognition | Validated accepted ledger entry or policy assignment; derives EXP/Levels internally, never accepts caller-supplied grants |
| Administrative policy publication/assignment | Separately authorized configuration operations, unavailable to ordinary user reward callers |

Configure/update/cancel/redemption carry authenticated actor, stable command ID and verified channel (`web_ui`, `web_assistant`, `telegram`, `automation`, `mobile`, `internal`). Expected revision is required for update/cancel. The adapter derives channel from a trusted entry point, not an arbitrary client field; channel is attribution, never authorization. Future automation requires owner-scoped authenticated delegation, whose credential flow is deferred. Store no credentials, prompts or transcripts. A future confirmation layer can bind approval to the canonical command and expected revision; no confirmation mechanism is implemented or assumed here.

## 4. Reward transitions

Active definition without unlock means LOCKED. Creating/editing one to a previously reached Level immediately produces its sole unlock, even when current Level is lower. Multiple definitions at one Level are independent; identical titles alone do not imply duplicate intent.

Unlock records required Level, definition revision, title, optional description, category and optional cost/currency-label pair, plus the milestone and configuration-event references. It freezes the promise. Post-unlock content edits reject; configure a distinct reward to express a new promise. Archive is permitted before or after unlock and does not revoke a historical entitlement. Archived locked definitions never unlock; existing unlocks remain redeemable. Archive has no restore operation in V1.

UNLOCKED becomes REDEEMED through one immutable reward event. This reuses the small history needed for configuration and retry receipts instead of adding another table or mutating grant evidence. Redemption is a manual claim, with authoritative server time; it spends no EXP or money and needs no current-Level recheck. Undo, repeat, hard deletion and automatic revocation are excluded.

## 5. Atomic recognition and lock order

The future integration adds an owner-wide transaction lock before the existing Quest definition then occurrence locks. Their relative order and all existing Quest/EXP validations remain unchanged. The owner lock is shared by every EXP credit/reversal, policy assignment and reward write. Locks on separate Quests alone cannot serialize an owner's aggregate. The [physical design](level-reward-database-schema.md) specifies the lock and fresh-snapshot requirement.

An accepted completion transaction must:

1. Authenticate, obtain the owner lock, then acquire existing Quest locks and validate/replay the original command under its existing rules.
2. For a fresh completion, retain existing event/cycle and snapshot validation; insert the completion event and matching EXP credit before marking the occurrence completed, as Player/EXP requires.
3. Read assigned policy and the exact aggregate including this credit. Insert every missing met Level milestone, not just the final Level or Levels with configured rewards.
4. Unlock all active eligible definitions lacking an unlock, with their accepted configuration snapshots. Complete the occurrence projection in this same transaction.
5. Commit all effects together. Failure anywhere rolls back the completion event, credit, milestones, unlocks and projection.

Recognition may occur between credit insertion and completed projection, so it validates the accepted ledger/event evidence rather than requiring an already-completed projection. Database guards retain the original credit-before-projection ordering.

A compensated reopen obtains the same owner lock before existing Quest locks and keeps correction event, exact linked EXP reversal, reopened event and execution-cycle change atomic. It never deletes milestones or grants. Each accepted EXP-changing command recognizes its resulting state before releasing the owner lock; do not batch unrelated credit/reversal commands into a net change that erases a legitimate committed peak.

Policy assignment uses the same lock, appends its sequence and recognizes all newly met Levels/unlocks atomically. Reward configuration uses the same lock, appends its configuration receipt and immediately unlocks if the milestone already exists. Reads and notification consumers never repair missing history.

## 6. Races, retries and failures

| Case | Required outcome |
| --- | --- |
| Different Quests complete concurrently | Owner serialization makes each aggregate see preceding committed credits; all crossed Levels are recorded |
| Credit followed by racing reversal | Credit's milestones commit before reversal; reversal lowers current Level only |
| Edit races recognition | Edit first uses revised details; unlock first freezes old details and the edit rejects |
| Archive races recognition | Archive first prevents initial unlock; unlock first creates a retained entitlement |
| Two redemptions | At most one event; identical accepted command returns its receipt, a different command receives already-redeemed result referencing the existing receipt |
| Lost response | Matching accepted request returns original facts without re-evaluating today's policy/configuration |
| Reused command ID with changed intent | Conflict; never reinterpret it as another operation |
| Mandatory write fails | Entire transaction rolls back; caller may retry the same intent |
| Unexpected missing atomic history | Integrity failure requiring controlled investigation; no opportunistic historical backfill |

Reward receipts preserve a versioned canonical request (operation, target, fields and expected revision) for equality checks. Resolve an accepted replay before checking the definition's now-changed revision/status. A retry may arrive through another verified adapter; preserve original actor/channel attribution. Current display state can be returned separately from the original receipt. Quest/EXP source uniqueness remains based on accepted event and execution cycle, not a new reward request ID.

Current EXP/current Level/highest Level and lifecycle displays are safe to derive afterward using a consistent read. Milestones and unlocks are mandatory durable effects, not asynchronous projections. Notifications, chatbot replies and other delivery effects may run after commit; delivery retries must not repeat domain commands with new intent IDs.

## 7. Resolved design questions

| # | Decision |
| --- | --- |
| 1 | Current Level is derived from exact current EXP and assigned policy |
| 2 | Highest Level is derived from stored immutable milestone history |
| 3 | Unique first reaches are never deleted/reversed; maximum is monotonic |
| 4 | Immutable published versioned cumulative threshold sets |
| 5 | Storage does not depend on curve values; numbers are configuration |
| 6 | EXP decrease can lower current Level; history survives |
| 7 | Recognize every missing met Level on a jump |
| 8 | Multiple definitions per Level are supported |
| 9 | Definitions and historical unlocks are separate |
| 10 | Snapshot Level, revision, title, description, category and cost pair |
| 11 | Unlocked content cannot be edited in V1 |
| 12 | No historical deletion; archive preserves redemption/history |
| 13 | One lifetime unlock per definition plus source-safe transactions |
| 14 | One immutable redeemed event per unlock |
| 15 | Redemption affects neither EXP nor Finance |
| 16 | Quest completion/event/credit, milestones and unlocks share one transaction |
| 17 | Matching replay returns original receipt; conflicting reuse rejects |
| 18 | Shared configure/update/cancel/redeem services own reward writes |
| 19 | UI and AI use the same authenticated commands; no direct writes |
| 20 | LR-OQ-01 closed: initial curve approved; persist `level_policy_v1` thresholds |

## 8. Implementation gates

This proposal fills the Level boundary previously deferred by Player/EXP; it does not change credit/reversal semantics or claim runtime support. LR-OQ-01 is resolved. Before enablement, publish and assign the explicit thresholds for Levels 1 through 100, implement coordinated commands and ownership enforcement, then verify the [acceptance criteria](../01-requirements/level-rewards.md#13-acceptance-criteria-for-later-implementation), especially cross-Quest concurrency and injected rollback. No additional structural product question blocks this design. Finance integration, adaptive balancing, repeatable rewards, undo, chatbot credentials and confirmation UX remain deferred.
