import { isCalendarDate } from "./dates";
import { validateQuestCreationRequest, type QuestCreationRequest } from "./create-model";

export type RecurringRequest = Omit<QuestCreationRequest, "scheduled_at" | "deadline_at"> & {
  start_date: string;
  end_date: string | null;
} & ({ recurrence_mode: "daily" } | { recurrence_mode: "weekly"; weekdays: number[] } | { recurrence_mode: "monthly"; month_day: number });
export type CreationRequest = QuestCreationRequest | RecurringRequest;

export function isRecurring(request: CreationRequest): request is RecurringRequest {
  return "recurrence_mode" in request;
}

export function validateRecurringRequest(input: unknown): input is RecurringRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  const keys = ["title", "description", "importance", "priority", "default_reward_exp", "recurrence_mode", "start_date", "end_date",
    ...(row.recurrence_mode === "weekly" ? ["weekdays"] : row.recurrence_mode === "monthly" ? ["month_day"] : [])];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return false;
  if (!validateQuestCreationRequest({ title: row.title, description: row.description, importance: row.importance,
    priority: row.priority, default_reward_exp: row.default_reward_exp, scheduled_at: "2000-01-01T00:00:00.000Z", deadline_at: null }) ||
    !isCalendarDate(row.start_date) || (row.end_date !== null && (!isCalendarDate(row.end_date) || row.end_date < row.start_date))) return false;
  if (row.recurrence_mode === "daily") return true;
  if (row.recurrence_mode === "monthly") return Number.isInteger(row.month_day) && Number(row.month_day) >= 1 && Number(row.month_day) <= 31;
  return row.recurrence_mode === "weekly" && Array.isArray(row.weekdays) && row.weekdays.length > 0 && row.weekdays.length <= 7 &&
    row.weekdays.every((day, index, days) => Number.isInteger(day) && day >= 1 && day <= 7 && (index === 0 || day > days[index - 1]));
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
