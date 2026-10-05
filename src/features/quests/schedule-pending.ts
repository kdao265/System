import { UUID, type StorageAccess } from "./create-pending";
import type { ScheduleSaveResult } from "./series-actions";
import { NO_SCHEDULE_DEFAULTS, validScheduleDefaults, type PlannedEndDayOffset, type ScheduleDefaults } from "./schedule-model";

// A distinct durable namespace and Web Lock from pause/create: schedule-defaults
// commands coordinate across tabs without ever sharing a recovery record.
export const SCHEDULE_PREFIX = "system.quest-schedule.pending.v1:";
export const SCHEDULE_LOCK = "system.quest-schedule";

export type ScheduleOperation = {
  version: 1;
  userId: string;
  questId: string;
  commandId: string;
  expectedRevision: number;
  defaults: ScheduleDefaults;
};

type View = {
  phase: "recovering" | "ready" | "sending" | "uncertain" | "blocked";
  version: number;
  operation?: ScheduleOperation;
  error?: string;
  message?: string;
  /** The certified rejection reason of the last settled command, if it was rejected. */
  reason?: ScheduleSaveResult["reason"];
  /** Ephemeral proof of which exact command most recently settled. Never persisted. */
  settlement?: {
    commandId: string;
    outcome: "success" | "rejected";
    reason?: ScheduleSaveResult["reason"];
  };
};
export type ScheduleView = View;
// Shared consumers can hydrate after another consumer has already recovered.
const SERVER_SNAPSHOT: View = { phase: "recovering", version: 0 };
export const getScheduleServerSnapshot = () => SERVER_SNAPSHOT;

export type ScheduleDependencies = {
  storage: StorageAccess;
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  uuid: () => string;
  send: (operation: ScheduleOperation) => Promise<ScheduleSaveResult>;
};

export function isScheduleOperation(value: unknown, userId: string, questId: string): value is ScheduleOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["version", "userId", "questId", "commandId", "expectedRevision", "defaults"];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))) return false;
  if (row.version !== 1 || row.userId !== userId || !UUID.test(userId) ||
      row.questId !== questId || !UUID.test(questId) ||
      typeof row.commandId !== "string" || !UUID.test(row.commandId) ||
      !Number.isInteger(row.expectedRevision) || (row.expectedRevision as number) < 1) return false;
  const defaults = row.defaults;
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return false;
  const tuple = defaults as Record<string, unknown>;
  if (Object.keys(tuple).length !== 3 || !["local_start_time", "local_end_time", "planned_end_day_offset"]
      .every((key) => Object.hasOwn(tuple, key))) return false;
  if (![0, 1, null].includes(tuple.planned_end_day_offset as PlannedEndDayOffset | null)) return false;
  return validScheduleDefaults(tuple.local_start_time, tuple.local_end_time, tuple.planned_end_day_offset);
}

