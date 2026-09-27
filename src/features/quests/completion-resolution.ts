import { UUID } from "./create-pending";
import { sameUuid, validateQuestCompletionReceipt, type QuestCompletionReceipt } from "./completion-receipt";

export type CompletionResolution = {
  version: 1;
  outcome: "recorded" | "unrecorded_current" | "unrecorded_superseded" | "conflict";
  command_id: string;
  occurrence_id: string;
  expected_execution_cycle: number;
  current_execution_cycle: number;
  current_status: "draft" | "scheduled" | "active" | "completed" | "failed" | "cancelled";
  receipt: QuestCompletionReceipt | null;
  canonical_receipt: QuestCompletionReceipt | null;
  correction_event_id: string | null;
  reopened_event_id: string | null;
  reversal_entry_id: string | null;
};
const fields = ["version", "outcome", "command_id", "occurrence_id", "expected_execution_cycle", "current_execution_cycle", "current_status", "receipt", "canonical_receipt", "correction_event_id", "reopened_event_id", "reversal_entry_id"];
const cycle = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2147483647;

/** Migration ten's locked observation. Never infer a caller receipt from canonical evidence. */
export function validateCompletionResolution(value: unknown, commandId: string, occurrenceId: string, expectedCycle: number): value is CompletionResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== fields.length || !fields.every((field) => Object.hasOwn(r, field)) ||
    r.version !== 1 || !sameUuid(r.command_id, commandId) || !sameUuid(r.occurrence_id, occurrenceId) ||
    r.expected_execution_cycle !== expectedCycle || !cycle(expectedCycle) || !cycle(r.current_execution_cycle) ||
    typeof r.current_status !== "string" || !["draft", "scheduled", "active", "completed", "failed", "cancelled"].includes(r.current_status)) return false;
  const undo = [r.correction_event_id, r.reopened_event_id, r.reversal_entry_id];
  const noUndo = undo.every((id) => id === null);
  const canonical = r.canonical_receipt as QuestCompletionReceipt | null;
  const validCanonical = () => canonical !== null && typeof canonical === "object" &&
    validateQuestCompletionReceipt(canonical, canonical.command_id, occurrenceId, expectedCycle) &&
    !sameUuid(canonical.command_id, commandId) && canonical.replay === true;
  switch (r.outcome) {
    case "conflict": return r.receipt === null && canonical === null && noUndo;
    case "recorded": return r.current_execution_cycle >= expectedCycle &&
      (r.current_execution_cycle !== expectedCycle || r.current_status === "completed") &&
      validateQuestCompletionReceipt(r.receipt, commandId, occurrenceId, expectedCycle) && r.receipt.replay === true && canonical === null && noUndo;
    case "unrecorded_current": return r.current_execution_cycle === expectedCycle && r.receipt === null && noUndo &&
      (r.current_status === "completed" ? validCanonical() : canonical === null);
    case "unrecorded_superseded": return r.current_execution_cycle > expectedCycle && r.receipt === null && validCanonical() &&
      undo.every((id) => typeof id === "string" && UUID.test(id)) &&
      !sameUuid(r.correction_event_id, r.reopened_event_id) && !sameUuid(r.correction_event_id, canonical?.completed_event_id) &&
      !sameUuid(r.reopened_event_id, canonical?.completed_event_id) && !sameUuid(r.reversal_entry_id, canonical?.exp_entry_id);
    default: return false;
  }
}
