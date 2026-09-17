# Quest Engine — V1 requirements

Status: V1 product decisions resolved by the Human Product Owner. This document specifies behavior, not implemented functionality.

Owner: Human Product Owner. Date: 2026-09-17. Related issue: not supplied.

Sources: [project context](../PROJECT_CONTEXT.md), [vision](../00-product/vision.md), [V1 scope](../00-product/scope-v1.md), [requirements format](README.md), and [ADRs 001–011](../02-architecture/decisions.md).

Normative requirements below incorporate all twelve Product Owner resolutions into the V1 contract. No database layout, API, dependency, or UI implementation is prescribed.

## 1. Purpose

The Quest Engine manages concrete actions the user intends to complete, from planning through completion, failure or cancellation. It provides reliable history and exactly-once EXP rewards while allowing recovery, justified waivers and changed plans. It is a central part of SYSTEM V1, a personal gamified Life OS.

## 2. Scope

V1 covers quest creation and editing, scheduling, lifecycle transitions, completion, missed-deadline handling, reasons and resolutions, recurring definitions and occurrences, EXP reward attribution, and history. It supports optional metadata and relationships needed by other systems.

Player/EXP, Goals/Projects, Calendar, Health/Recovery, Penalty, Criteria/Evidence, Journal, Finance and Achievement own their respective policies. This specification defines only the Quest-facing boundaries. Supabase remains the application's source of truth, with domain rules outside UI components and external services behind integration boundaries.

## 3. Terminology

| Term | Meaning |
| --- | --- |
| Quest | A concrete actionable thing the user intends to complete |
| Goal | An outcome, such as IELTS 6.5+ |
| Project | A structured body of work, such as Prepare for IELTS |
| Example Quest | Complete one Reading practice test, contributing toward that Project and Goal |
| Activity | A real event, activity or project participated in; not interchangeable with a Quest |
| Criterion | A formal or personal requirement that may be satisfied |
| Evidence | Proof used to verify criterion satisfaction |
| Calendar Event | A calendar representation of an event or time allocation, distinct from a Quest |
| Recurring definition/template | The reusable intent and schedule used to identify individual occurrences |
| Occurrence | One independently actionable Quest in a recurring series, with its own status, history and reward entitlement |
| Missed deadline / overdue | A time condition on an unfinished Quest, not a persistent lifecycle state or automatic punishment |
| Failure reason | Context explaining why work was missed or not completed; separate from lifecycle and penalty outcome |
| Reward entitlement | A Quest/occurrence's completion credit; retries never duplicate it, and explicit undo uses a compensating reversal rather than erasing the credit |
| Reschedule / defer | An event changing the plan; neither is a separate persistent state |

Quest != Activity != Criterion != Evidence. A Quest can contribute to these concepts without becoming them. One Activity may satisfy multiple Criteria, but formal verification belongs elsewhere.

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
| FR-05 | Complete each eligible Quest or occurrence idempotently, record completion time, and grant its EXP exactly once |
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

## 6. Quest Types

Importance and recurrence are separate dimensions, not mutually exclusive Quest types.

| Dimension | Values | Default |
| --- | --- | --- |
| importance | main, side | side |
| recurrence | one_off, daily, weekly, monthly, custom | one_off |

Main identifies a principal commitment; Side identifies a supporting or optional commitment. Either can recur. Daily/Weekly/Recurring describe cadence, so a Main Quest can also be daily. Recurrence details are in section 11. Neither dimension imposes a penalty or an automatic EXP formula. No separate database tables or hierarchy are implied.

## 7. Quest Data Requirements

Names describe information, not required database column names. Optional means absence is permitted, not that the field may be silently invented.

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
| Estimated duration | Optional nonnegative integer minutes; UI may offer 5-minute increments without restricting valid stored minutes to multiples of five |
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

Changing editable metadata must not rewrite previous completion or reward facts. Reject invalid ranges, out-of-range scales, fractional values for integer fields and invalid negative duration/rewards with an actionable explanation. No additional strict text limits are specified. Explicit corrections append audit records rather than replacing historical facts.

## 8. Quest State Model

Six persistent states keep the model small:

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

