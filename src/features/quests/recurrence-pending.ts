import { UUID, type StorageAccess } from "./create-pending";
import type { PauseResult } from "./recurrence-action";

export const PAUSE_PREFIX = "system.quest-recurrence.pending.v1:";
type PauseOperation = { version: 1; userId: string; questId: string; commandId: string; paused: boolean };
type View = { phase: "recovering" | "ready" | "sending" | "uncertain" | "blocked"; operation?: PauseOperation; error?: string; message?: string };
type Dependencies = {
  storage: StorageAccess;
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  uuid: () => string;
  send: (operation: PauseOperation) => Promise<PauseResult>;
};
export function isPauseOperation(value: unknown, userId: string, questId: string): value is PauseOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["version", "userId", "questId", "commandId", "paused"];
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)) &&
    row.version === 1 && row.userId === userId && UUID.test(userId) && row.questId === questId && UUID.test(questId) &&
    typeof row.commandId === "string" && UUID.test(row.commandId) && typeof row.paused === "boolean";
}

/** Persist before dispatch; serialize cooperating tabs and retain every uncertain command. */
export class RecurrencePauseLifecycle {
  private state: View = { phase: "recovering" };
  private listeners = new Set<() => void>();
  private busy = false;
  private generation = 0;
  private active = true;
  private userId: string;
  private questId: string;
  private deps: Dependencies;
  constructor(userId: string, questId: string, deps: Dependencies) {
    this.userId = userId; this.questId = questId; this.deps = deps;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: View) { this.state = state; for (const listener of this.listeners) listener(); }
  activate() { this.active = true; }
  deactivate() {
    this.active = false; this.generation++; this.busy = false;
    this.set({ phase: "blocked", error: "Session changed. Refresh before continuing." });
  }
  private key() { return `${PAUSE_PREFIX}${this.userId}:${this.questId}`; }
  private read(): PauseOperation | undefined {
    const raw = this.deps.storage().getItem(this.key());
    if (raw === null) return;
    const value: unknown = JSON.parse(raw);
    if (!isPauseOperation(value, this.userId, this.questId)) throw new Error("Invalid recovery data");
    return value;
  }
  private persist(operation: PauseOperation) {
    if (!isPauseOperation(operation, this.userId, this.questId)) throw new Error("Invalid operation");
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
    this.set({ ...this.state, phase: "blocked", error: "Recurrence recovery data is unavailable or changed. Preserve it and check recovery before continuing." });
  }
  async recover() {
    if (this.busy || !this.active) return;
    this.busy = true;
    const generation = this.generation;
    try {
      await this.deps.lock(async () => {
        if (generation !== this.generation) return;
        const operation = this.synchronize();
        this.set({ phase: operation ? "uncertain" : "ready", operation });
      });
    } catch { if (generation === this.generation) this.block(); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async submit(paused: boolean) { return this.execute(paused); }
  async retry() { return this.execute(); }
  private async execute(paused?: boolean) {
    const retry = paused === undefined;
    if (this.busy || !this.active || this.state.phase !== (retry ? "uncertain" : "ready")) return false;
    this.busy = true;
    const generation = this.generation;
    this.set({ ...this.state, phase: "sending", error: undefined, message: undefined });
    try {
      return await this.deps.lock(async () => {
        if (generation !== this.generation) return false;
        const stored = this.synchronize();
        if (!retry && stored) { this.set({ phase: "uncertain", operation: stored }); return false; }
        if (retry && !stored) throw new Error("Missing operation");
        const operation: PauseOperation = stored ?? { version: 1, userId: this.userId, questId: this.questId, commandId: this.deps.uuid(), paused: paused! };
        if (!stored) this.persist(operation);
        this.set({ phase: "sending", operation });
        let result: PauseResult;
        try { result = await this.deps.send(operation); }
        catch { result = { outcome: "unknown", error: "Connection lost. Retry the exact saved pause/resume request." }; }
        if (generation !== this.generation) return false;
        if (result.outcome === "success" || (!retry && result.outcome === "rejected")) {
          if (JSON.stringify(this.read()) !== JSON.stringify(operation)) throw new Error("Changed operation");
          const storage = this.deps.storage();
          storage.removeItem(this.key());
          if (storage.getItem(this.key()) !== null) throw new Error("Unverified removal");
          this.set({ phase: "ready", error: result.error,
            message: result.outcome === "success" ? "Request confirmed. Refreshing current recurrence state…" : undefined });
          return result.outcome === "success";
        }
        this.set({ phase: "uncertain", operation, error: result.error });
        return false;
      });
    } catch { if (generation === this.generation) this.block(); return false; }
    finally { if (generation === this.generation) this.busy = false; }
  }
}
