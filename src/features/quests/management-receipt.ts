import { isAbsoluteTimestamp } from "./create-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["draft", "scheduled", "active", "completed", "failed", "cancelled"] as const;

export type QuestArchiveReceipt = {
  command_id: string;
  quest_id: string;
  archived: boolean;
  archived_at: string | null;
  archived_event_id: string;
  changed: boolean;
  replay: boolean;
};

export type QuestDeleteReceipt = {
  command_id: string;
  quest_id: string;
  occurrence_id: string;
  deleted_event_id: string;
  deleted_at: string;
  prior_status: (typeof STATUSES)[number];
  replay: boolean;
};

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === fields.length &&
    fields.every((field) => Object.hasOwn(row, field));
}

export function validateQuestArchiveReceipt(
  value: unknown,
  commandId: string,
  questId: string,
  archived: boolean,
): value is QuestArchiveReceipt {
  const fields = [
    "command_id", "quest_id", "archived", "archived_at",
    "archived_event_id", "changed", "replay",
  ] as const;
  if (!exactObject(value, fields)) return false;
  return value.command_id === commandId && UUID.test(String(value.command_id)) &&
    value.quest_id === questId && UUID.test(String(value.quest_id)) &&
    value.archived === archived &&
    (archived
      ? typeof value.archived_at === "string" && isAbsoluteTimestamp(value.archived_at)
      : value.archived_at === null) &&
    typeof value.archived_event_id === "string" && UUID.test(value.archived_event_id) &&
    typeof value.changed === "boolean" &&
    typeof value.replay === "boolean";
}

export function validateQuestDeleteReceipt(
  value: unknown,
  commandId: string,
  questId: string,
): value is QuestDeleteReceipt {
  const fields = [
    "command_id", "quest_id", "occurrence_id", "deleted_event_id",
    "deleted_at", "prior_status", "replay",
  ] as const;
  if (!exactObject(value, fields)) return false;
  return value.command_id === commandId && UUID.test(String(value.command_id)) &&
    value.quest_id === questId && UUID.test(String(value.quest_id)) &&
    typeof value.occurrence_id === "string" && UUID.test(value.occurrence_id) &&
    typeof value.deleted_event_id === "string" && UUID.test(value.deleted_event_id) &&
    typeof value.deleted_at === "string" && isAbsoluteTimestamp(value.deleted_at) &&
    typeof value.prior_status === "string" &&
    STATUSES.includes(value.prior_status as (typeof STATUSES)[number]) &&
    typeof value.replay === "boolean";
}
