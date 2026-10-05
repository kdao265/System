/**
 * Recurring schedule defaults V1. This is a client-side mirror of
 * system_internal.valid_recurring_schedule_v1 so the form can refuse a tuple the
 * certified backend would reject, and so recovery records stay replayable
 * byte-for-byte. The backend remains the only authority; this never generates
 * an instant and never derives a duration from deadline or estimated workload.
 */
export type PlannedEndDayOffset = 0 | 1;

/** A whole-minute local clock value, exactly the "HH:MM" the RPCs accept. */
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ScheduleDefaults = {
  local_start_time: string | null;
  local_end_time: string | null;
  planned_end_day_offset: PlannedEndDayOffset | null;
};

export const NO_SCHEDULE_DEFAULTS: ScheduleDefaults = {
  local_start_time: null, local_end_time: null, planned_end_day_offset: null,
};

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && CLOCK_TIME.test(value);
}

/** The tuple is either entirely absent (untimed series) or entirely present. */
export function validScheduleDefaults(start: unknown, end: unknown, offset: unknown): boolean {
  const values = [start, end, offset];
  const absent = values.every((value) => value === null || value === undefined);
  if (absent) return true;
  if (!values.every((value) => value !== null && value !== undefined)) return false;
  if (!isClockTime(start) || !isClockTime(end)) return false;
  if (offset !== 0 && offset !== 1) return false;
  // Same-day needs a strictly later end; next-day accepts an equal clock, which
  // is exactly 24 hours because the end lands on the following local date.
  return offset === 0 ? end > start : end <= start;
}

export function hasScheduleDefaults(defaults: ScheduleDefaults): boolean {
  return defaults.local_start_time !== null;
}

/** Both times are required together; a partial pair is never submittable. */
export function partialScheduleDefaults(start: string, end: string): boolean {
  return (start.trim() !== "") !== (end.trim() !== "");
}

export function scheduleDefaultsFromDraft(start: string, end: string, endsNextDay: boolean): ScheduleDefaults | null {
  if (start === "" && end === "") return { ...NO_SCHEDULE_DEFAULTS };
  if (partialScheduleDefaults(start, end)) return null;
  const offset: PlannedEndDayOffset = endsNextDay ? 1 : 0;
  return validScheduleDefaults(start, end, offset)
    ? { local_start_time: start, local_end_time: end, planned_end_day_offset: offset }
    : null;
}
