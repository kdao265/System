import { UUID } from "./create-pending";

export const REOPEN_PREFIX = "system.quest-reopen.pending.v1:";
export type PendingReopen = { version: 1; userId: string; commandId: string; occurrenceId: string; executionCycle: number; origin: "web_ui" };
export type ReopenBlock = { operation: PendingReopen; reason: "stale" | "conflict" };
export type ReopenRead = { status: "missing" | "valid" | "corrupt" | "unavailable"; operations: PendingReopen[]; blocks: ReopenBlock[] };
export function reopenStorageKey(userId: string, commandId: string) { return `${REOPEN_PREFIX}${userId}:${commandId}`; }
export function isPendingReopen(value: unknown, userId: string): value is PendingReopen {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const fields = ["version", "userId", "commandId", "occurrenceId", "executionCycle", "origin"];
  return Object.keys(row).length === fields.length && fields.every((field) => Object.hasOwn(row, field)) &&
    row.version === 1 && row.userId === userId && UUID.test(userId) && typeof row.commandId === "string" && UUID.test(row.commandId) &&
    typeof row.occurrenceId === "string" && UUID.test(row.occurrenceId) && typeof row.executionCycle === "number" &&
    Number.isInteger(row.executionCycle) && row.executionCycle >= 1 && row.executionCycle <= 2147483647 && row.origin === "web_ui";
}
// Legacy V1 requests remain readable. V2 adds a disposition envelope without
// changing any field of the original immutable request. Older tabs fail closed.
function parseRecord(value: unknown, userId: string): { operation: PendingReopen; reason?: ReopenBlock["reason"] } | null {
  if (isPendingReopen(value, userId)) return { operation: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || row.version !== 2 || !isPendingReopen(row.operation, userId) || (row.reason !== "stale" && row.reason !== "conflict")) return null;
  return { operation: row.operation, reason: row.reason };
}
export function readPendingReopens(access: () => Storage, userId: string): ReopenRead {
  try {
    const storage = access(); const operations: PendingReopen[] = []; const blocks: ReopenBlock[] = [];
    for (const key of Array.from({ length: storage.length }, (_, index) => storage.key(index))) {
      if (!key?.startsWith(REOPEN_PREFIX + userId + ":")) continue;
      let value: unknown; try { value = JSON.parse(storage.getItem(key) ?? "null"); } catch { return { status: "corrupt", operations: [], blocks: [] }; }
      const record = parseRecord(value, userId);
      if (!record || key !== reopenStorageKey(userId, record.operation.commandId)) return { status: "corrupt", operations: [], blocks: [] };
      if (record.reason) blocks.push({ operation: record.operation, reason: record.reason });
      else operations.push(record.operation);
    }
    operations.sort((a, b) => a.commandId.localeCompare(b.commandId));
    blocks.sort((a, b) => a.operation.commandId.localeCompare(b.operation.commandId));
    return { status: operations.length || blocks.length ? "valid" : "missing", operations, blocks };
  } catch { return { status: "unavailable", operations: [], blocks: [] }; }
}
export function persistPendingReopen(access: () => Storage, operation: PendingReopen) {
  if (!isPendingReopen(operation, operation.userId)) throw Error("Invalid reopen record");
  const storage = access(); const key = reopenStorageKey(operation.userId, operation.commandId);
  if (storage.getItem(key) !== null) throw Error("Reopen command already exists");
  const serialized = JSON.stringify(operation); storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw Error("Reopen write could not be verified");
}
export function removePendingReopen(access: () => Storage, operation: PendingReopen) {
  const storage = access(); const key = reopenStorageKey(operation.userId, operation.commandId); const raw = storage.getItem(key);
  if (raw === null) return;
  if (JSON.stringify(parseRecord(JSON.parse(raw), operation.userId)?.operation) !== JSON.stringify(operation)) throw Error("Reopen record changed");
  storage.removeItem(key); if (storage.getItem(key) !== null) throw Error("Reopen removal could not be verified");
}
export function persistReopenBlock(access: () => Storage, block: ReopenBlock) {
  const { operation } = block;
  const storage = access(); const key = reopenStorageKey(operation.userId, operation.commandId);
  const raw = storage.getItem(key);
  if (raw !== null) {
    const record = parseRecord(JSON.parse(raw), operation.userId);
    if (!record || JSON.stringify(record.operation) !== JSON.stringify(operation) || (record.reason && record.reason !== block.reason)) throw Error("Reopen record changed");
  }
  const serialized = JSON.stringify({ version: 2, operation, reason: block.reason });
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw Error("Reopen disposition could not be verified");
}
