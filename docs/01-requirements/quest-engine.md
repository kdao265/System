# Quest Engine — V1 requirements

Status: V1 product decisions resolved by the Human Product Owner. This document specifies behavior, not implemented functionality.

Owner: Human Product Owner. Date: 2026-09-17. Related issue: not supplied.

Sources: [project context](../PROJECT_CONTEXT.md), [vision](../00-product/vision.md), [V1 scope](../00-product/scope-v1.md), [requirements format](README.md), and [ADRs 001–011](../02-architecture/decisions.md).

Normative requirements incorporate the twelve product resolutions, DQ-01–04 and SQ-01–04. See the [Quest domain model](../02-architecture/quest-domain-model.md) and [physical schema](../02-architecture/quest-database-schema.md). This document defines behavior and dependency contracts, not application code or SQL.

## 1. Purpose

The Quest Engine manages concrete actions the user intends to complete, from planning through completion, failure or cancellation. It provides reliable history and exactly-once EXP rewards while allowing recovery, justified waivers and changed plans. It is a central part of SYSTEM V1, a personal gamified Life OS.

## 2. Scope

V1 covers quest creation and editing, scheduling, lifecycle transitions, completion, missed-deadline handling, reasons and resolutions, recurring definitions and occurrences, EXP reward attribution, and history. It supports optional metadata and relationships needed by other systems.

Player/EXP, Goals/Projects, Calendar, Health/Recovery, Penalty, Criteria/Evidence, Journal, Finance and Achievement own their respective policies. This specification defines only the Quest-facing boundaries. Supabase remains the application's source of truth, with domain rules outside UI components and external services behind integration boundaries.

## 3. Terminology

| Term | Meaning |
| --- | --- |
| Quest / Quest Definition | Logical actionable task with reusable/default configuration; executable behavior belongs to its occurrences |
| Goal | An outcome, such as IELTS 6.5+ |
| Project | A structured body of work, such as Prepare for IELTS |
| Example Quest | Complete one Reading practice test, contributing toward that Project and Goal |
| Activity | A real event, activity or project participated in; not interchangeable with a Quest |
| Criterion | A formal or personal requirement that may be satisfied |
| Evidence | Proof used to verify criterion satisfaction |
| Calendar Event | A calendar representation of an event or time allocation, distinct from a Quest |
| Recurring definition/template | The reusable intent and schedule used to identify individual occurrences |
| Occurrence | One executable instance with fixed execution configuration, status and history; a one-off Quest also has one occurrence |
| Completion Event | A distinct stable identifier for one accepted transition of an occurrence into completed; a completed QuestEvent, not a request identifier |
| Missed deadline / overdue | A time condition on an unfinished Quest, not a persistent lifecycle state or automatic punishment |
| Failure reason | Context explaining why work was missed or not completed; separate from lifecycle and penalty outcome |
| Reward entitlement | One credit per accepted Completion Event and reward reason/type; an occurrence has at most one unreversed completion entitlement at any moment |
| Reschedule / defer | An event changing the plan; neither is a separate persistent state |

Quest != Activity != Criterion != Evidence. A Quest can contribute to these concepts without becoming them. One Activity may satisfy multiple Criteria, but formal verification belongs elsewhere.

In user stories and lifecycle examples, “create/complete a Quest” is shorthand for creating its definition and executable occurrence, or completing that occurrence. A one-off definition has one occurrence; a recurring definition has independently materialized occurrences. Execution status never belongs to the definition.

## 4. User Stories

| ID | As the user, I want to… | So that… |
| --- | --- | --- |
| US-01 | Create and edit a Quest | I can capture an actionable commitment |
| US-02 | Schedule a start and/or deadline | I can plan work against time |
| US-03 | Complete a Quest | Its outcome and completion time are recorded |
| US-04 | Receive the assigned EXP | Completed work contributes to Player progression |
| US-05 | Retry completion without duplicate rewards | Double-clicks and network retries cannot inflate EXP |
| US-06 | See a missed Quest after returning to the app | Deadlines remain meaningful while the app is closed |
| US-07 | Explain a missed or failed Quest | Overload, emergencies and deliberate skips are distinguishable |
| US-08 | Reschedule or defer unfinished work | I can adapt plans without erasing their history |
| US-09 | Use recurring Quests | Each period has its own actionable occurrence |
| US-10 | Link a Quest to one Project or directly to one Goal | Work can contribute through one unambiguous parent relationship |
| US-11 | Record duration, energy cost and focus demand | Workload estimates can account for planned effort |
| US-12 | Optionally associate a Penalty Rule | Agreed consequences can be considered with justified waivers |
| US-13 | View completed Quest history | I can review completed work and its EXP attribution |
| US-14 | Explicitly correct or reopen an outcome | Mistakes can be fixed while preserving history and reversing undone completion EXP |

