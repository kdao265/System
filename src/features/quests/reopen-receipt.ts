export type QuestReopenReceipt = { command_id: string; occurrence_id: string; quest_id: string; undone_cycle: number; correction_event_id: string; reopened_event_id: string; reversal_entry_id: string; reversed_amount: number | string; original_credit_entry_id: string; replay: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validAmount(value: unknown): value is number | string {
  if (typeof value === "number") return Number.isSafeInteger(value) && value <= 0;
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) return false;
  try { return BigInt(value) <= BigInt("0") && BigInt(value) >= BigInt("-9223372036854775808"); } catch { return false; }
}
export function validateQuestReopenReceipt(value: unknown, commandId: string, occurrenceId: string, cycle: number): value is QuestReopenReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const fields = ["command_id", "occurrence_id", "quest_id", "undone_cycle", "correction_event_id", "reopened_event_id", "reversal_entry_id", "reversed_amount", "original_credit_entry_id", "replay"];
  return Object.keys(receipt).length === fields.length && fields.every((field) => Object.hasOwn(receipt, field)) &&
    receipt.command_id === commandId && typeof receipt.command_id === "string" && UUID.test(receipt.command_id) &&
    receipt.occurrence_id === occurrenceId && typeof receipt.occurrence_id === "string" && UUID.test(receipt.occurrence_id) &&
    typeof receipt.quest_id === "string" && UUID.test(receipt.quest_id) && typeof receipt.undone_cycle === "number" &&
    Number.isInteger(receipt.undone_cycle) && receipt.undone_cycle === cycle && receipt.undone_cycle >= 1 && receipt.undone_cycle <= 2147483647 &&
    typeof receipt.correction_event_id === "string" && UUID.test(receipt.correction_event_id) && typeof receipt.reopened_event_id === "string" && UUID.test(receipt.reopened_event_id) &&
    typeof receipt.reversal_entry_id === "string" && UUID.test(receipt.reversal_entry_id) && validAmount(receipt.reversed_amount) &&
    typeof receipt.original_credit_entry_id === "string" && UUID.test(receipt.original_credit_entry_id) && typeof receipt.replay === "boolean";
}