Rescheduled is an event resulting in `scheduled`, not a persistent state. Deferring with a new date uses the reschedule transition; deferring without a date uses `draft`. No pause state is introduced. Reaching a start time does not itself assert that the user began work.

Completed, failed and cancelled end ordinary execution but allow explicit audited correction/reopening. Ordinary completion or cancellation requests cannot silently reopen a terminal outcome. A correction may amend recorded information without changing state; a lifecycle correction reopens to a valid unfinished state before an ordinary transition is applied. Undoing completion requires the compensating EXP reversal in section 9. Transitions not listed above are rejected. Nonterminal metadata edits preserve state unless an explicit scheduling action changes it. Archiving is a retention action, not a replacement lifecycle state, and does not erase or undo outcomes.

A deadline passing adds an overdue condition to scheduled/active work; it does not transition state. Completion after that deadline remains allowed while nonterminal. Preserve both reported completion and recording times so late reporting is distinguishable from late work. A waiver changes penalty disposition, not lifecycle state. Conflicting completion/cancellation/failure/correction actions must resolve to one authoritative outcome; a losing stale request must not create effects.

## 9. Completion Rules

**CR-01:** Accept completion only for an authorized, eligible nonterminal Quest or occurrence. Direct completion does not require a ceremonial activation step.

**CR-02:** A successful completion must consistently establish completed status, authoritative recording time, user-reported completion time when provided, an immutable resolved EXP amount, one completion reward event/transaction reference, and a history entry. Backdated user reports are allowed but never replace authoritative recording time. These facts must not contradict each other after a failure or retry. Do not acknowledge success with a lost reward entitlement or grant EXP without an accepted completion.

**CR-03:** Reward attribution must distinguish the Quest/occurrence and its accepted completion from a request identifier. Repeated, concurrent, double-clicked, retried or replayed requests for that completion must return the recorded result and grant no additional EXP, even with different request identifiers. Zero EXP still has one recorded completion/reward outcome. An explicit reopen is a new audited lifecycle action; replaying an earlier completion after reopening must not reapply its old credit or silently complete the reopened Quest.

**CR-04:** Player/EXP applies the resolved amount exactly once. A temporary processing failure must be recoverable without a second grant. This is a consistency requirement, not a prescription for database transactions, queues or API design.

**CR-05:** Make accepted completion visible in history and provide a stable completion reference to applicable progress consumers. Downstream failures must remain distinguishable from a failed Quest completion and be recoverable without repeating rewards or contribution effects. Do not falsely claim that a pending downstream update has succeeded.

**CR-06:** Expose accepted completion for a later completion UI/notification. Presentation failure or a replayed notification must not repeat domain completion. Notification channels and visual behavior are outside this specification.

**CR-07:** Explicit undo of completion must reverse exactly the previously granted EXP through a linked compensating/reversal record. Preserve the original completion and credit. Repeated or concurrent undo must not reverse twice; a failed/interrupted correction must be recoverable consistently. A later intentional completion after reopening is independently audited and credited once, with the earlier credit remaining reversed; it must not accumulate duplicate net rewards. Expose the correction reference to downstream consumers so they can reconcile their contributions under their own rules, without erasing history.

## 10. Failure Rules

Missed deadline, failure reason, lifecycle resolution and penalty disposition are separate facts. Passing a deadline does not automatically set `failed`, deduct EXP, or create a financial obligation.

V1 reason values are `procrastinated`, `forgotten`, `overloaded`, `recovery_needed`, `emergency`, `no_longer_relevant` and `other`. A missed deadline is a separate time condition and may coexist with any reason. The user is the final authority for confirming reasons in this personal application and may supply explanatory notes. Health may recommend a waiver; penalty assessment requires explicit determination, not an automatic inference from a reason or missing metadata.

Allowed resolutions for unfinished work are explicit failure, rescheduling, deferral or cancellation. Penalty waiver/no-penalty may accompany a resolution but is not itself a Quest state. For example, overload may lead to failed-with-waiver or rescheduling; no-longer-relevant work may be cancelled. Do not force a single resolution from a reason alone.