## 5. Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-01 | Create, inspect and edit owned Quests with the data and validation in section 7 |
| FR-02 | Support independent importance and recurrence dimensions, defaulting to side and one_off |
| FR-03 | Schedule, activate, reschedule and defer Quests according to the state model; preserve earlier plans in history |
| FR-04 | Enforce allowed lifecycle transitions and reject invalid or stale conflicting actions without partial effects |
| FR-05 | Complete each eligible occurrence idempotently, create one stable Completion Event per accepted transition, record completion time, and grant that event's EXP exactly once |
| FR-06 | Recognize missed deadlines independently of whether the app was open, without automatic punitive failure |
| FR-07 | Record failure context and an explicit resolution; keep penalty assessment separate from Quest status |
| FR-08 | Support daily, weekly, monthly and bounded custom recurrence with independent, historically preserved occurrences |
| FR-09 | Provide applicable completion contributions to related systems without duplicating their effects on retries |
| FR-10 | Expose duration, energy and focus metadata to Health as estimates, with absent values distinguishable from zero |
| FR-11 | Retain an assigned Penalty Rule version/snapshot and preserve decisions, waivers and non-recursive penalty constraints |
| FR-12 | Keep calendar linking/conversion intentional and Goal/Project contribution policies outside Quest lifecycle rules |
| FR-13 | Keep completion distinct from Activity participation and formal Criterion/Evidence verification |
| FR-14 | Preserve attributable lifecycle, scheduling, reward and integration history; show completed Quests in history |
| FR-15 | Restrict access and actions to authorized application users; do not bypass Supabase RLS or trust client claims of earned rewards |
| FR-16 | Allow explicit audited corrections/reopening; reverse undone completion EXP with an idempotent compensating record, and archive Quests with meaningful history instead of hard-deleting them |
| FR-17 | Fix execution-critical values at occurrence materialization; definition edits affect only not-yet-materialized occurrences, with explicit audited occurrence-specific changes permitted |
| FR-18 | Separate stop from archive: stop preserves instances; archive stops generation and cancels only clean eligible draft/scheduled work, blocking on all other unfinished work until explicit resolution under section 18 |

## 6. Quest Types

Importance and recurrence are separate dimensions, not mutually exclusive Quest types.

| Dimension | Values | Default |
| --- | --- | --- |
| importance | main, side | side |
| recurrence | one_off, daily, weekly, monthly, custom | one_off |

Main identifies a principal commitment; Side identifies a supporting or optional commitment. Either can recur. Daily/Weekly/Recurring describe cadence, so a Main Quest can also be daily. Recurrence details are in section 11. Neither dimension imposes a penalty or an automatic EXP formula. No separate database tables or hierarchy are implied.

## 7. Quest Data Requirements

Names describe information, not required database column names. Optional means absence is permitted, not that the field may be silently invented. Definition fields provide defaults; occurrence fields own execution status, schedule, deadline, completion times and failure details. Definitions never have execution/completion status.

| Information | Requirement / validation |
| --- | --- |
| Stable identity and ownership | Required; an occurrence must be independently identifiable |
| Title | Required, nonblank actionable label; maximum 120 characters |
| Description | Optional supporting detail; maximum 4000 characters |
| Importance / recurrence | Independent dimensions from section 6; default side + one_off |
| Status | Required; initially draft unless a valid scheduling/activation action is explicitly requested |
| Priority | Optional; when supplied, low, medium, high or critical; no inferred default |
| Difficulty | Optional; when supplied, integer 1–5; no automatic EXP formula |
| Planned start time | Optional; temporal context must be unambiguous |
| Deadline | Optional; if both times exist, deadline must not precede planned start |
| Estimated duration | Nullable; null means unknown. If supplied, positive integer minutes greater than zero; UI may offer 5-minute increments, but valid values need not be multiples of five |
| User-reported completion time | May be backdated; conceptually distinct from authoritative recording time; preserve its user-reported provenance |
| Authoritative processing/recording time | System-recorded time of accepted completion; cannot be overwritten by a user-reported time |
| EXP reward | Nonnegative integer explicitly assigned by creator/system before completion, including zero; no implicit late reduction |
| Estimated energy cost | Optional integer 1–5; absence is unknown, not zero |
| Focus demand | Optional integer 1–5; absence is unknown, not zero |
| Recurrence information | Required for a recurring definition: cadence, parameters and time-zone context; occurrence retains its series and original scheduled-slot identity |
| Parent Goal / Project | Optional: one Project OR directly one Goal; derive a Project's Goal rather than duplicating it on the Quest |
| Tags / categories | Optional organizational labels |
| Penalty Rule | Optional assigned version/snapshot; absence means no Quest-linked penalty rule |
| Notes | Optional user context |
| Lifecycle and audit metadata | Creation/update times, transition history, reason/resolution where applicable, completion/reward reference and relevant integration references |

Reject invalid ranges, out-of-range scales, fractional values for integer fields, zero/negative supplied duration and negative rewards with an actionable explanation. No additional strict text limits are specified. Explicit corrections append audit records rather than replacing historical facts.

At materialization, snapshot or otherwise fix each occurrence's reward_exp, difficulty, estimated_duration_minutes, energy_cost, focus_demand, direct Goal/Project contribution attribution and applicable Penalty Rule version/snapshot, including absent optional values. Scheduling/deadline data is occurrence-owned. Later definition edits affect only future occurrences not yet materialized, never silently changing existing unfinished occurrences. An intentional edit to an existing occurrence is an explicit occurrence-specific change with meaningful audit history. Completed historical reward amounts, parent attribution, penalty snapshots and workload values remain immutable; corrections preserve the original facts.

## 8. Quest State Model

Six persistent occurrence states keep the model small; the Quest Definition has no execution state:

| State | Meaning |
| --- | --- |
| draft | Captured, but not currently scheduled or active; also holds work deferred without a replacement time |
| scheduled | Planned with at least a start or deadline; not explicitly started |
| active | Explicitly started or accepted as current work; a deadline is not required |
| completed | Completion accepted and its one reward entitlement durably established |
| failed | Explicitly resolved as not completed; does not imply a penalty |
| cancelled | Intentionally withdrawn or no longer relevant; does not imply a penalty |

