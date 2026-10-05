import { UUID } from "./create-pending";
import { isAbsoluteTimestamp } from "./create-model";
import type { RecurringRequest, RecurringRequestV4 } from "./recurring-model";

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

/**
 * create_recurring_quest_v2 returns the frozen v1 receipt fields plus the v2
 * additions. Every key is always present, including explicit nulls for an
 * untimed series, so the response stays a closed boundary.
 */
export const RECURRING_SCHEDULE_RECEIPT_KEYS = [
  "version", "command_id", "quest_id", "recurrence_rule_id", "definition_created_event_id", "recurrence_changed_event_id",
  "recurrence_mode", "recurrence_type", "anchor_date", "end_date", "weekdays", "month_day", "occurrence_limit",
  "default_reward_exp", "revision", "local_start_time", "local_end_time", "planned_end_day_offset", "replay",
] as const;

export function validateRecurringScheduleReceipt(input: unknown, commandId: string, request: RecurringRequestV4): input is { replay: boolean } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  const keys = RECURRING_SCHEDULE_RECEIPT_KEYS;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return false;
  if (row.version !== 2 || row.command_id !== commandId ||
      ["command_id", "quest_id", "recurrence_rule_id", "definition_created_event_id", "recurrence_changed_event_id"]
        .some((key) => typeof row[key] !== "string" || !UUID.test(row[key] as string))) return false;
  if (row.definition_created_event_id === row.recurrence_changed_event_id) return false;
  if (row.recurrence_mode !== request.recurrence_mode || row.revision !== 1) return false;
  if (row.recurrence_type !== (request.recurrence_mode === "weekly" ? "selected_weekdays" : request.recurrence_mode)) return false;
  if (row.anchor_date !== request.start_date || row.end_date !== request.end_date) return false;
  if (JSON.stringify(row.weekdays) !== JSON.stringify(request.recurrence_mode === "weekly" ? request.weekdays : null)) return false;
  if (row.month_day !== (request.recurrence_mode === "monthly" ? request.month_day : null)) return false;
  if (row.occurrence_limit !== null || row.default_reward_exp !== request.default_reward_exp) return false;
  if (row.local_start_time !== request.local_start_time || row.local_end_time !== request.local_end_time) return false;
  if (row.planned_end_day_offset !== request.planned_end_day_offset) return false;
  return typeof row.replay === "boolean";
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