When the app returns after a deadline, show the unresolved missed condition based on stored time facts. No penalty is inferred from app inactivity. Late completion follows the same exactly-once reward contract with no implicit EXP reduction. Keep reported completion time separate from late recording. Already failed/cancelled work requires explicit reopening before completion, rather than silent completion by a delayed request.

## 11. Recurring Quest Rules

**RR-01:** Separate a reusable recurring definition from each occurrence. A definition is not itself completed or rewarded. Each occurrence has its own schedule, lifecycle, completion and reward entitlement.

**RR-02:** Support daily, selected weekdays (weekly), monthly, every N days and every N weeks (custom), with N a positive integer. Support an optional end date and optional positive occurrence count. When both are supplied, neither limit may be exceeded. An unrestricted scheduling language is outside V1.

**RR-03:** Recurring scheduling uses local time in the user's profile timezone and identifies intended occurrence slots. The current owner's initial/default timezone may be `Asia/Ho_Chi_Minh`; this must not be hard-coded as a universal application timezone. One-off timestamps retain their absolute instants. Repeated generation/loading must not duplicate a slot or its reward entitlement. No generation algorithm or precreation horizon is mandated.

**RR-04:** Completing today's occurrence never completes, rewards or cancels another occurrence. Rescheduling one occurrence retains its identity and original slot relationship, so retries cannot turn it into a new entitlement. Changing the series is a distinct action.

**RR-05:** Existing skipped or missed occurrences remain identifiable in history and use ordinary failure resolution; they are not automatically completed, punished or deleted. The next scheduled occurrence remains independent. Returning after inactivity must not generate a bulk historical backlog of actionable catch-up Quests or cascading penalties solely because recurrence slots were missed; preserve existing history without manufacturing obligations for every unmaterialized past slot.

**RR-06:** Rule changes record the prior rule and effective boundary and affect future occurrences only. Historical and completed occurrences remain unchanged, including past missed work. Future pending occurrences may be adjusted to the new schedule or explicitly cancelled as part of the recorded change; do not treat already-executed work as pending or duplicate an existing slot. Make the affected future work explicit.

**RR-07:** Stopping a series prevents new occurrences. Future pending occurrences may be cancelled explicitly; preserve historical/completed outcomes. For a monthly date absent from a month, use that month's last valid day (for example, day 31 becomes February 28 or 29). Retain the intended day for later months. Never shift historical completions or duplicate a slot's reward. Advanced travel, per-series timezone and DST policies are outside V1; the baseline is local profile time, not a new travel-aware scheduling system.

## 12. Reward Rules

EXP is V1's primary Quest reward. The accepted completion records the resolved amount and its source sufficiently to explain it later. Subsequent edits to Quest/template reward settings do not alter an already granted reward or make another grant possible.

The creator/system explicitly assigns a nonnegative integer EXP reward. V1 defines no complex automatic formula or implicit late-completion reduction. Future balancing/formulas belong to Player/EXP requirements. An undo reverses the original granted amount through a compensating record, even if the current configured reward has changed. A penalty EXP deduction is a separate attributable effect; neither a deduction nor a reversal rewrites the original credit.

Money and EXP are separate. Quest completion must not invent income, deposit money or trigger a bank transfer. Future reward types may be acknowledged without implementing a general reward marketplace or currency conversion.

## 13. Penalty Integration

Quest may optionally reference a Penalty Rule, such as 10 push-ups, allocating 100,000 VND to a savings/fund bucket, an EXP penalty or a custom penalty. These are examples, not mandatory default rules.

The Quest-facing request supplies Quest/occurrence identity, the assigned rule version/snapshot, user-confirmed failure context, resolution and relevant workload context when available. Penalty owns eligibility, waiver decisions and obligation policy; assessment requires explicit determination and returns an attributable disposition such as pending assessment, no penalty, waived or obligation recorded. Health may recommend a waiver but must not automatically punish. Do not invent a completed assessment when that system is unavailable.

Repeated assessment requests must not create duplicate obligations for the same failure decision. Record assessment/waiver references and reasons in Quest history. Justified failure can be waived, including overload or recovery context.