| From | Action / guard | To | Required effect |
| --- | --- | --- | --- |
| draft | Schedule with a valid start and/or deadline | scheduled | Record plan |
| draft, scheduled | Explicitly activate | active | Record activation; preserve applicable deadline |
| draft, scheduled, active | Complete with valid data and resolved reward amount | completed | Apply section 9 consistently |
| draft, scheduled, active | Explicitly mark failed with a reason category | failed | Record reason; assess penalty separately if applicable |
| draft, scheduled, active | Cancel, including no-longer-relevant resolution | cancelled | Record cancellation and supplied context; grant no completion reward |
| draft, scheduled, active | Reschedule to a valid new start and/or deadline | scheduled | Record old/new plan and reason if supplied |
| scheduled, active | Defer without a replacement plan | draft | Clear current start/deadline, retain their history |
| completed | Repeat completion request | completed | Return existing outcome; no new reward or contribution |
| completed, failed, cancelled | Explicit reopen/correction to unfinished work | draft, scheduled or active | Audit prior/new outcome; satisfy target-state guards; reverse completed EXP if undoing completion |

Archiving a definition requires the full eligibility check in section 18, not just absence of active work. Unfinished active, overdue, previously started or otherwise meaningfully executed occurrences require explicit user resolution. A permitted archive stops recurrence and cancels only qualifying clean draft/scheduled work with retained history; it never reverses earned EXP automatically.

Rescheduled is an event resulting in `scheduled`, not a persistent state. Deferring with a new date uses the reschedule transition; deferring without a date uses `draft`. No pause state is introduced. Reaching a start time does not itself assert that the user began work.

Completed, failed and cancelled end ordinary execution but allow explicit audited correction/reopening. Ordinary completion or cancellation requests cannot silently reopen a terminal outcome. A correction may amend recorded information without changing state; a lifecycle correction reopens to a valid unfinished state before an ordinary transition is applied. Undoing completion requires the compensating EXP reversal in section 9. Transitions not listed above are rejected. Nonterminal metadata edits preserve state unless an explicit scheduling action changes it. Archiving is a retention action, not a replacement lifecycle state, and does not erase or undo outcomes.

A deadline passing adds an overdue condition to scheduled/active work; it does not transition state. Completion after that deadline remains allowed while nonterminal. Preserve both reported completion and recording times so late reporting is distinguishable from late work. A waiver changes penalty disposition, not lifecycle state. Conflicting completion/cancellation/failure/correction actions must resolve to one authoritative outcome; a losing stale request must not create effects.

## 9. Completion Rules

**CR-01:** Accept completion only for an authorized, eligible nonterminal Quest or occurrence. Direct completion does not require a ceremonial activation step.

**CR-02:** Every accepted transition into completed creates a distinct stable Completion Event identifier, completed occurrence status, authoritative recording time, user-reported completion time when provided, the immutable reward amount from the occurrence's fixed configuration, and a reward source/history reference. Backdated reports never replace authoritative recording time. These facts must remain consistent after failures/retries. Do not acknowledge success with a lost entitlement or grant EXP without an accepted Completion Event.

**CR-03:** EXP credit idempotency is based on accepted Completion Event ID plus reward reason/type, not on a lifetime occurrence-only key or a client request ID. Five retries of the same completion produce one Completion Event and one credit, including when request IDs differ. Zero EXP still has one recorded outcome. A later legitimate completion after an explicit reopen creates a new Completion Event with its own independently idempotent credit. Stale requests cannot create a new event, reapply an old credit or silently complete reopened work. At any moment an occurrence must have at most one unreversed completion entitlement.

**CR-04:** Player/EXP applies the resolved amount exactly once. A temporary processing failure must be recoverable without a second grant. This is a consistency requirement, not a prescription for database transactions, queues or API design.

Player/EXP contract: `source_type = quest_completion`, `source_id = completion_event_id`, `reason = completion_reward`, `amount = reward_exp_snapshot`. Player owns credit/reversal idempotency; a reversal references the original credit. Quest tables may be migrated before the ledger exists, but production behavior promising atomic Quest completion plus EXP credit, including completed-reopen compensation, must remain disabled until the Player Ledger schema/contract is available and integrated.

**CR-05:** Make accepted completion visible in history and provide a stable completion reference to applicable progress consumers. Downstream failures must remain distinguishable from a failed Quest completion and be recoverable without repeating rewards or contribution effects. Do not falsely claim that a pending downstream update has succeeded.

**CR-06:** Expose accepted completion for a later completion UI/notification. Presentation failure or a replayed notification must not repeat domain completion. Notification channels and visual behavior are outside this specification.

**CR-07:** Explicit undo preserves the original Completion Event and EXP transaction, creates a linked compensating reversal of exactly the granted EXP and records audited correction/reopening before the occurrence becomes executable again. Repeated/concurrent undo must not reverse twice; interrupted correction must recover consistently. A later intentional completion creates a NEW Completion Event and may receive its own once-only credit, while the old credit remains reversed. Reopening and reward processing must preserve the at-most-one-unreversed-entitlement invariant at all times. Expose correction references to downstream consumers for their own reconciliation without erasing history.

## 10. Failure Rules

Missed deadline, failure reason, lifecycle resolution and penalty disposition are separate facts. Passing a deadline does not automatically set `failed`, deduct EXP, or create a financial obligation.

