import { UUID } from "./create-pending";
import { isAbsoluteTimestamp } from "./create-model";
import type { RecurringRequest } from "./recurring-model";

export function validateRecurringReceipt(input: unknown, commandId: string, request: RecurringRequest): input is { replay: boolean } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  const keys = ["command_id", "quest_id", "recurrence_rule_id", "definition_created_event_id", "recurrence_changed_event_id", "recurrence_mode", "recurrence_type", "anchor_date", "end_date", "weekdays", "month_day", "occurrence_limit", "default_reward_exp", "replay"];
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)) &&
    keys.slice(0, 5).every((key) => typeof row[key] === "string" && UUID.test(row[key])) &&
    row.command_id === commandId && row.definition_created_event_id !== row.recurrence_changed_event_id &&
    row.recurrence_mode === request.recurrence_mode &&
    row.recurrence_type === (request.recurrence_mode === "weekly" ? "selected_weekdays" : request.recurrence_mode) &&
    row.anchor_date === request.start_date && row.end_date === request.end_date &&
    JSON.stringify(row.weekdays) === JSON.stringify(request.recurrence_mode === "weekly" ? request.weekdays : null) &&
    row.month_day === (request.recurrence_mode === "monthly" ? request.month_day : null) &&
    row.occurrence_limit === null && row.default_reward_exp === request.default_reward_exp && typeof row.replay === "boolean";
}

export function validatePauseReceipt(input: unknown, commandId: string, questId: string, paused: boolean) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  const keys = ["command_id", "quest_id", "recurrence_rule_id", "recurrence_mode", "paused", "stopped_at", "state_event_id", "replay"];
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)) &&
    row.command_id === commandId && row.quest_id === questId &&
    typeof row.recurrence_rule_id === "string" && UUID.test(row.recurrence_rule_id) &&
    typeof row.recurrence_mode === "string" && ["daily", "weekly", "monthly"].includes(row.recurrence_mode) && row.paused === paused &&
    (paused ? isAbsoluteTimestamp(row.stopped_at) : row.stopped_at === null) &&
    (row.state_event_id === null ? row.replay === false : typeof row.state_event_id === "string" && UUID.test(row.state_event_id)) &&
    typeof row.replay === "boolean";
}