Penalties must not recursively escalate. If an obligation is represented as an actionable task, its failure must not create another escalating penalty chain. Propagate sufficient origin context to preserve this rule without defining the full Penalty Engine.

Financial penalties in V1 are tracking/accounting obligations only, not automatic bank transfers and not new financial income. Finance owns any corresponding accounting semantics. Retain a version/snapshot of the rule assigned to the Quest. Later source-rule modification or deletion must not retroactively change that Quest's applicable rule or any pending penalty obligation. Preserve past decisions and assess pending work against its retained rule.

## 14. Health Integration

Provide estimated duration, energy cost, focus demand, scheduling information and lifecycle status to Health so it can estimate workload. Missing metadata is unknown. Quest does not define Health's formula or interpret an estimate as diagnosis.

Health may recommend a waiver using workload/recovery estimates. The user confirms the failure reason; penalty assessment requires explicit determination. Health must not automatically punish, change Quest status or make medical conclusions. Missing metadata means neither assumed overload nor assumed misconduct.

## 15. Calendar Integration

A scheduled Quest may appear in the System Calendar through an explicit relationship. Calendar Event and Quest retain distinct identities. Quest schedule changes must be available to the linked calendar representation without creating another Quest or reward entitlement.

V1 Google Calendar integration is read/import-first. An imported event is not automatically a Quest; linking or conversion must be explicit. Repeating the same conversion must not create unintended duplicates. External event edits/deletions do not inherently complete, fail or cancel a Quest, and deleting an external event must never automatically delete an already-created Quest.

The internal System Calendar remains part of the application model. Supabase remains authoritative application storage. Quest changes do not imply write-back to Google Calendar; two-way synchronization and its conflict policies are future scope.

## 16. Goal / Project Integration

A Quest may belong to one Project OR directly to one Goal, or have no parent. When its Project belongs to a Goal, derive that Goal relationship through the Project rather than duplicating it on the Quest. V1 does not support direct contribution to multiple Goals. Quest provides stable completion/contribution information; the Goal/Project Engine owns calculation. Do not assume identical percentages, counts or weights. Retry delivery must not count a completion twice; correction references allow the owning engine to reconcile prior contributions.

Archiving a parent preserves Quest identity, completion/reward history and the historical relationship. It must not silently complete, cancel or reward linked work. Archived parents receive no new progress contribution, including delayed delivery after archival; Quest completion and EXP remain independently valid. Preserve the contribution outcome without falsely reporting progress applied to the archived parent.

Nested Quests/subquests may be considered later; no hierarchy or dependency graph is required for V1.

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

## 19. Edge Cases