V1 reason values are `procrastinated`, `forgotten`, `overloaded`, `recovery_needed`, `emergency`, `no_longer_relevant` and `other`. A missed deadline is a separate time condition and may coexist with any reason. The user is the final authority for confirming reasons in this personal application and may supply explanatory notes. Health may recommend a waiver; penalty assessment requires explicit determination, not an automatic inference from a reason or missing metadata.

Allowed resolutions for unfinished work are explicit failure, rescheduling, deferral or cancellation. Penalty waiver/no-penalty may accompany a resolution but is not itself a Quest state. For example, overload may lead to failed-with-waiver or rescheduling; no-longer-relevant work may be cancelled. Do not force a single resolution from a reason alone.

When the app returns after a deadline, show the unresolved missed condition based on stored time facts. No penalty is inferred from app inactivity. Late completion follows the same exactly-once reward contract with no implicit EXP reduction. Keep reported completion time separate from late recording. Already failed/cancelled work requires explicit reopening before completion, rather than silent completion by a delayed request.

## 11. Recurring Quest Rules

**RR-01:** Separate a reusable recurring definition from each occurrence. A definition is not itself completed or rewarded. Each occurrence has its own schedule, lifecycle, completion and reward entitlement.

**RR-02:** Support daily, selected weekdays (weekly), monthly, every N days and every N weeks (custom), with N a positive integer. Support an optional end date and optional positive occurrence count. When both are supplied, neither limit may be exceeded. An unrestricted scheduling language is outside V1.

occurrence_limit counts actual materialized instances of the logical Quest, not eligible slots skipped without materialization. Skipped historical slots consume no limit and must not be backfilled into an overdue backlog. Rule edits retain the cumulative count and Quest history: with limit 10 and 3 instances materialized, changing Monday to Saturday permits at most 7 more. Completion, failure, cancellation and reopening do not replenish capacity. Generation ends at the materialized limit, end_date, explicit stop or archive, whichever applies first; changing future recurrence calculation never resets the count.

**RR-03:** The authoritative timezone is the Profile-owned `profile.timezone`, a validated IANA identifier. Creating/enabling recurrence and materializing new instances require a valid value; missing/invalid zones are rejected, never guessed. One-off Quests need no recurrence configuration. `Asia/Ho_Chi_Minh` may be the current owner's initial profile value, never a universal default. Unmaterialized slots use current profile local time; one-off and already-materialized timestamps retain their absolute instants. Profile schema is designed separately. No scheduler or precreation horizon is mandated.

**RR-04:** Completing today's occurrence never completes, rewards or cancels another occurrence. Rescheduling one occurrence retains its identity and original slot relationship, so retries cannot turn it into a new entitlement. Changing the series is a distinct action.

**RR-05:** Existing skipped or missed occurrences remain identifiable in history and use ordinary failure resolution; they are not automatically completed, punished or deleted. The next scheduled occurrence remains independent. Returning after inactivity must not generate a bulk historical backlog of actionable catch-up Quests or cascading penalties solely because recurrence slots were missed; preserve existing history without manufacturing obligations for every unmaterialized past slot.

**RR-06:** Rule/definition changes record the old/new configuration and effective boundary and affect future occurrences not yet materialized. Existing occurrences retain fixed execution values and absolute schedules, even when unfinished. Changing an existing occurrence requires an explicit occurrence-specific edit/reschedule/cancellation with meaningful audit history; it is not automatic propagation of a template edit. Historical completed values remain immutable and original slot identity is preserved.

**RR-07:** Stopping recurrence prevents generation of new future occurrences but keeps the definition available and does not archive it, remove existing materialized occurrences or change completed history. A separate explicit action may cancel pending work. Archiving instead follows section 18, including automatic stopping and cancellation only under the clean-work predicate. For an absent monthly date, use the month's last valid day, retain the intended day for subsequent months and never duplicate slots. Advanced travel, per-series timezone and DST policies are outside V1; the baseline is local profile time.

## 12. Reward Rules

EXP is V1's primary Quest reward. The accepted completion records the resolved amount and its source sufficiently to explain it later. Subsequent edits to Quest/template reward settings do not alter an already granted reward or make another grant possible.

The definition supplies default reward_exp; materialization fixes it for the occurrence. Definition edits cannot change even an unfinished occurrence's reward. Only an explicit occurrence-specific edit may change its executable configuration, preserving prior history. Player/EXP owns append-only credits/reversals. “One reward per occurrence” means one credit per accepted Completion Event/cycle and reason, not one lifetime credit for the occurrence. Old credits and reversals are never deleted.

The creator/system explicitly assigns a nonnegative integer EXP reward. V1 defines no complex automatic formula or implicit late-completion reduction. Future balancing/formulas belong to Player/EXP requirements. An undo reverses the original granted amount through a compensating record, even if the current configured reward has changed. A penalty EXP deduction is a separate attributable effect; neither a deduction nor a reversal rewrites the original credit.

Money and EXP are separate. Quest completion must not invent income, deposit money or trigger a bank transfer. Future reward types may be acknowledged without implementing a general reward marketplace or currency conversion.

## 13. Penalty Integration

Quest may optionally reference a Penalty Rule, such as 10 push-ups, allocating 100,000 VND to a savings/fund bucket, an EXP penalty or a custom penalty. These are examples, not mandatory default rules.

The Quest-facing request supplies Quest/occurrence identity, the assigned rule version/snapshot, user-confirmed failure context, resolution and relevant workload context when available. Penalty owns eligibility, waiver decisions and obligation policy; assessment requires explicit determination and returns an attributable disposition such as pending assessment, no penalty, waived or obligation recorded. Health may recommend a waiver but must not automatically punish. Do not invent a completed assessment when that system is unavailable.

