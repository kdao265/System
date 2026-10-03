import { UUID, type StorageAccess } from "./create-pending";
import type { QuestManagementOperation, QuestManagementState } from "./management-action";

export const MANAGEMENT_PREFIX = "system.quest-management.pending.v1:";
export const MANAGEMENT_LOCK = "system.quest-management";
export type PendingManagement = {
  version: 1;
  userId: string;
  commandId: string;
  questId: string;
  operation: QuestManagementOperation;
  title: string;
};
type View = {
  phase: "recovering" | "ready" | "sending" | "uncertain" | "blocked";
  pending?: PendingManagement;
  result?: QuestManagementState;
  // Retain client command identity when pending is cleared. Consumers can
  // distinguish a new result without depending on result object identity.
  resultCommandId?: string;
  questId?: string;
};
// Streamed rows may hydrate after browser recovery has already finished. Their
// hydration snapshot must still match the disabled server-rendered controls.
const SERVER_SNAPSHOT: View = { phase: "recovering" };
export const getManagementServerSnapshot = () => SERVER_SNAPSHOT;
type Dependencies = {
  storage: StorageAccess;
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  uuid: () => string;
  send: (previous: QuestManagementState, data: FormData) => Promise<QuestManagementState>;
};

function isPending(value: unknown, userId: string): value is PendingManagement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["version", "userId", "commandId", "questId", "operation", "title"];
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)) &&
    row.version === 1 && row.userId === userId && UUID.test(userId) &&
    typeof row.commandId === "string" && UUID.test(row.commandId) &&
    typeof row.questId === "string" && UUID.test(row.questId) &&
    ["archive", "restore", "delete"].includes(String(row.operation)) &&
    typeof row.title === "string" && row.title.trim() !== "" && [...row.title].length <= 120;
}

/** One immutable unresolved command per account, coordinated across rows and tabs. */
export class QuestManagementLifecycle {
  private state: View = { phase: "recovering" };
  private listeners = new Set<() => void>();
  private busy = false;
  private generation = 0;
  private active = true;
  private userId: string;
  private deps: Dependencies;
  private readonly prefix: string;
  constructor(userId: string, deps: Dependencies, prefix = MANAGEMENT_PREFIX) { this.userId = userId; this.deps = deps; this.prefix = prefix; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: View) { this.state = state; for (const listener of this.listeners) listener(); }
  activate() { this.active = true; }
  deactivate() {
    this.active = false;
    this.generation++;
    this.busy = false;
    this.set({ ...this.state, phase: "blocked" });
  }
  private key() { return this.prefix + this.userId; }
  private read(): PendingManagement | undefined {
    const raw = this.deps.storage().getItem(this.key());
    if (raw === null) return;
    const value: unknown = JSON.parse(raw);
    if (!isPending(value, this.userId)) throw new Error("Invalid recovery data");
    return value;
  }
  private persist(pending: PendingManagement) {
    if (!isPending(pending, this.userId)) throw new Error("Invalid command");
    const storage = this.deps.storage();
    if (storage.getItem(this.key()) !== null) throw new Error("Existing command");
    const raw = JSON.stringify(pending);
    storage.setItem(this.key(), raw);
    if (storage.getItem(this.key()) !== raw) throw new Error("Unverified write");
  }
  private synchronize() {
    let stored = this.read();
    const known = this.state.pending;
    if (known) {
      if (stored && JSON.stringify(stored) !== JSON.stringify(known)) throw new Error("Changed command");
      // Missing storage cannot prove resolution. Restore the known ID and replay it.
      if (!stored) { this.persist(known); stored = known; }
    }
    return stored;
  }
  async recover() {
    if (this.busy || !this.active) return;
    this.busy = true;
    const generation = this.generation;
    try {
      await this.deps.lock(async () => {
        if (generation !== this.generation) return;
        const pending = this.synchronize();
        this.set({ ...this.state, phase: pending ? "uncertain" : "ready", pending });
      });
    } catch { if (generation === this.generation) this.set({ ...this.state, phase: "blocked" }); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  submit(questId: string, operation: QuestManagementOperation, title: string) {
    return this.execute({ questId, operation, title });
  }
  retry() { return this.execute(); }
  private async execute(request?: Pick<PendingManagement, "questId" | "operation" | "title">) {
    const retry = !request;
    if (this.busy || !this.active || this.state.phase !== (retry ? "uncertain" : "ready")) return;
    this.busy = true;
    const generation = this.generation;
    try {
      await this.deps.lock(async () => {
        if (generation !== this.generation) return;
        const stored = this.synchronize();
        if (request && stored) { this.set({ phase: "uncertain", pending: stored }); return; }
        if (retry && !stored) throw new Error("Missing command");
        const pending: PendingManagement = stored ?? {
          version: 1, userId: this.userId, commandId: this.deps.uuid(), ...request!,
        };
        if (!stored) this.persist(pending);
        this.set({ phase: "sending", pending, questId: pending.questId });
        const form = new FormData();
        form.set("expected_account", pending.userId);
        form.set("command_id", pending.commandId);
        form.set("quest_id", pending.questId);
        form.set("operation", pending.operation);
        form.set("mode", retry ? "retry" : "new");
        let result: QuestManagementState;
        try { result = await this.deps.send({ outcome: "idle" }, form); }
        catch { result = { outcome: "unknown", operation: pending.operation }; }
        if (generation !== this.generation) return;
        if (result.outcome === "success" || (!retry && result.outcome === "rejected")) {
          if (JSON.stringify(this.read()) !== JSON.stringify(pending)) throw new Error("Changed command");
          const storage = this.deps.storage();
          storage.removeItem(this.key());
          if (storage.getItem(this.key()) !== null) throw new Error("Unverified removal");
          this.set({ phase: "ready", result, resultCommandId: pending.commandId, questId: pending.questId });
        } else {
          this.set({ phase: "uncertain", pending, result, resultCommandId: pending.commandId, questId: pending.questId });
        }
        if (result.outcome === "rejected" && result.reason === "account") this.deactivate();
      });
    } catch { if (generation === this.generation) this.set({ ...this.state, phase: "blocked" }); }
    finally { if (generation === this.generation) this.busy = false; }
  }
}
