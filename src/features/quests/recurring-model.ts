import { isCalendarDate } from "./dates";
import { validateQuestCreationRequest, type QuestCreationRequest } from "./create-model";
import { isClockTime, validScheduleDefaults, type PlannedEndDayOffset } from "./schedule-model";

type RecurringCadence =
  | { recurrence_mode: "daily" }
  | { recurrence_mode: "weekly"; weekdays: number[] }
  | { recurrence_mode: "monthly"; month_day: number };
type RecurringDefinition = Omit<QuestCreationRequest, "scheduled_at" | "deadline_at"> & {
  start_date: string;
  end_date: string | null;
};
/** The frozen v3 contract still replayed by pending version 3 records. */
export type RecurringRequestV3 = RecurringDefinition & RecurringCadence;
/** V4 adds the optional schedule-defaults tuple used by create_recurring_quest_v2. */
export type RecurringRequestV4 = RecurringRequestV3 & {
  local_start_time: string | null;
  local_end_time: string | null;
  planned_end_day_offset: PlannedEndDayOffset | null;
};
export type RecurringRequest = RecurringRequestV3 | RecurringRequestV4;
export type CreationRequest = QuestCreationRequest | RecurringRequest;

export const SCHEDULE_DEFAULT_KEYS = ["local_start_time", "local_end_time", "planned_end_day_offset"] as const;

export function isRecurring(request: CreationRequest): request is RecurringRequest {
  return "recurrence_mode" in request;
}

/** A request carries schedule defaults only when all three keys are present. */
export function isScheduledRecurringRequest(request: RecurringRequest): request is RecurringRequestV4 {
  return SCHEDULE_DEFAULT_KEYS.every((key) => Object.hasOwn(request, key));
}

function definitionKeys(row: Record<string, unknown>, extra: string[]) {
  return ["title", "description", "importance", "priority", "default_reward_exp", "recurrence_mode",
    "start_date", "end_date", ...extra];
}

function validDefinition(row: Record<string, unknown>) {
  if (!validateQuestCreationRequest({ title: row.title, description: row.description, importance: row.importance,
    priority: row.priority, default_reward_exp: row.default_reward_exp, scheduled_at: "2000-01-01T00:00:00.000Z", deadline_at: null }) ||
    !isCalendarDate(row.start_date) || (row.end_date !== null && (!isCalendarDate(row.end_date) || row.end_date < row.start_date))) return false;
  if (row.recurrence_mode === "daily") return true;
  if (row.recurrence_mode === "monthly") return Number.isInteger(row.month_day) && Number(row.month_day) >= 1 && Number(row.month_day) <= 31;
  return row.recurrence_mode === "weekly" && Array.isArray(row.weekdays) && row.weekdays.length > 0 && row.weekdays.length <= 7 &&
    row.weekdays.every((day, index, days) => Number.isInteger(day) && day >= 1 && day <= 7 && (index === 0 || day > days[index - 1]));
}

/** Version 3 request: no schedule keys at all. */
export function validateRecurringRequestV3(input: unknown): input is RecurringRequestV3 {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  const extra = row.recurrence_mode === "weekly" ? ["weekdays"] : row.recurrence_mode === "monthly" ? ["month_day"] : [];
  const keys = definitionKeys(row, extra);
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return false;
  return validDefinition(row);
}

/** Version 4 request: every v3 key plus the closed three-key tuple. */
export function validateRecurringRequestV4(input: unknown): input is RecurringRequestV4 {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  const extra = row.recurrence_mode === "weekly" ? ["weekdays"] : row.recurrence_mode === "monthly" ? ["month_day"] : [];
  const keys = definitionKeys(row, [...extra, ...SCHEDULE_DEFAULT_KEYS]);
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return false;
  // The v3 shape is validated on exactly the definition keys; schedule keys are
  // the closed v4 addition and would otherwise break its exact-key boundary.
  const definition: Record<string, unknown> = {};
  for (const key of definitionKeys(row, extra)) definition[key] = row[key];
  if (!validateRecurringRequestV3(definition)) return false;
  if (row.local_start_time !== null && !isClockTime(row.local_start_time)) return false;
  if (row.local_end_time !== null && !isClockTime(row.local_end_time)) return false;
  return validScheduleDefaults(row.local_start_time, row.local_end_time, row.planned_end_day_offset);
}

/** Accepts the frozen v3 shape and the v4 shape; recovery keeps both. */
export function validateRecurringRequest(input: unknown): input is RecurringRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  return SCHEDULE_DEFAULT_KEYS.some((key) => Object.hasOwn(row, key))
    ? validateRecurringRequestV4(input)
    : validateRecurringRequestV3(input);
}

export function validateCreationRequest(input: unknown): input is CreationRequest {
  return validateQuestCreationRequest(input) || validateRecurringRequest(input);
}

export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function cadenceLabel(row: { recurrence_mode: string; weekdays: number[] | null; month_day: number | null }) {
  if (row.recurrence_mode === "daily") return "Daily";
  if (row.recurrence_mode === "weekly") return `Weekly · ${row.weekdays?.map((day) => weekdays[day - 1].slice(0, 3)).join(", ")}`;
  return `Monthly · day ${row.month_day}`;
}