Repeated assessment requests must not create duplicate obligations for the same failure decision. Record assessment/waiver references and reasons in Quest history. Justified failure can be waived, including overload or recovery context.

Penalties must not recursively escalate. If an obligation is represented as an actionable task, its failure must not create another escalating penalty chain. Propagate sufficient origin context to preserve this rule without defining the full Penalty Engine.

Financial penalties in V1 are tracking/accounting obligations only, not automatic bank transfers and not new financial income. Finance owns any corresponding accounting semantics. Retain a version/snapshot of the rule assigned to the Quest. Later source-rule modification or deletion must not retroactively change that Quest's applicable rule or any pending penalty obligation. Preserve past decisions and assess pending work against its retained rule.

The immutable Penalty snapshot envelope contains at minimum `schema_version`, optional `source_rule_id`, and the applicable rule data required to interpret the obligation. An occurrence fixes this envelope at materialization. JSONB is acceptable for the foreign-domain contract; Quest does not normalize the entire Penalty domain or require a live source rule to preserve an obligation.

## 14. Health Integration

Provide occurrence-fixed estimated duration, difficulty, energy cost, focus demand, schedule and lifecycle status to Health. Missing metadata is unknown; historical workload uses preserved occurrence values, not current definition defaults. Quest does not define Health's formula or interpret an estimate as diagnosis.

Health may recommend a waiver using workload/recovery estimates. The user confirms the failure reason; penalty assessment requires explicit determination. Health must not automatically punish, change Quest status or make medical conclusions. Missing metadata means neither assumed overload nor assumed misconduct.

## 15. Calendar Integration

A scheduled Quest may appear in the System Calendar through an explicit relationship. Calendar Event and Quest retain distinct identities. Quest schedule changes must be available to the linked calendar representation without creating another Quest or reward entitlement.

V1 Google Calendar integration is read/import-first. An imported event is not automatically a Quest; linking or conversion must be explicit. Repeating the same conversion must not create unintended duplicates. External event edits/deletions do not inherently complete, fail or cancel a Quest, and deleting an external event must never automatically delete an already-created Quest.

The internal System Calendar remains part of the application model. Supabase remains authoritative application storage. Quest changes do not imply write-back to Google Calendar; two-way synchronization and its conflict policies are future scope.

## 16. Goal / Project Integration

A Quest may belong to one Project OR directly to one Goal, or have no parent. When its Project belongs to a Goal, derive that Goal relationship through the Project rather than duplicating it on the Quest. V1 does not support direct contribution to multiple Goals. Quest provides stable completion/contribution information; the Goal/Project Engine owns calculation. Do not assume identical percentages, counts or weights. Retry delivery must not count a completion twice; correction references allow the owning engine to reconcile prior contributions.

Goal and Project identifiers are UUID-compatible. Nullable UUID references and occurrence attribution snapshots are valid physical representations. When target tables do not yet exist, omit their FKs and add owner-safe restrictive FKs in a later dependency migration; do not invent other domains' schemas. The at-most-one-direct-parent rule still applies, and nonnull associations require domain-level ownership validation.

Archiving a parent preserves Quest identity, completion/reward history and the historical relationship. It must not silently complete, cancel or reward linked work. Archived parents receive no new progress contribution, including delayed delivery after archival; Quest completion and EXP remain independently valid. Preserve the contribution outcome without falsely reporting progress applied to the archived parent.

Nested Quests/subquests may be considered later; no hierarchy or dependency graph is required for V1.

Direct contribution attribution is fixed at occurrence materialization with at most one direct parent. Changing the definition's parent only affects not-yet-materialized occurrences; it cannot retarget existing or completed contributions. Explicit occurrence-specific changes preserve meaningful history, and historical completed attribution remains immutable.

## 17. Criteria / Evidence Integration

Completion may be linked as a contribution to an Activity or Criterion. It does not automatically establish participation, verify Evidence, or satisfy a formal university, scholarship or other Criterion. Criteria/Evidence owns verification and any confirmation that requires proof.

Requirement definitions remain data-driven, never hard-coded into Quest UI logic. Preserve the distinction between estimated progress and verified evidence even when a linked Quest is completed.

Keep downstream integrations loosely coupled: Quest exposes its stable identifier, lifecycle/status, timestamps, completion/failure events and relevant metadata, including correction references where applicable. Activity, Criteria, Evidence, Journal and Achievement reference Quest from their own domain side when needed. Quest completion never automatically means Criterion verified, Evidence approved or Achievement awarded; each owning engine makes its own decisions.

## 18. History / Audit Requirements

History must explain what happened to each Quest/occurrence: creation, meaningful edits, state transitions, earlier and replacement schedules, missed-deadline context, user-confirmed reasons/resolutions, reported completion time and authoritative recording time, reward amount/reference, corrections/reopening and linked reversals, assigned penalty snapshot and assessment/waiver references, and related contribution outcomes when available.

Record event time and actor/source sufficiently to distinguish user actions, automated detection and integration delivery. Preserve recurrence definition changes and occurrence origin. Do not rewrite accepted completion/reward facts when current metadata changes.

Completion history must let the user identify the completed Quest, when it completed, the EXP outcome and any still-pending related update. Repeated requests may have operational diagnostics, but must not create duplicate domain completion entries.

