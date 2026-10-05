import { localTimeToUtc, utcToLocalInput } from "./time";
import { validateQuestCreationRequest, type QuestCreationRequest } from "./create-model";
import { isRecurring, isScheduledRecurringRequest, validateRecurringRequest, type CreationRequest } from "./recurring-model";
import { scheduleDefaultsFromDraft, partialScheduleDefaults } from "./schedule-model";
import type { PendingCreation } from "./create-pending";

export type QuestDraft = {
  recurrence_mode: "one_off" | "daily" | "weekly" | "monthly";
  start_date: string; end_date: string; weekdays: number[]; month_day: string;
  title: string; description: string; scheduled_at: string; deadline_at: string;
  default_reward_exp: string; importance: "main" | "side";
  priority: "" | "low" | "medium" | "high" | "critical";
  // Optional recurring schedule defaults: a whole-minute local pair plus the
  // explicit next-day flag. Never derived from deadline or estimated workload.
  local_start_time: string; local_end_time: string; ends_next_day: boolean;
};
export const emptyDraft: QuestDraft = { recurrence_mode: "one_off", start_date: "", end_date: "", weekdays: [], month_day: "1", title: "", description: "", scheduled_at: "", deadline_at: "", default_reward_exp: "0", importance: "side", priority: "", local_start_time: "", local_end_time: "", ends_next_day: false };
export function draftFromPending(operation: PendingCreation): QuestDraft {
  const request = operation.request;
  if (isRecurring(request)) return { ...emptyDraft, ...request,
    description: request.description ?? "", priority: request.priority ?? "", default_reward_exp: String(request.default_reward_exp),
    end_date: request.end_date ?? "", weekdays: request.recurrence_mode === "weekly" ? [...request.weekdays] : [],
    month_day: request.recurrence_mode === "monthly" ? String(request.month_day) : "1",
    local_start_time: isScheduledRecurringRequest(request) ? request.local_start_time ?? "" : "",
    local_end_time: isScheduledRecurringRequest(request) ? request.local_end_time ?? "" : "",
    ends_next_day: isScheduledRecurringRequest(request) && request.planned_end_day_offset === 1 };
  return {
    ...emptyDraft, ...request, description: request.description ?? "", priority: request.priority ?? "",
    default_reward_exp: String(request.default_reward_exp),
    scheduled_at: request.scheduled_at ? utcToLocalInput(request.scheduled_at, operation.timezone) : "",
    deadline_at: request.deadline_at ? utcToLocalInput(request.deadline_at, operation.timezone) : "",
  };
}
export type CreationDraftErrorCode =
  | "schedule_partial"
  | "schedule_order"
  | "recurring_invalid"
  | "time_ambiguous"
  | "time_nonexistent"
  | "time_invalid"
  | "title_invalid"
  | "description_too_long"
  | "exp_invalid"
  | "one_off_invalid";

export function requestFromDraft(draft: QuestDraft, timezone: string): { request: CreationRequest; error?: never } | { error: CreationDraftErrorCode; request?: never } {
  if (draft.recurrence_mode && draft.recurrence_mode !== "one_off") {
    const defaults = scheduleDefaultsFromDraft(draft.local_start_time, draft.local_end_time, draft.ends_next_day);
    if (!defaults) return { error: partialScheduleDefaults(draft.local_start_time, draft.local_end_time)
      ? "schedule_partial"
      : "schedule_order" };
    const request = { title: draft.title.trim(), description: draft.description.trim() || null,
      importance: draft.importance, priority: draft.priority || null, default_reward_exp: Number(draft.default_reward_exp),
      recurrence_mode: draft.recurrence_mode, start_date: draft.start_date, end_date: draft.end_date || null,
      ...(draft.recurrence_mode === "weekly" ? { weekdays: [...new Set(draft.weekdays)].sort((a, b) => a - b) } : {}),
      ...(draft.recurrence_mode === "monthly" ? { month_day: Number(draft.month_day) } : {}),
      ...defaults };
    return validateRecurringRequest(request) ? { request } : { error: "recurring_invalid" };
  }

  const scheduled = draft.scheduled_at ? localTimeToUtc(draft.scheduled_at, timezone) : { ok: true as const, value: "" };
  const deadline = draft.deadline_at ? localTimeToUtc(draft.deadline_at, timezone) : { ok: true as const, value: "" };
  if (!scheduled.ok || !deadline.ok) {
    const reason = !scheduled.ok ? scheduled.reason : deadline.ok ? "format" : deadline.reason;
    return { error: reason === "ambiguous" ? "time_ambiguous" : reason === "nonexistent" ? "time_nonexistent" : "time_invalid" };
  }
  const request: QuestCreationRequest = {
    title: draft.title.trim(), description: draft.description.trim() || null,
    importance: draft.importance, priority: draft.priority || null,
    default_reward_exp: draft.default_reward_exp.trim() === "" ? 0 : Number(draft.default_reward_exp),
    scheduled_at: scheduled.value || null, deadline_at: deadline.value || null,
  };
  if (!request.title || [...request.title].length > 120) return { error: "title_invalid" };
  if (request.description !== null && [...request.description].length > 4000) return { error: "description_too_long" };
  if (!Number.isInteger(request.default_reward_exp) || request.default_reward_exp < 0 || request.default_reward_exp > 2147483647) return { error: "exp_invalid" };
  return validateQuestCreationRequest(request) ? { request } : { error: "one_off_invalid" };
}
