/**
 * Closed parsers for the Quest-ID series read (get_recurring_quest_detail_v1) and
 * the schedule-defaults command receipt (set_recurring_quest_schedule_defaults_v1).
 * Both are strict boundaries: one unexpected key or value invalidates the whole
 * read, so the UI never renders a series state the backend did not certify.
 * Snapshots mirror system_internal.recurring_rule_snapshot_v1 exactly.
 */
import { isClockTime, validScheduleDefaults, type PlannedEndDayOffset, type ScheduleDefaults } from "./schedule-model";

export type SeriesRecurrenceMode = "daily" | "weekly" | "monthly";
export type SeriesRecurrenceType = "daily" | "selected_weekdays" | "monthly";

/** The certified twelve-key rule snapshot; local clocks are whole-minute "HH:MM". */
export type SeriesRuleSnapshot = {
  recurrence_type: SeriesRecurrenceType;
  interval_count: number | null;
  weekdays: number[] | null;
  month_day: number | null;
  anchor_date: string;
  end_date: string | null;
  occurrence_limit: number | null;
  revision: number;
  stopped_at: string | null;
  local_start_time: string | null;
  local_end_time: string | null;
  planned_end_day_offset: PlannedEndDayOffset | null;
};

export type SeriesDetail = {
  version: 1;
  quest_id: string;
  title: string;
  recurrence_mode: SeriesRecurrenceMode;
  recurrence_rule_id: string;
  rule: SeriesRuleSnapshot;
  paused: boolean;
  materialized_occurrence_count: number;
  timezone: string;
};

export type ScheduleDefaultsReceipt = {
  version: 1;
  command_id: string;
  quest_id: string;
  recurrence_rule_id: string;
  event_id: string;
  before: SeriesRuleSnapshot;
  after: SeriesRuleSnapshot;
  changed: boolean;
  effective_at: string;
  replay: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DETAIL_KEYS = ["version", "quest_id", "title", "recurrence_mode", "recurrence_rule_id", "rule",
  "paused", "materialized_occurrence_count", "timezone"];
const RECEIPT_KEYS = ["version", "command_id", "quest_id", "recurrence_rule_id", "event_id",
  "before", "after", "changed", "effective_at", "replay"];
const RULE_KEYS = ["recurrence_type", "interval_count", "weekdays", "month_day", "anchor_date", "end_date",
  "occurrence_limit", "revision", "stopped_at", "local_start_time", "local_end_time", "planned_end_day_offset"];
const MODES: SeriesRecurrenceMode[] = ["daily", "weekly", "monthly"];
const TYPES: SeriesRecurrenceType[] = ["daily", "selected_weekdays", "monthly"];
/** The creation mapping: cadence and rule type never diverge for certified rows. */
const TYPE_OF_MODE: Record<SeriesRecurrenceMode, SeriesRecurrenceType> = {
  daily: "daily", weekly: "selected_weekdays", monthly: "monthly",
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return parts !== null && calendarDate(parts[1]) && Number.isFinite(Date.parse(value));
}

function count(value: unknown, minimum: number, maximum = 2147483647) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}
/** Parse a recurring_rule_snapshot_v1 object; null on any contract violation. */
export function parseRuleSnapshot(value: unknown): SeriesRuleSnapshot | null {
  if (!record(value) || !exactKeys(value, RULE_KEYS)) return null;
  if (!TYPES.includes(value.recurrence_type as SeriesRecurrenceType)) return null;
  if (value.interval_count !== null && !count(value.interval_count, 1)) return null;
  if (value.recurrence_type === "selected_weekdays") {
    if (!weekdays(value.weekdays)) return null;
  } else if (value.weekdays !== null) return null;
  if (value.recurrence_type === "monthly") {
    if (!count(value.month_day, 1, 31)) return null;
  } else if (value.month_day !== null) return null;
  if (!calendarDate(value.anchor_date)) return null;
  if (value.end_date !== null && !calendarDate(value.end_date)) return null;
  if (value.occurrence_limit !== null && !count(value.occurrence_limit, 1)) return null;
  if (!count(value.revision, 1)) return null;
  if (value.stopped_at !== null && !timestamp(value.stopped_at)) return null;
  if (value.local_start_time !== null && !isClockTime(value.local_start_time)) return null;
  if (value.local_end_time !== null && !isClockTime(value.local_end_time)) return null;
  if (![0, 1, null].includes(value.planned_end_day_offset as PlannedEndDayOffset | null)) return null;
  // An untimed rule is all-null; a timed rule is the complete, ordered tuple.
  if (!validScheduleDefaults(value.local_start_time, value.local_end_time, value.planned_end_day_offset)) return null;
  return value as unknown as SeriesRuleSnapshot;
}