Completed, failed and cancelled lifecycle history must be preserved. Explicit correction/reopen appends an audit record with the prior/new outcome and actor/time; undoing completion appends a compensating EXP record. Never erase reward history. Never hard-delete a Quest with meaningful execution/history, including executed lifecycle outcomes, rewards, penalties or corrections; archive it instead. Unexecuted Quests without meaningful history may be deleted. Archiving does not itself reverse EXP. Avoid secrets in audit records and enforce the same ownership/access boundary as the Quest.

Journal and Achievement reference Quest outcomes from their own domains as needed; this does not automatically create journal entries or grant achievements. They own their behavior and consume stable references rather than recompleting the Quest.

Archive retires the definition and automatically stops recurrence. Automatic cancellation is allowed only for an occurrence in draft/scheduled that has NEVER entered active/execution state and has scheduled_at null or strictly later than the archive decision instant. It must also be free of overdue obligations and other meaningful execution history: these exclusions override the time/status test. Preserve every cancellation record, terminal outcome and Quest Event; never automatically reverse earned EXP.

Before archive succeeds, every other unfinished occurrence requires explicit user resolution: active work, overdue scheduled work, previously active work later deferred/rescheduled, and any other unfinished work with meaningful execution history. Complete, fail or cancel it, or explicitly reschedule where appropriate and re-evaluate eligibility. Rescheduling never erases previous execution; it cannot make previously started work clean. Current status alone cannot prove never-started; consult lifecycle/audit history. Stop alone leaves existing occurrences unchanged. Archival is not deletion.

## 19. Edge Cases

| Case | Expected behavior |
| --- | --- |
| User double-clicks Complete | One accepted completion, one recorded outcome with distinct reported/recording times and exactly one EXP grant |
| Client retries completion | Return the existing result even with a new request identifier; do not repeat rewards or contributions |
| Deadline passes while app is closed | Recognize overdue work on return/reconciliation; preserve state until explicit resolution; no automatic punishment |
| User completes after deadline | Accept eligible completion without implicit EXP reduction; preserve reported and recording times; failed/cancelled work requires explicit audited reopening first |
| Recurring occurrence is skipped | Preserve that occurrence and reason/resolution independently; do not affect later occurrences |
| User changes recurrence rule | Affect only not-yet-materialized occurrences; existing values/schedules remain unless explicitly edited per occurrence with audit history |
| Completed Quest is deleted/cancelled | Reject hard deletion and ordinary cancellation; archive for retention, or explicitly correct/reopen with an audited EXP reversal if undoing completion |
| Parent Goal is archived | Preserve relationship/history with no implicit Quest transition; no new progress contribution to the archived parent |
| Penalty Rule is removed | Retained version/snapshot still governs the assigned Quest and pending obligation; source removal does not alter them |
| EXP reward changes after completion | Retain the original granted amount and reference; repeat completion grants nothing |
| Profile timezone changes | One-off and already-materialized occurrence timestamps remain unchanged; unmaterialized future slots use local profile time without duplication; advanced travel/per-series/DST policy is outside V1 |
| Delayed request or offline-originated replay arrives | Validate against current authoritative lifecycle; return an existing completion outcome or reject a stale conflict without new effects. A reported backdated time is separate from recording time. Full offline capture/sync is future scope |
| Completion races with cancellation/failure | One valid authoritative result; rejected action has no reward or penalty side effects |
| Downstream progress consumer is unavailable | Preserve accepted completion and reward entitlement; expose pending/failed delivery separately and recover without duplication |
| Missing or zero EXP amount | Missing requires resolution before completion; explicit zero records completion once without increasing EXP |
| Monthly date does not exist | Use the last valid day that month and retain the intended day for subsequent months |
| Advanced DST/travel behavior | Outside V1; do not imply per-series timezone or advanced transition support |
| Undo is retried, then Quest is intentionally completed again | Reverse the earlier credit once with linked history; a new intentional completion is credited once; stale earlier requests cannot restore or duplicate the reversed credit |
| Reward amount changed before undo | Reverse the original granted amount, not the current configuration |
| Long period of missed recurrence | Preserve existing occurrences without generating a bulk catch-up backlog or cascading penalties |
| Definition configuration changes before execution | Already-materialized reward, workload, parent and penalty values remain fixed; only unmaterialized occurrences inherit new defaults |
| Archive requested with active, overdue or previously started unfinished work | Reject until explicit resolution; deferred draft/scheduled status does not erase prior execution. Rescheduling only helps if the occurrence then satisfies the full eligibility predicate |
| Archive passes the full unfinished-work check | Stop generation; cancel only clean never-started draft/scheduled work with null/future scheduled_at and no overdue/execution blocker; preserve audit/history and earned EXP |
| Stop recurrence only | Definition remains available, unarchived; materialized occurrences remain unchanged |

## 20. Acceptance Criteria

These criteria test the resolved V1 product behavior without prescribing implementation mechanisms.