/** Persist before dispatch; serialize cooperating tabs and retain every uncertain command. */
export class ScheduleDefaultsLifecycle {
  private state: View = SERVER_SNAPSHOT;
  private listeners = new Set<() => void>();
  private busy = false;
  private generation = 0;
  private active = true;
  private userId: string;
  private questId: string;
  private deps: ScheduleDependencies;
  constructor(userId: string, questId: string, deps: ScheduleDependencies) {
    this.userId = userId; this.questId = questId; this.deps = deps;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: Omit<View, "version">) {
    // Client-only invalidation version, never persisted or inferred from receipts.
    this.state = { ...state, version: this.state.version + 1 };
    for (const listener of this.listeners) listener();
  }
  activate() { this.active = true; }
  deactivate() {
    this.active = false; this.generation++; this.busy = false;
    this.set({ phase: "blocked", error: "Session changed. Refresh before continuing." });
  }
  private key() { return `${SCHEDULE_PREFIX}${this.userId}:${this.questId}`; }
  private read(): ScheduleOperation | undefined {
    const raw = this.deps.storage().getItem(this.key());
    if (raw === null) return;
    const value: unknown = JSON.parse(raw);
    if (!isScheduleOperation(value, this.userId, this.questId)) throw new Error("Invalid recovery data");
    return value;
  }
  private persist(operation: ScheduleOperation) {
    if (!isScheduleOperation(operation, this.userId, this.questId)) throw new Error("Invalid operation");
    const storage = this.deps.storage();
    if (storage.getItem(this.key()) !== null) throw new Error("Existing operation");
    const raw = JSON.stringify(operation);
    storage.setItem(this.key(), raw);
    if (storage.getItem(this.key()) !== raw) throw new Error("Unverified write");
  }
  private synchronize() {
    let stored = this.read();
    const known = this.state.operation;
    if (known) {
      if (stored && JSON.stringify(stored) !== JSON.stringify(known)) throw new Error("Changed operation");
      if (!stored) { this.persist(known); stored = known; }
    }
    return stored;
  }
  private block() {
    this.set({ ...this.state, phase: "blocked", error: "Schedule recovery data is unavailable or changed. Preserve it and check recovery before continuing." });
  }
  async recover() {
    if (this.busy || !this.active) return;
    this.busy = true;
    const generation = this.generation;
    // Invalidate authoritative detail immediately, including while waiting for
    // another tab's lock. Completion below publishes the reconciled snapshot.
    this.set({ ...this.state, phase: "recovering" });
    try {
      await this.deps.lock(async () => {
        if (generation !== this.generation) return;
        const operation = this.synchronize();
        this.set({
          phase: operation ? "uncertain" : "ready",
          operation,
          settlement: operation ? undefined : this.state.settlement,
        });
      });
    } catch { if (generation === this.generation) this.block(); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async submit(defaults: ScheduleDefaults, expectedRevision: number) {
    if (!validScheduleDefaults(defaults.local_start_time, defaults.local_end_time, defaults.planned_end_day_offset)) return false;
    return this.execute(defaults, expectedRevision);
  }
  async retry() { return this.execute(); }
  private async execute(defaults?: ScheduleDefaults, expectedRevision?: number) {
    const retry = defaults === undefined;
    if (this.busy || !this.active || this.state.phase !== (retry ? "uncertain" : "ready")) return false;
    this.busy = true;
    const generation = this.generation;
    this.set({
      ...this.state,
      phase: "sending",
      error: undefined,
      message: undefined,
      reason: undefined,
      settlement: undefined,
    });
    try {
      return await this.deps.lock(async () => {
        if (generation !== this.generation) return false;
        const stored = this.synchronize();
        if (!retry && stored) { this.set({ phase: "uncertain", operation: stored }); return false; }
        if (retry && !stored) throw new Error("Missing operation");
        const operation: ScheduleOperation = stored ?? {
          version: 1, userId: this.userId, questId: this.questId,
          commandId: this.deps.uuid(), expectedRevision: expectedRevision!,
          defaults: defaults ?? { ...NO_SCHEDULE_DEFAULTS },
        };
        if (!stored) this.persist(operation);
        this.set({ phase: "sending", operation });
        let result: ScheduleSaveResult;
        try { result = await this.deps.send(operation); }
        catch { result = { outcome: "unknown", error: "Connection lost. Retry the exact saved schedule request." }; }
        if (generation !== this.generation) return false;
        if (result.outcome !== "unknown") {
          // A mapped rejection proves the command never committed: this RPC checks
          // command replay before every business rejection, so the exact saved
          // request can never succeed later. Discard it and surface the reason.
          if (JSON.stringify(this.read()) !== JSON.stringify(operation)) throw new Error("Changed operation");
          const storage = this.deps.storage();
          storage.removeItem(this.key());
          if (storage.getItem(this.key()) !== null) throw new Error("Unverified removal");
          this.set({ phase: "ready", error: result.outcome === "rejected" ? result.error : undefined,
            reason: result.outcome === "rejected" ? result.reason : undefined,
            settlement: {
              commandId: operation.commandId,
              outcome: result.outcome,
              ...(result.outcome === "rejected" && result.reason ? { reason: result.reason } : {}),
            },
            message: result.outcome === "success" ? "Request confirmed. Refreshing series details…" : undefined });
          return result.outcome === "success";
        }
        this.set({ phase: "uncertain", operation, error: result.error });
        return false;
      });
    } catch { if (generation === this.generation) this.block(); return false; }
    finally { if (generation === this.generation) this.busy = false; }
  }
}