/** Quest-ID series read; requires the requested quest_id and a self-consistent row. */
export function parseSeriesDetail(data: unknown, questId: string): SeriesDetail | null {
  if (!record(data) || !exactKeys(data, DETAIL_KEYS)) return null;
  if (data.version !== 1 || typeof data.quest_id !== "string" || data.quest_id !== questId || !UUID.test(data.quest_id)) return null;
  if (typeof data.recurrence_rule_id !== "string" || !UUID.test(data.recurrence_rule_id)) return null;
  if (typeof data.title !== "string" || data.title.trim().length === 0 || [...data.title].length > 120) return null;
  const mode = data.recurrence_mode as SeriesRecurrenceMode;
  if (!MODES.includes(mode)) return null;
  const rule = parseRuleSnapshot(data.rule);
  if (!rule || rule.recurrence_type !== TYPE_OF_MODE[mode]) return null;
  // paused is defined as stopped_at IS NOT NULL; a divergence is a broken read.
  if (typeof data.paused !== "boolean" || data.paused !== (rule.stopped_at !== null)) return null;
  if (!count(data.materialized_occurrence_count, 0)) return null;
  if (typeof data.timezone !== "string" || data.timezone.trim() === "") return null;
  return data as unknown as SeriesDetail;
}

function sameRule(a: SeriesRuleSnapshot, b: SeriesRuleSnapshot) {
  return RULE_KEYS.every((key) => JSON.stringify(a[key as keyof SeriesRuleSnapshot] ?? null)
    === JSON.stringify(b[key as keyof SeriesRuleSnapshot] ?? null));
}

function sameScheduleDefaults(rule: SeriesRuleSnapshot, defaults: ScheduleDefaults) {
  return rule.local_start_time === defaults.local_start_time &&
    rule.local_end_time === defaults.local_end_time &&
    rule.planned_end_day_offset === defaults.planned_end_day_offset;
}

function sameNonScheduleRule(a: SeriesRuleSnapshot, b: SeriesRuleSnapshot) {
  return RULE_KEYS.every((key) => {
    if (
      key === "revision" ||
      key === "local_start_time" ||
      key === "local_end_time" ||
      key === "planned_end_day_offset"
    ) {
      return true;
    }

    return JSON.stringify(a[key as keyof SeriesRuleSnapshot] ?? null) ===
      JSON.stringify(b[key as keyof SeriesRuleSnapshot] ?? null);
  });
}

/**
 * Command receipt for set_recurring_quest_schedule_defaults_v1.
 *
 * A valid receipt proves not only command/Quest identity but the exact request:
 * - before.revision is the revision supplied by the caller;
 * - after carries exactly the requested schedule tuple;
 * - the command changes no unrelated recurrence-rule field;
 * - revision advances exactly once iff the schedule tuple changed.
 */
export function parseScheduleDefaultsReceipt(
  data: unknown,
  commandId: string,
  questId: string,
  expectedRevision: number,
  defaults: ScheduleDefaults,
): ScheduleDefaultsReceipt | null {
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 1 ||
    !validScheduleDefaults(
      defaults.local_start_time,
      defaults.local_end_time,
      defaults.planned_end_day_offset,
    )
  ) {
    return null;
  }

  if (!record(data) || !exactKeys(data, RECEIPT_KEYS)) return null;

  if (
    data.version !== 1 ||
    typeof data.command_id !== "string" ||
    data.command_id !== commandId ||
    !UUID.test(commandId)
  ) {
    return null;
  }

  if (
    typeof data.quest_id !== "string" ||
    data.quest_id !== questId ||
    !UUID.test(questId)
  ) {
    return null;
  }

  if (
    typeof data.recurrence_rule_id !== "string" ||
    !UUID.test(data.recurrence_rule_id)
  ) {
    return null;
  }

  if (typeof data.event_id !== "string" || !UUID.test(data.event_id)) {
    return null;
  }

  if (
    typeof data.changed !== "boolean" ||
    typeof data.replay !== "boolean" ||
    !timestamp(data.effective_at)
  ) {
    return null;
  }

  const before = parseRuleSnapshot(data.before);
  const after = parseRuleSnapshot(data.after);

  if (!before || !after) return null;

  // The receipt must start from the exact optimistic-concurrency revision
  // supplied with this durable command.
  if (before.revision !== expectedRevision) return null;

  // Schedule-defaults is not allowed to mutate cadence, bounds, pause state,
  // or any other non-schedule rule field.
  if (!sameNonScheduleRule(before, after)) return null;

  // The authoritative result must equal the exact requested schedule tuple.
  if (!sameScheduleDefaults(after, defaults)) return null;

  if (data.changed) {
    if (after.revision !== before.revision + 1) return null;

    // Reporting changed=true when the requested tuple already existed would
    // contradict the certified command semantics.
    if (sameScheduleDefaults(before, defaults)) return null;
  } else {
    // A no-op keeps the entire snapshot byte-for-value equivalent and proves
    // that the requested tuple was already authoritative.
    if (!sameRule(before, after)) return null;
    if (!sameScheduleDefaults(before, defaults)) return null;
  }

  return data as unknown as ScheduleDefaultsReceipt;
}

function weekdays(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 7 &&
    value.every((day, index) => count(day, 1, 7) && (index === 0 || day > (value[index - 1] as number)));
}