| ID | Given / When / Then | Trace |
| --- | --- | --- |
| AC-01 | Given an authorized user, when creating a Quest without explicit importance/recurrence, then it defaults to side + one_off with stable identity and draft state unless explicitly scheduled/activated; main + daily is also valid and blank titles are rejected | FR-01–02, FR-15 |
| AC-02 | Given a draft Quest, when scheduling valid start/deadline data, then it becomes scheduled; a deadline before its start is rejected without changing the saved plan | FR-03 |
| AC-03 | Given an incomplete eligible Quest with 50 EXP, when completion succeeds, then status is completed, authoritative recording time and any user-reported completion time remain distinct, exactly one 50 EXP reward is granted, and completion appears in history | FR-05, FR-14; CR-01–04 |
| AC-04 | Given that same Quest, when double-clicked, concurrently completed or retried with the same or different request identifiers, then all accepted responses refer to the same completion and total granted EXP remains 50 | FR-05; CR-03 |
| AC-05 | Given processing interruption, when completion is recovered/retried, then there is no acknowledged completion with a lost reward entitlement, no grant without accepted completion, and no duplicate grant | FR-05; CR-02–04 |
| AC-06 | Given scheduled work whose deadline passes with the app closed, when it is next evaluated, then it is shown as overdue without automatically failing or creating a penalty | FR-06 |
| AC-07 | Given an overdue nonterminal Quest, when the user completes it, then completion succeeds once without implicit reward reduction; reported completion and recording times distinguish late work from late reporting | FR-05–06 |
| AC-08 | Given unfinished work, when the user confirms overloaded as the reason and explicitly marks it failed, then state/reason are recorded independently of penalty disposition; Health may recommend a waiver but only an explicit assessment determines the disposition | FR-07, FR-11 |
| AC-09 | Given scheduled/active work, when rescheduled, then it becomes scheduled with the new plan and old plan in history; when deferred without a replacement plan, then it becomes draft with prior dates retained only as history | FR-03, FR-14 |
| AC-10 | Given a recurring definition, when one occurrence completes, then only that occurrence is completed/rewarded; reprocessing its scheduled slot creates no second occurrence entitlement | FR-08; RR-01–04 |
| AC-11 | Given a skipped occurrence, when explicitly resolved as failed or cancelled, then its history remains and the next occurrence remains independently actionable | FR-07–08 |
| AC-12 | Given materialized occurrences and future slots, when the rule changes, then only unmaterialized occurrences use the new rule; materialized schedules/values remain unless explicitly edited per occurrence; stopping alone creates no new occurrences and does not archive or remove existing work | FR-08, FR-14, FR-17–18; RR-06–07 |
| AC-13 | Given a completed Quest, when cancellation or ordinary recompletion is requested or reward settings change, then cancellation is rejected, recompletion returns the existing outcome and the original reward remains unchanged | FR-04–05, FR-14 |
| AC-14 | Given a Quest linked to a Project or directly to a Goal, when completion is delivered twice, then the owning engine applies applicable progress once; an archived parent receives no new contribution, while Quest history/status and EXP remain independently valid | FR-09, FR-12 |
| AC-15 | Given workload metadata or its absence, when Health reads it, then fields are estimates and absence means neither overload nor misconduct; Health may recommend a waiver but makes no medical conclusion or automatic punishment | FR-10–11 |
| AC-16 | Given a financial penalty decision, when its obligation is recorded, then it is tracking/accounting only and no bank transfer or invented income occurs; repeated assessment does not duplicate it | FR-11 |
| AC-17 | Given a task originating from a penalty, when that task fails, then no recursively escalating penalty chain is created | FR-11 |
| AC-18 | Given a Google Calendar event, when read/imported without explicit conversion/linking, then no Quest is created; explicit conversion retries do not duplicate a Quest, external deletion does not delete it, and Quest edits do not imply Google write-back | FR-12 |
| AC-19 | Given downstream Activity/Criteria/Evidence/Journal/Achievement consumers, when Quest exposes stable identity, lifecycle, timestamps, events and metadata, then those domains reference it from their own side; completion alone never verifies a Criterion, approves Evidence or awards an Achievement | FR-09, FR-13 |
| AC-20 | Given accepted completion and an unavailable downstream consumer, when contribution delivery is retried, then completion remains visible, delivery status is honest and neither EXP nor the contribution is duplicated | FR-09, FR-14; CR-05 |
| AC-21 | Given a delayed/offline or stale action, when authoritative state conflicts, then the invalid transition is rejected without additional effects; if already completed, completion replay returns the existing outcome | FR-04–05 |
| AC-22 | Given a user without ownership/access, when attempting to read or mutate a Quest or its history/rewards, then access is denied and no state or reward changes | FR-15 |
| AC-23 | Given an explicit zero-EXP Quest, when completed and retried, then one completion/reward outcome is retained and the EXP balance does not increase | FR-05; CR-03 |
| AC-24 | Given field input, when validating, then title lengths of 120 and description lengths of 4000 are accepted and longer values rejected; priority accepts only low/medium/high/critical, supplied difficulty/energy/focus accept integers 1–5; duration accepts null or positive integer minutes including 1 and 7, rejects zero/negative/fractional values, and EXP accepts nonnegative integers but rejects negatives/fractions | FR-01–02 |
| AC-25 | Given completion reported today as having happened yesterday, when accepted, then yesterday remains the user-reported time and today's authoritative recording time remains separately preserved; replay does not change either accepted fact or reward | FR-05, FR-14; CR-02–03 |
| AC-26 | Given occurrence O completed as event C1 for 50 EXP and a definition default later changed to 80, when O is undone/retried, then exactly one -50 reversal links to C1's preserved credit and reopening is audited; legitimate recompletion creates C2 for O's unchanged 50 EXP snapshot, with one independently idempotent credit. C1, its credit and reversal remain; stale retries create no event/credit and O never has more than one unreversed entitlement | FR-05, FR-16–17; CR-03, CR-07 |
| AC-27 | Given failed/cancelled work, when explicitly reopened to a valid unfinished state, then prior outcome and correction actor/time remain in history; no EXP is reversed if no completion credit was granted | FR-04, FR-14, FR-16 |
| AC-28 | Given a Quest with meaningful execution/history, when removal is requested, then hard deletion is prohibited and archiving preserves history without reversing rewards; a Quest without meaningful history may be deleted | FR-14, FR-16 |
| AC-29 | Given an assigned Penalty Rule snapshot and pending obligation, when the source rule changes or is deleted, then the Quest and obligation retain the original applicable rule | FR-11 |
| AC-30 | Given a parent selection, when a Project is linked, then its Goal is derived rather than directly duplicated; a simultaneous direct Goal link or multiple direct Goals is rejected | FR-12 |
| AC-31 | Given valid profile.timezone and a recurring schedule, when configured for daily, selected weekdays, monthly, every 2 days or every 2 weeks, then corresponding local-time slots are supported; no new instance is materialized beyond end_date or after the cumulative materialized count reaches occurrence_limit, and skipped slots consume no count | FR-08; RR-02–03 |
| AC-32 | Given monthly recurrence on day 31, when February is scheduled, then the occurrence uses February 28 or 29 and March still uses day 31; changing profile timezone does not change one-off absolute timestamps or historical instants | FR-08; RR-03, RR-07 |
| AC-33 | Given an extended absence with missed recurrence slots, when the app resumes, then existing history remains and no bulk historical catch-up backlog or cascading penalties are created solely from those missed slots | FR-06–08, FR-11; RR-05 |
| AC-34 | Given failure reason input, when the user confirms procrastinated, forgotten, overloaded, recovery_needed, emergency, no_longer_relevant or other, then that reason is retained; missing Health metadata supplies neither a reason nor an automatic penalty decision | FR-07, FR-10–11 |
| AC-35 | Given a newly materialized occurrence, when definition reward, difficulty, duration, energy, focus, direct parent or penalty configuration changes, then all seven occurrence values remain fixed (including nulls); a newly materialized instance inherits the new defaults. An explicit occurrence-specific edit records meaningful history, and completed historical values remain immutable | FR-17 |
| AC-36 | Given only clean never-started draft/scheduled unfinished work whose scheduled_at is null or strictly future, and no overdue/meaningful-execution blocker, when archive succeeds, then generation stops and qualifying instances are cancelled with records retained; terminal history/events remain and EXP is not reversed | FR-16, FR-18 |
| AC-37 | Given active work, overdue scheduled work, formerly active work deferred to draft/scheduled or other unfinished meaningful execution history, when archive is attempted, then it fails without silent cancellation. After explicit completion/failure/cancellation, or appropriate rescheduling of otherwise clean work, the full guard is re-evaluated; prior activation never disappears | FR-18 |
| AC-38 | Given an eligible occurrence, when Complete is retried five times including concurrent requests with different IDs, then one stable Completion Event and one credit for its event ID plus reward reason exist; only a legitimate new transition after audited reopen may create a new Completion Event | FR-05; CR-02–03 |
| AC-39 | Given missing/invalid profile.timezone, when recurrence is created/enabled or new slots materialized, then the operation is rejected without guessing a zone; one-off creation remains possible without recurrence configuration | FR-08; RR-03 |
| AC-40 | Given a weekly series with limit 10 and three skipped unmaterialized weeks, when future work materializes, then skipped weeks consume zero capacity and create no catch-up backlog; with 3 actual instances then a Monday-to-Saturday edit, at most 7 additional instances can materialize, subject also to end_date/stop/archive | FR-08; RR-02 |
| AC-41 | Given a Completion Event C with fixed reward 50, when the integrated ledger credits it, then source_type is quest_completion, source_id is C, reason is completion_reward and amount is 50; replay grants no extra credit. Before ledger availability, production atomic completion/EXP behavior is disabled even if Quest tables exist | FR-05; CR-04 |
| AC-42 | Given a retained Penalty snapshot without a source_rule_id, when its schema_version and applicable rule data are valid, then it remains interpretable independently of source-rule existence; no Goal/Project FK is created until its target table exists and direct parent exclusivity still holds | FR-11–12 |

