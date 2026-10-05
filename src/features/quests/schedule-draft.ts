/**
 * Editable schedule-defaults draft state.
 *
 * An editable draft OWNS the rule revision it was loaded from. Every submission
 * uses that base revision; the newest authoritative detail revision is never
 * substituted at submit time, because that would let older local form values
 * overwrite a newer revision and defeat optimistic concurrency.
 *
 * When authoritative detail refreshes:
 * - a PRISTINE draft synchronizes its values and base revision (no conflict);
 * - a DIRTY draft whose base revision no longer matches is preserved verbatim and
 *   marked conflicted, so Save stays disabled until an explicit reload.
 *
 * Pure and serializable: no React, no storage, no network.
 */

export type ScheduleValues = { start: string; end: string; nextDay: boolean };

export type ScheduleDraft = {
  values: ScheduleValues;
  /** The authoritative rule revision these values were loaded from. */
  baseRevision: number;
  /** True once the user edited a field; pristine drafts may be synchronized. */
  dirty: boolean;
  /** True when authoritative detail moved past baseRevision under a dirty draft. */
  conflicted: boolean;
};

/** The minimal authoritative rule shape this module reads. */
export type ScheduleRuleView = {
  revision: number;
  local_start_time: string | null;
  local_end_time: string | null;
  planned_end_day_offset: 0 | 1 | null;
};

export function scheduleValuesFromRule(rule: ScheduleRuleView): ScheduleValues {
  return {
    start: rule.local_start_time ?? "",
    end: rule.local_end_time ?? "",
    nextDay: rule.planned_end_day_offset === 1,
  };
}

export function sameScheduleValues(a: ScheduleValues, b: ScheduleValues): boolean {
  return a.start === b.start && a.end === b.end && a.nextDay === b.nextDay;
}

/** A pristine draft bound to the rule revision it was read from. */
export function beginScheduleDraft(rule: ScheduleRuleView): ScheduleDraft {
  return { values: scheduleValuesFromRule(rule), baseRevision: rule.revision, dirty: false, conflicted: false };
}

/**
 * A user edit never changes baseRevision: the draft keeps proving which revision
 * its values were derived from, which is exactly what the command must expect.
 */
export function editScheduleDraft(draft: ScheduleDraft, patch: Partial<ScheduleValues>): ScheduleDraft {
  return { ...draft, values: { ...draft.values, ...patch }, dirty: true };
}

/**
 * Apply a freshly loaded authoritative rule to an open draft.
 * Returns the identical object when nothing changes, so callers can use this
 * inside effects without causing a render loop.
 */
export function reconcileScheduleDraft(draft: ScheduleDraft, rule: ScheduleRuleView): ScheduleDraft {
  if (rule.revision === draft.baseRevision) return draft;
  // Dirty local values are never silently merged and never silently rebased.
  if (draft.dirty) return draft.conflicted ? draft : { ...draft, conflicted: true };
  return { values: scheduleValuesFromRule(rule), baseRevision: rule.revision, dirty: false, conflicted: false };
}

/** The explicit Reload latest / Discard local draft action. */
export function reloadScheduleDraft(rule: ScheduleRuleView): ScheduleDraft {
  return beginScheduleDraft(rule);
}

/**
 * A submit that raced a newer authoritative revision (backend stale rejection).
 * The command is settled, not pending: keep the user's local values, freeze
 * baseRevision and surface the conflict. Never retry with the newer revision.
 */
export function markScheduleDraftConflicted(draft: ScheduleDraft): ScheduleDraft {
  return draft.conflicted ? draft : { ...draft, conflicted: true };
}