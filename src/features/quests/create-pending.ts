import { isSupportedTimezone } from "@/features/profile/timezones";
import { validateQuestCreationRequest, type QuestCreationRequest } from "./create-model";
import { validateRecurringRequestV3, validateRecurringRequestV4, isRecurring,
  type RecurringRequestV3, type RecurringRequestV4 } from "./recurring-model";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PENDING_PREFIX = "system.quest-creation.pending.v2:";
export const RECURRING_PENDING_PREFIX = "system.quest-creation.pending.v3:";
// New recurring creations dispatch create_recurring_quest_v2 through their own
// durable namespace. The v3 contract stays frozen and replayable.
export const RECURRING_SCHEDULE_PENDING_PREFIX = "system.quest-creation.pending.v4:";
const LEGACY_PREFIX = "system.quest-creation.pending.v1:";
export const PENDING_VERSIONS = [2, 3, 4] as const;
export type PendingVersion = typeof PENDING_VERSIONS[number];
export type PendingCreation = {
  userId: string;
  commandId: string;
  timezone: string;
} & (
  | { version: 2; request: QuestCreationRequest }
  | { version: 3; request: RecurringRequestV3 }
  | { version: 4; request: RecurringRequestV4 }
);
export type StorageAccess = () => Storage;
export type PendingRead =
  | { status: "missing"; operations: PendingCreation[] }
  | { status: "valid"; operations: PendingCreation[] }
  | { status: "corrupt" | "unavailable"; operations: PendingCreation[] };

export function pendingStorageKey(userId: string, commandId: string, version: PendingVersion = 2) {
  const prefix = version === 2 ? PENDING_PREFIX : version === 3 ? RECURRING_PENDING_PREFIX : RECURRING_SCHEDULE_PENDING_PREFIX;
  return `${prefix}${userId}:${commandId}`;
}

function validRequest(version: PendingVersion, request: unknown) {
  if (version === 2) return validateQuestCreationRequest(request);
  return version === 3 ? validateRecurringRequestV3(request) : validateRecurringRequestV4(request);
}

export function isPending(value: unknown, userId: string): value is PendingCreation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["version", "userId", "commandId", "timezone", "request"];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return false;
  if (!PENDING_VERSIONS.includes(row.version as PendingVersion) || row.userId !== userId || !UUID.test(userId) ||
      typeof row.commandId !== "string" || !UUID.test(row.commandId) ||
      !isSupportedTimezone(row.timezone)) return false;
  if (!validRequest(row.version as PendingVersion, row.request)) return false;
  const request = row.request as QuestCreationRequest | RecurringRequestV3 | RecurringRequestV4;
  // Browser snapshots are normalized once, then replayed byte-for-byte.
  return request.title === request.title.trim() &&
    (request.description === null || (request.description !== "" && request.description === request.description.trim())) &&
    (isRecurring(request) || [request.scheduled_at, request.deadline_at].every((time) =>
      time === null || new Date(time).toISOString() === time));
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
    const prefixes = [PENDING_PREFIX, RECURRING_PENDING_PREFIX, RECURRING_SCHEDULE_PENDING_PREFIX]
      .map((prefix) => prefix + userId + ":");
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) {
      if (!key || !prefixes.some((prefix) => key.startsWith(prefix))) continue;
      const raw = storage.getItem(key);
      let value: unknown;
      try { value = JSON.parse(raw ?? "null"); } catch { return { status: "corrupt", operations: [] }; }
      if (!isPending(value, userId) || key !== pendingStorageKey(userId, value.commandId, value.version)) {
        return { status: "corrupt", operations: [] };
      }
      if (operations.some((operation) => operation.commandId === value.commandId)) return { status: "corrupt", operations: [] };
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
  const key = pendingStorageKey(operation.userId, operation.commandId, operation.version);
  if (PENDING_VERSIONS.some((version) => storage.getItem(pendingStorageKey(operation.userId, operation.commandId, version)) !== null)) throw new Error("Pending command already exists");
  const serialized = JSON.stringify(operation);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Pending write could not be verified");
}


/** A caller must hold the same browser lock as insertion/retry. */
export function removePending(access: StorageAccess, operation: PendingCreation) {
  const storage = access();
  const key = pendingStorageKey(operation.userId, operation.commandId, operation.version);
  const raw = storage.getItem(key);
  if (raw === null) throw new Error("Pending record unexpectedly missing");
  if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(operation)) throw new Error("Pending record changed");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Pending removal could not be verified");
}