## 21. Out of Scope for V1

- Quest parent-child/subquest hierarchies and dependency graphs.
- Full Player leveling, Health estimation, Penalty policy, Finance accounting, Goal progress, Criteria verification, Journal or Achievement specifications.
- Automatic bank transfers, medical diagnosis, recursive punishment or conflating money with EXP.
- Automatic conversion of all external calendar events into Quests.
- A general reward marketplace, monetary rewards created by completion, or EXP-to-money conversion.
- UI layouts, animations, notification channels, API endpoints, database tables/migrations and implementation mechanisms.
- Full offline-first synchronization and unrestricted recurrence scripting.
- Complex automatic EXP balancing/formulas; future policy belongs to Player/EXP.
- Two-way Google Calendar synchronization.
- Advanced travel, per-series timezone and DST policies.
- One Quest directly contributing to multiple Goals.

Explicit audited corrections/reopening and compensating EXP reversals are in V1. Hard deletion of meaningful execution/history is prohibited; use archiving. New major ideas belong in the backlog and require explicit scope decisions.

## 22. Open Questions

There are no remaining blocking Quest V1 product/database design questions. SQ-01–04 are resolved consistently with DQ-01–04 across the domain model and physical schema. Profile, Goal/Project, Penalty and Player schemas remain separately implemented dependencies; production features must honor their documented enablement gates.
