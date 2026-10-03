import { UUID } from "./create-pending";
import { isAbsoluteTimestamp } from "./create-model";
import { parseRecurringQuests, type RecurringQuest } from "./recurring-list";
import type { QuestManagementOperation } from "./management-action";

export const RECURRING_RETIREMENT_PREFIX = "system.recurring-retirement.pending.v1:";
export const RECURRING_RETIREMENT_LOCK = "system.recurring-retirement";
export type RecurringRetirementReceipt = {
  version: 1; command_id: string; quest_id: string; operation: QuestManagementOperation;
  archived_at: string | null; deleted_at: string | null; event_id: string; changed: boolean; replay: boolean;
};
export function validateRecurringRetirementReceipt(value: unknown, commandId: string, questId: string, operation: QuestManagementOperation): value is RecurringRetirementReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const keys = ["version", "command_id", "quest_id", "operation", "archived_at", "deleted_at", "event_id", "changed", "replay"];
  return Object.keys(r).length === keys.length && keys.every((key) => Object.hasOwn(r, key)) &&
    r.version === 1 && r.command_id === commandId && UUID.test(commandId) && r.quest_id === questId && UUID.test(questId) &&
    r.operation === operation && typeof r.event_id === "string" && UUID.test(r.event_id) &&
    typeof r.changed === "boolean" && typeof r.replay === "boolean" &&
    (operation === "restore" ? r.archived_at === null : typeof r.archived_at === "string" && isAbsoluteTimestamp(r.archived_at)) &&
    (operation === "delete" ? r.changed === true && typeof r.deleted_at === "string" && isAbsoluteTimestamp(r.deleted_at) : r.deleted_at === null);
}
export type ArchivedRecurringQuest = RecurringQuest & { archived_at: string };
export function parseArchivedRecurringQuests(input: unknown): ArchivedRecurringQuest[] | null {
  if (!Array.isArray(input)) return null;
  const active = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.archived_at !== "string" || !isAbsoluteTimestamp(item.archived_at)) return null;
    const { archived_at: _archived, ...row } = item;
    void _archived;
    active.push(row);
  }
  return parseRecurringQuests(active) ? input : null;
}
