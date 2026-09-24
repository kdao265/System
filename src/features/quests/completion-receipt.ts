import { isAbsoluteTimestamp } from "./create-model";

export type QuestCompletionReceipt = {
  command_id: string;
  occurrence_id: string;
  quest_id: string;
  execution_cycle: number;
  completed_event_id: string;
  exp_entry_id: string;
  exp_amount: number | string;
  reported_completed_at: string | null;
  recorded_completed_at: string;
  replay: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIGINT_MAX = BigInt("9223372036854775807");

function validAmount(value: unknown): value is number | string {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  try { return BigInt(value) <= BIGINT_MAX; } catch { return false; }
}

export function validateQuestCompletionReceipt(value: unknown, commandId: string, occurrenceId: string, cycle: number): value is QuestCompletionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const fields = ["command_id", "occurrence_id", "quest_id", "execution_cycle", "completed_event_id", "exp_entry_id", "exp_amount", "reported_completed_at", "recorded_completed_at", "replay"];
  return Object.keys(receipt).length === fields.length && fields.every((field) => Object.hasOwn(receipt, field)) &&
    typeof receipt.command_id === "string" && receipt.command_id === commandId && UUID.test(receipt.command_id) &&
    typeof receipt.occurrence_id === "string" && receipt.occurrence_id === occurrenceId && UUID.test(receipt.occurrence_id) &&
    typeof receipt.quest_id === "string" && UUID.test(receipt.quest_id) &&
    typeof receipt.execution_cycle === "number" && Number.isInteger(receipt.execution_cycle) && receipt.execution_cycle === cycle && receipt.execution_cycle >= 1 && receipt.execution_cycle <= 2147483647 &&
    typeof receipt.completed_event_id === "string" && UUID.test(receipt.completed_event_id) &&
    typeof receipt.exp_entry_id === "string" && UUID.test(receipt.exp_entry_id) && validAmount(receipt.exp_amount) &&
    (receipt.reported_completed_at === null || (typeof receipt.reported_completed_at === "string" && isAbsoluteTimestamp(receipt.reported_completed_at))) &&
    typeof receipt.recorded_completed_at === "string" && isAbsoluteTimestamp(receipt.recorded_completed_at) && typeof receipt.replay === "boolean";
}

export function completionSuccessMessage(receipt: QuestCompletionReceipt) {
  const amount = typeof receipt.exp_amount === "string" ? receipt.exp_amount : String(receipt.exp_amount);
  return receipt.replay ? `Completion confirmed from an earlier request. ${amount} EXP awarded.` : `Quest completed. ${amount} EXP awarded.`;
}