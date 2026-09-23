import { isAbsoluteTimestamp, type QuestCreationRequest } from "./create-model";

export type QuestCreationReceipt = {
  command_id: string;
  quest_id: string;
  occurrence_id: string;
  definition_created_event_id: string;
  occurrence_scheduled_event_id: string;
  scheduled_at: string | null;
  deadline_at: string | null;
  reward_exp_snapshot: number;
  execution_cycle: number;
  replay: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateQuestCreationReceipt(value: unknown, commandId: string, request: QuestCreationRequest): value is QuestCreationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const timesMatch = (actual: unknown, expected: string | null) => actual === null
    ? expected === null
    : typeof actual === "string" && expected !== null && isAbsoluteTimestamp(actual) && new Date(actual).getTime() === new Date(expected).getTime();
  return Object.keys(receipt).length === 10 &&
    ["command_id", "quest_id", "occurrence_id", "definition_created_event_id", "occurrence_scheduled_event_id", "scheduled_at", "deadline_at", "reward_exp_snapshot", "execution_cycle", "replay"].every((key) => Object.hasOwn(receipt, key)) &&
    typeof receipt.command_id === "string" && receipt.command_id === commandId && UUID.test(receipt.command_id) &&
    typeof receipt.quest_id === "string" && UUID.test(receipt.quest_id) &&
    typeof receipt.occurrence_id === "string" && UUID.test(receipt.occurrence_id) &&
    typeof receipt.definition_created_event_id === "string" && UUID.test(receipt.definition_created_event_id) &&
    typeof receipt.occurrence_scheduled_event_id === "string" && UUID.test(receipt.occurrence_scheduled_event_id) &&
    receipt.definition_created_event_id !== receipt.occurrence_scheduled_event_id &&
    (receipt.scheduled_at === null || isAbsoluteTimestamp(receipt.scheduled_at)) &&
    (receipt.deadline_at === null || isAbsoluteTimestamp(receipt.deadline_at)) &&
    (receipt.scheduled_at !== null || receipt.deadline_at !== null) &&
    (receipt.scheduled_at === null || receipt.deadline_at === null || new Date(receipt.deadline_at).getTime() >= new Date(receipt.scheduled_at).getTime()) &&
    timesMatch(receipt.scheduled_at, request.scheduled_at) && timesMatch(receipt.deadline_at, request.deadline_at) &&
    typeof receipt.reward_exp_snapshot === "number" && Number.isInteger(receipt.reward_exp_snapshot) &&
    receipt.reward_exp_snapshot === request.default_reward_exp && receipt.reward_exp_snapshot >= 0 && receipt.reward_exp_snapshot <= 2147483647 &&
    receipt.execution_cycle === 1 && typeof receipt.replay === "boolean";
}