| Case | Expected behavior |
| --- | --- |
| User double-clicks Complete | One accepted completion, one recorded outcome with distinct reported/recording times and exactly one EXP grant |
| Client retries completion | Return the existing result even with a new request identifier; do not repeat rewards or contributions |
| Deadline passes while app is closed | Recognize overdue work on return/reconciliation; preserve state until explicit resolution; no automatic punishment |
| User completes after deadline | Accept eligible completion without implicit EXP reduction; preserve reported and recording times; failed/cancelled work requires explicit audited reopening first |
| Recurring occurrence is skipped | Preserve that occurrence and reason/resolution independently; do not affect later occurrences |
| User changes recurrence rule | Affect future occurrences only; record the boundary and pending work affected; preserve historical/completed occurrences |
| Completed Quest is deleted/cancelled | Reject hard deletion and ordinary cancellation; archive for retention, or explicitly correct/reopen with an audited EXP reversal if undoing completion |
| Parent Goal is archived | Preserve relationship/history with no implicit Quest transition; no new progress contribution to the archived parent |
| Penalty Rule is removed | Retained version/snapshot still governs the assigned Quest and pending obligation; source removal does not alter them |
| EXP reward changes after completion | Retain the original granted amount and reference; repeat completion grants nothing |
| Profile timezone changes | One-off absolute timestamps and historical instants remain unchanged; future recurrence uses local profile time without duplicating slots; advanced travel/per-series/DST policy is outside V1 |
| Delayed request or offline-originated replay arrives | Validate against current authoritative lifecycle; return an existing completion outcome or reject a stale conflict without new effects. A reported backdated time is separate from recording time. Full offline capture/sync is future scope |
| Completion races with cancellation/failure | One valid authoritative result; rejected action has no reward or penalty side effects |
| Downstream progress consumer is unavailable | Preserve accepted completion and reward entitlement; expose pending/failed delivery separately and recover without duplication |
| Missing or zero EXP amount | Missing requires resolution before completion; explicit zero records completion once without increasing EXP |
| Monthly date does not exist | Use the last valid day that month and retain the intended day for subsequent months |
| Advanced DST/travel behavior | Outside V1; do not imply per-series timezone or advanced transition support |
| Undo is retried, then Quest is intentionally completed again | Reverse the earlier credit once with linked history; a new intentional completion is credited once; stale earlier requests cannot restore or duplicate the reversed credit |
| Reward amount changed before undo | Reverse the original granted amount, not the current configuration |
| Long period of missed recurrence | Preserve existing occurrences without generating a bulk catch-up backlog or cascading penalties |

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
| AC-12 | Given historical/completed occurrences and future pending work, when a series rule changes, then only future occurrences are affected and the boundary is recorded; stopping the series generates no new occurrences and permits explicit cancellation of future pending work while preserving history | FR-08, FR-14; RR-06–07 |
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
| AC-24 | Given field input, when validating, then title lengths of 120 and description lengths of 4000 are accepted and longer values rejected; priority accepts only low/medium/high/critical, supplied difficulty/energy/focus accept integers 1–5, duration accepts nonnegative integer minutes including 7, and EXP accepts nonnegative integers but rejects negatives/fractions | FR-01–02 |
| AC-25 | Given completion reported today as having happened yesterday, when accepted, then yesterday remains the user-reported time and today's authoritative recording time remains separately preserved; replay does not change either accepted fact or reward | FR-05, FR-14; CR-02–03 |
| AC-26 | Given a completed Quest credited 50 EXP whose current reward setting is 80, when explicitly undone and retried, then exactly one linked reversal of 50 EXP is recorded, the original credit/history remain, and reopening is audited; subsequent intentional completion applies its resolved reward once while stale old requests grant nothing | FR-05, FR-16; CR-07 |
| AC-27 | Given failed/cancelled work, when explicitly reopened to a valid unfinished state, then prior outcome and correction actor/time remain in history; no EXP is reversed if no completion credit was granted | FR-04, FR-14, FR-16 |
| AC-28 | Given a Quest with meaningful execution/history, when removal is requested, then hard deletion is prohibited and archiving preserves history without reversing rewards; a Quest without meaningful history may be deleted | FR-14, FR-16 |
| AC-29 | Given an assigned Penalty Rule snapshot and pending obligation, when the source rule changes or is deleted, then the Quest and obligation retain the original applicable rule | FR-11 |
| AC-30 | Given a parent selection, when a Project is linked, then its Goal is derived rather than directly duplicated; a simultaneous direct Goal link or multiple direct Goals is rejected | FR-12 |
| AC-31 | Given a recurring schedule, when configured for daily, selected weekdays, monthly, every 2 days or every 2 weeks, then corresponding local profile-time slots are supported; a supplied end date/count limits generation, and no slots exceed either supplied limit | FR-08; RR-02–03 |
| AC-32 | Given monthly recurrence on day 31, when February is scheduled, then the occurrence uses February 28 or 29 and March still uses day 31; changing profile timezone does not change one-off absolute timestamps or historical instants | FR-08; RR-03, RR-07 |
| AC-33 | Given an extended absence with missed recurrence slots, when the app resumes, then existing history remains and no bulk historical catch-up backlog or cascading penalties are created solely from those missed slots | FR-06–08, FR-11; RR-05 |
| AC-34 | Given failure reason input, when the user confirms procrastinated, forgotten, overloaded, recovery_needed, emergency, no_longer_relevant or other, then that reason is retained; missing Health metadata supplies neither a reason nor an automatic penalty decision | FR-07, FR-10–11 |

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

There are no blocking Quest Engine V1 product questions remaining. The Human Product Owner's twelve resolutions are incorporated into the normative sections and acceptance criteria above. Future-scope items remain outside this V1 contract.
