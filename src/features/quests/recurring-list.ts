import { isCalendarDate } from "./dates";
import { UUID } from "./create-pending";
import { validateRecurringRequest } from "./recurring-model";

export type RecurringQuest = {
  quest_id: string; title: string; recurrence_mode: "daily" | "weekly" | "monthly";
  recurrence_type: string; paused: boolean; anchor_date: string; end_date: string | null;
  weekdays: number[] | null; month_day: number | null; occurrence_limit: number | null;
  default_reward_exp: number | null; materialized_occurrence_count: number | string; last_slot_date: string | null;
};
export function parseRecurringQuests(input: unknown): RecurringQuest[] | null {
  if (!Array.isArray(input)) return null;
  const ids = new Set<string>();
  const keys = ["quest_id", "title", "recurrence_mode", "recurrence_type", "paused", "anchor_date", "end_date", "weekdays", "month_day", "occurrence_limit", "default_reward_exp", "materialized_occurrence_count", "last_slot_date"];
  for (const row of input) {
    if (!row || typeof row !== "object" || Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)) ||
        typeof row.quest_id !== "string" || !UUID.test(row.quest_id) || ids.has(row.quest_id) || typeof row.paused !== "boolean" ||
        row.recurrence_type !== (row.recurrence_mode === "weekly" ? "selected_weekdays" : row.recurrence_mode) ||
        (row.occurrence_limit !== null && (!Number.isInteger(row.occurrence_limit) || row.occurrence_limit < 1 || row.occurrence_limit > 2147483647)) ||
        !/^(0|[1-9]\d*)$/.test(String(row.materialized_occurrence_count)) ||
        !["string", "number"].includes(typeof row.materialized_occurrence_count) ||
        (typeof row.materialized_occurrence_count === "number" && !Number.isSafeInteger(row.materialized_occurrence_count)) ||
        (row.last_slot_date !== null && !isCalendarDate(row.last_slot_date)) ||
        (row.recurrence_mode !== "weekly" && row.weekdays !== null) || (row.recurrence_mode !== "monthly" && row.month_day !== null) ||
        !validateRecurringRequest({ title: row.title, description: null, importance: "side", priority: null,
          default_reward_exp: row.default_reward_exp === null ? 0 : row.default_reward_exp, recurrence_mode: row.recurrence_mode,
          start_date: row.anchor_date, end_date: row.end_date,
          ...(row.recurrence_mode === "weekly" ? { weekdays: row.weekdays } : {}),
          ...(row.recurrence_mode === "monthly" ? { month_day: row.month_day } : {}) })) return null;
    ids.add(row.quest_id);
  }
  return input;
}
