import { isSupportedTimezone } from "@/features/profile/timezones";
import { validateQuestCreationRequest, type QuestCreationRequest } from "./create-model";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PENDING_PREFIX = "system.quest-creation.pending.v2:";
const LEGACY_PREFIX = "system.quest-creation.pending.v1:";
export type PendingCreation = {
  version: 2;
  userId: string;
  commandId: string;
  timezone: string;
  request: QuestCreationRequest;
};
export type StorageAccess = () => Storage;
export type PendingRead =
  | { status: "missing"; operations: PendingCreation[] }
  | { status: "valid"; operations: PendingCreation[] }
  | { status: "corrupt" | "unavailable"; operations: PendingCreation[] };

export function pendingStorageKey(userId: string, commandId: string) {
  return `${PENDING_PREFIX}${userId}:${commandId}`;
}

export function isPending(value: unknown, userId: string): value is PendingCreation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["version", "userId", "commandId", "timezone", "request"];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return false;
  if (row.version !== 2 || row.userId !== userId || !UUID.test(userId) ||
      typeof row.commandId !== "string" || !UUID.test(row.commandId) ||
      !isSupportedTimezone(row.timezone) || !validateQuestCreationRequest(row.request)) return false;
  // Browser snapshots are normalized once, then replayed byte-for-byte.
  return row.request.title === row.request.title.trim() &&
    (row.request.description === null || (row.request.description !== "" && row.request.description === row.request.description.trim())) &&
    [row.request.scheduled_at, row.request.deadline_at].every((time) =>
      time === null || new Date(time).toISOString() === time);
}

/** Call while holding the browser lock. Never turn unreadable data into an empty account. */
export function readPendingCreations(access: StorageAccess, userId: string): PendingRead {
  try {
    const storage = access(); // Includes exceptions from window.localStorage itself.
    if (!UUID.test(userId)) return { status: "corrupt", operations: [] };
    // Old builds have no embedded account/schema provenance. Preserve, block, and
    // require explicit recovery instead of silently forgetting an uncertain command.
    if (storage.getItem(LEGACY_PREFIX + userId) !== null) return { status: "corrupt", operations: [] };
    const operations: PendingCreation[] = [];
    const prefix = PENDING_PREFIX + userId + ":";
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) {
      if (!key?.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      let value: unknown;
      try { value = JSON.parse(raw ?? "null"); } catch { return { status: "corrupt", operations: [] }; }
      if (!isPending(value, userId) || key !== pendingStorageKey(userId, value.commandId)) {
        return { status: "corrupt", operations: [] };
      }
      operations.push(value);
    }
    operations.sort((a, b) => a.commandId.localeCompare(b.commandId));
    return { status: operations.length ? "valid" : "missing", operations };
  } catch {
    return { status: "unavailable", operations: [] };
  }
}

/** Immutable insert, with read-back verification. No overwrite, including on UUID collision. */
export function persistPending(access: StorageAccess, operation: PendingCreation) {
  const storage = access();
  if (!isPending(operation, operation.userId)) throw new Error("Invalid pending record");
  const key = pendingStorageKey(operation.userId, operation.commandId);
  if (storage.getItem(key) !== null) throw new Error("Pending command already exists");
  const serialized = JSON.stringify(operation);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Pending write could not be verified");
}

/** A caller must hold the same browser lock as insertion/retry. */
export function removePending(access: StorageAccess, operation: PendingCreation) {
  const storage = access();
  const key = pendingStorageKey(operation.userId, operation.commandId);
  const raw = storage.getItem(key);
  if (raw === null) throw new Error("Pending record unexpectedly missing");
  if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(operation)) throw new Error("Pending record changed");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Pending removal could not be verified");
}

