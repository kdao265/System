import { UUID } from "./create-pending";
import { validateCompletionResolution, type CompletionResolution } from "./completion-resolution";
import type { QuestCompletionReceipt } from "./completion-receipt";

export const COMPLETION_PREFIX = "system.quest-completion.pending.v1:";
export type PendingCompletion = { version: 1; userId: string; commandId: string; occurrenceId: string; executionCycle: number; reportedCompletedAt: null; origin: "web_ui" };
export type CompletionDisposition = { operation: PendingCompletion; reason: "conflict" | "superseded"; resolution: CompletionResolution | null; acknowledged: boolean };
export type CompletionRead = { status: "missing" | "valid" | "corrupt" | "unavailable"; operations: PendingCompletion[]; dispositions: CompletionDisposition[] };
export function completionStorageKey(userId: string, commandId: string) { return `${COMPLETION_PREFIX}${userId}:${commandId}`; }
export function isPendingCompletion(value: unknown, userId: string): value is PendingCompletion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>; const fields = ["version", "userId", "commandId", "occurrenceId", "executionCycle", "reportedCompletedAt", "origin"];
  return Object.keys(row).length === fields.length && fields.every((field) => Object.hasOwn(row, field)) && row.version === 1 && row.userId === userId && UUID.test(userId) && typeof row.commandId === "string" && UUID.test(row.commandId) && typeof row.occurrenceId === "string" && UUID.test(row.occurrenceId) && typeof row.executionCycle === "number" && Number.isInteger(row.executionCycle) && row.executionCycle >= 1 && row.executionCycle <= 2147483647 && row.reportedCompletedAt === null && row.origin === "web_ui";
}
function parseRecord(value: unknown, userId: string): { operation: PendingCompletion; disposition?: CompletionDisposition } | null {
  if (isPendingCompletion(value, userId)) return { operation: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 5 || row.version !== 2 || !isPendingCompletion(row.operation, userId) ||
    (row.reason !== "conflict" && row.reason !== "superseded") || typeof row.acknowledged !== "boolean") return null;
  const op = row.operation;
  if (row.resolution === null) {
    if (row.reason !== "conflict" || row.acknowledged) return null;
  } else if (!validateCompletionResolution(row.resolution, op.commandId, op.occurrenceId, op.executionCycle) ||
    row.resolution.outcome !== (row.reason === "superseded" ? "unrecorded_superseded" : "conflict") ||
    (row.reason === "conflict" && row.acknowledged)) return null;
  return { operation: op, disposition: { operation: op, reason: row.reason, resolution: row.resolution, acknowledged: row.acknowledged } };
}
export function readPendingCompletions(access: () => Storage, userId: string): CompletionRead {
  try {
    const storage = access(); const operations: PendingCompletion[] = []; const dispositions: CompletionDisposition[] = [];
    for (const key of Array.from({ length: storage.length }, (_, index) => storage.key(index))) {
      if (!key?.startsWith(COMPLETION_PREFIX + userId + ":")) continue;
      let record;
      try { record = parseRecord(JSON.parse(storage.getItem(key) ?? "null"), userId); } catch { record = null; }
      if (!record || key !== completionStorageKey(userId, record.operation.commandId)) return { status: "corrupt", operations: [], dispositions: [] };
      if (record.disposition) dispositions.push(record.disposition); else operations.push(record.operation);
    }
    operations.sort((a, b) => a.commandId.localeCompare(b.commandId));
    dispositions.sort((a, b) => a.operation.commandId.localeCompare(b.operation.commandId));
    return { status: operations.length || dispositions.length ? "valid" : "missing", operations, dispositions };
  } catch { return { status: "unavailable", operations: [], dispositions: [] }; }
}

// Compare all historical fields by value; observations are deliberately excluded.
function receiptEvidence(receipt: QuestCompletionReceipt | null) {
  return receipt === null ? null : [receipt.command_id.toLowerCase(), receipt.occurrence_id.toLowerCase(),
    receipt.quest_id.toLowerCase(), receipt.execution_cycle, receipt.completed_event_id.toLowerCase(),
    receipt.exp_entry_id.toLowerCase(), String(receipt.exp_amount), receipt.reported_completed_at,
    receipt.recorded_completed_at, receipt.replay];
}
function historicalEvidence(resolution: CompletionResolution) {
  return JSON.stringify([resolution.version, resolution.outcome, resolution.command_id.toLowerCase(),
    resolution.occurrence_id.toLowerCase(), resolution.expected_execution_cycle,
    receiptEvidence(resolution.receipt), receiptEvidence(resolution.canonical_receipt),
    resolution.correction_event_id?.toLowerCase(), resolution.reopened_event_id?.toLowerCase(),
    resolution.reversal_entry_id?.toLowerCase()]);
}

/** Prefer durable evidence on same-cycle ties: the RPC supplies no observation timestamp. */
export function mergeCompletionDispositions(durable: CompletionDisposition, incoming: CompletionDisposition): CompletionDisposition | null {
  if (!parseRecord({ version: 2, ...durable }, durable.operation.userId) ||
    !parseRecord({ version: 2, ...incoming }, durable.operation.userId) ||
    JSON.stringify(durable.operation) !== JSON.stringify(incoming.operation) || durable.reason !== incoming.reason) return null;
  const a = durable.resolution; const b = incoming.resolution;
  if (a && b && historicalEvidence(a) !== historicalEvidence(b)) return null;
  const resolution = !a || (b && b.current_execution_cycle > a.current_execution_cycle) ? b : a;
  return { ...durable, resolution, acknowledged: durable.acknowledged || incoming.acknowledged };
}

/** Called under the shared lock. Never downgrade terminal evidence or acknowledgement. */
export function persistCompletionDisposition(access: () => Storage, disposition: CompletionDisposition) {
  const { operation } = disposition;
  if (!parseRecord({ version: 2, ...disposition }, operation.userId)) throw Error("Invalid completion disposition");
  const storage = access(); const key = completionStorageKey(operation.userId, operation.commandId); const raw = storage.getItem(key);
  let merged = disposition;
  if (raw !== null) {
    const record = parseRecord(JSON.parse(raw), operation.userId);
    if (!record || JSON.stringify(record.operation) !== JSON.stringify(operation)) throw Error("Completion record changed");
    const prior = record.disposition;
    if (prior) {
      const compatible = mergeCompletionDispositions(prior, disposition);
      if (!compatible) throw Error("Completion evidence changed");
      merged = compatible;
    }
  }
  const serialized = JSON.stringify({ version: 2, ...merged });
  if (raw !== serialized) storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw Error("Completion disposition could not be verified");
  return merged;
}
export function persistPendingCompletion(access: () => Storage, operation: PendingCompletion) { if (!isPendingCompletion(operation, operation.userId)) throw Error("Invalid completion record"); const storage = access(); const key = completionStorageKey(operation.userId, operation.commandId); if (storage.getItem(key) !== null) throw Error("Completion command already exists"); const serialized = JSON.stringify(operation); storage.setItem(key, serialized); if (storage.getItem(key) !== serialized) throw Error("Completion write could not be verified"); }
export function removePendingCompletion(access: () => Storage, operation: PendingCompletion) { const storage = access(); const key = completionStorageKey(operation.userId, operation.commandId); const raw = storage.getItem(key); if (raw === null) return; if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(operation)) throw Error("Completion record changed"); storage.removeItem(key); if (storage.getItem(key) !== null) throw Error("Completion removal could not be verified"); }
