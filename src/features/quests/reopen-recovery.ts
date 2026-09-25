import type { ReopenState } from "./reopen-action";
import type { DayQuestResult } from "./model";
import { persistPendingReopen, persistReopenBlock, readPendingReopens, removePendingReopen, type PendingReopen, type ReopenBlock, type ReopenRead } from "./reopen-pending";

export type ReopenConfirmation = { operation: PendingReopen; message: string; replay: boolean; cleanupPending: boolean };
export type ReopenView = {
  phase: "recovering" | "ready" | "sending" | "uncertain" | "awaiting-refresh" | "blocked";
  storage: ReopenRead["status"] | "unchecked";
  busy: boolean; accountChanged: boolean;
  operations: PendingReopen[]; confirmations: ReopenConfirmation[]; blocks: ReopenBlock[];
  refreshRequired: boolean; refreshing: boolean; refreshError?: string; error?: string;
};
export type ReopenDependencies = { storage: () => Storage; lock: <T>(userId: string, work: () => Promise<T>) => Promise<T>; send: (previous: unknown, form: FormData) => Promise<ReopenState>; uuid: () => string };
const storageError = "Browser recovery storage or tab coordination is unavailable. Your saved reopen requests are preserved; check recovery again.";
const corruptError = "Saved reopen recovery data is unreadable or changed. Preserve the data and resolve the original request before continuing.";
const unknownError = "The reopen outcome is unknown. Retry the exact saved request to confirm it.";
const staleError = "Reopen is awaiting a fresh Dashboard read of the changed Quest. The stale cycle cannot be submitted again.";
const conflictError = "A reopen command conflicts with recorded history. Its request is preserved for reconciliation; identical retries are blocked.";
const sameOperation = (a: PendingReopen, b: PendingReopen) => JSON.stringify(a) === JSON.stringify(b);
const sameIntent = (a: PendingReopen, occurrenceId: string, cycle: number) => a.occurrenceId === occurrenceId && a.executionCycle === cycle;
const cycleKey = (occurrenceId: string, cycle: number) => `${occurrenceId}:${cycle}`;
type Intent = { kind: "new"; occurrenceId: string; executionCycle: number } | { kind: "retry"; operation: PendingReopen };

export class ReopenRecoveryLifecycle {
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = true;
  private readonly userId: string;
  private readonly deps: ReopenDependencies;
  // A late row callback cannot reuse a cycle whose rejection was reconciled.
  private staleCycles = new Set<string>();
  private pendingRead?: DayQuestResult;
  private state: ReopenView = { phase: "recovering", storage: "unchecked", busy: false, accountChanged: false, operations: [], confirmations: [], blocks: [], refreshRequired: false, refreshing: false };
  constructor(userId: string, deps: ReopenDependencies) { this.userId = userId; this.deps = deps; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(patch: Partial<ReopenView>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  activate() { this.active = true; this.set({ accountChanged: false }); }
  deactivate = () => {
    this.active = false; this.generation++; this.pendingRead = undefined;
    this.set({ phase: "blocked", busy: false, refreshing: false, accountChanged: true, error: "Your account changed or your session ended. Refresh to continue with the signed-in account." });
  };
  private current(generation: number) { return this.active && generation === this.generation; }
  private settle() {
    const conflict = this.state.blocks.some((item) => item.reason === "conflict");
    const stale = this.state.blocks.some((item) => item.reason === "stale");
    this.set({
      phase: conflict ? "blocked" : stale ? "awaiting-refresh" : this.state.operations.length ? "uncertain" : "ready",
      error: conflict ? conflictError : stale ? staleError : undefined,
      refreshRequired: this.state.refreshRequired || stale,
    });
  }
  private corrupt() { this.set({ phase: "blocked", storage: "corrupt", error: corruptError }); return false; }
  private readInventory() {
    const read = readPendingReopens(this.deps.storage, this.userId);
    if (read.status === "corrupt" || read.status === "unavailable") {
      this.set({ phase: "blocked", storage: read.status, error: read.status === "corrupt" ? corruptError : storageError }); return false;
    }
    const stored = new Map([...read.operations, ...read.blocks.map((item) => item.operation)].map((operation) => [operation.commandId, operation]));
    const blocks = new Map(read.blocks.map((item) => [item.operation.commandId, item]));
    // Validate ALL known evidence before restoring, filtering, or cleaning anything.
    for (const operation of [...this.state.operations, ...this.state.blocks.map((item) => item.operation), ...this.state.confirmations.map((item) => item.operation)]) {
      const existing = stored.get(operation.commandId);
      if (existing && !sameOperation(existing, operation)) return this.corrupt();
    }
    for (const block of this.state.blocks) {
      const existing = blocks.get(block.operation.commandId);
      if (existing && existing.reason !== block.reason) return this.corrupt();
      if (!existing) persistReopenBlock(this.deps.storage, block);
      stored.set(block.operation.commandId, block.operation); blocks.set(block.operation.commandId, block);
    }
    for (const operation of this.state.operations) {
      if (!stored.has(operation.commandId)) {
        persistPendingReopen(this.deps.storage, operation); stored.set(operation.commandId, operation);
      }
    }
    const confirmedIds = new Set(this.state.confirmations.map((item) => item.operation.commandId));
    // An accepted command cannot also have a definitive rejection disposition.
    if ([...blocks.keys()].some((id) => confirmedIds.has(id))) return this.corrupt();
    for (const { operation, reason } of blocks.values()) {
      if (reason === "stale") this.staleCycles.add(cycleKey(operation.occurrenceId, operation.executionCycle));
    }
    this.set({
      storage: stored.size ? "valid" : "missing",
      operations: [...stored.values()].filter((operation) => !confirmedIds.has(operation.commandId) && !blocks.has(operation.commandId)),
      blocks: [...blocks.values()],
      confirmations: this.state.confirmations.map((item) => stored.has(item.operation.commandId) ? { ...item, cleanupPending: true } : item),
    });
    return true;
  }
  private async locked(work: (generation: number) => Promise<void> | void, isActive: () => boolean = () => true) {
    if (!this.active || this.state.busy || !isActive()) return;
    const generation = this.generation; this.set({ busy: true });
    try {
      await this.deps.lock(this.userId, async () => { if (this.current(generation) && isActive()) await work(generation); });
    } catch {
      if (this.current(generation)) this.set({ phase: "blocked", storage: "unavailable", error: storageError });
    } finally {
      if (this.current(generation)) {
        this.set({ busy: false });
        // A panel can commit while recovery or a dispatched action owns the lock.
        if (this.pendingRead) void this.consumeServerRead();
      }
    }
  }
  async recover() { await this.locked(() => { if (this.readInventory()) this.settle(); }); }
  async observeServerRead(userId: string, result: DayQuestResult) {
    if (!this.active || userId !== this.userId || result.status !== "ok") return;
    this.pendingRead = result;
    await this.consumeServerRead();
  }
  private async consumeServerRead() {
    if (!this.active || this.state.busy || !this.pendingRead) return;
    const result = this.pendingRead; this.pendingRead = undefined;
    await this.locked(() => {
      if (result.status !== "ok" || !this.readInventory()) return;
      const resolved = this.state.blocks.filter(({ operation, reason }) => reason === "stale" && result.quests.some((quest) =>
        quest.occurrence_id === operation.occurrenceId && quest.execution_cycle > operation.executionCycle));
      for (const block of resolved) removePendingReopen(this.deps.storage, block.operation);
      if (resolved.length) {
        const ids = new Set(resolved.map((item) => item.operation.commandId));
        const blocks = this.state.blocks.filter((item) => !ids.has(item.operation.commandId));
        this.set({ blocks, refreshRequired: blocks.some((item) => item.reason === "stale"), refreshError: undefined });
      }
      this.settle();
    });
  }
  async submitForOccurrence(occurrenceId: string, executionCycle: number, isActive?: () => boolean) { await this.execute({ kind: "new", occurrenceId, executionCycle }, isActive); }
  async retry(commandId: string, isActive?: () => boolean) {
    const operation = this.state.operations.find((item) => item.commandId === commandId);
    if (operation) await this.execute({ kind: "retry", operation }, isActive);
  }
  async retryForOccurrence(occurrenceId: string, executionCycle: number, isActive?: () => boolean) {
    const operation = this.state.operations.find((item) => sameIntent(item, occurrenceId, executionCycle));
    if (operation) await this.retry(operation.commandId, isActive);
  }
  private async execute(intent: Intent, isActive?: () => boolean) {
    await this.locked(async (generation) => {
      if (!this.readInventory() || !this.current(generation) || (isActive && !isActive())) return;
      if (this.state.blocks.length) { this.settle(); return; }
      const target = intent.kind === "new" ? intent : intent.operation;
      if (this.staleCycles.has(cycleKey(target.occurrenceId, target.executionCycle))) return;
      if (intent.kind === "new") {
        if (this.state.confirmations.some((item) => sameIntent(item.operation, intent.occurrenceId, intent.executionCycle))) return;
        if (this.state.operations.some((item) => sameIntent(item, intent.occurrenceId, intent.executionCycle))) {
          this.set({ phase: "uncertain", error: "This Quest has a saved reopen request. Retry that exact request to confirm it." }); return;
        }
      }
      const operation: PendingReopen = intent.kind === "retry" ? intent.operation : { version: 1, userId: this.userId, commandId: this.deps.uuid(), occurrenceId: intent.occurrenceId, executionCycle: intent.executionCycle, origin: "web_ui" };
      if (intent.kind === "new") persistPendingReopen(this.deps.storage, operation);
      this.set({ phase: "sending", error: undefined, operations: [operation, ...this.state.operations.filter((item) => item.commandId !== operation.commandId)] });
      const form = new FormData(); form.set("expected_account", this.userId); form.set("command_id", operation.commandId); form.set("occurrence_id", operation.occurrenceId); form.set("execution_cycle", String(operation.executionCycle));
      let result: ReopenState;
      try { result = await this.deps.send({}, form); } catch { result = { outcome: "unknown", error: unknownError }; }
      if (!this.current(generation)) return;
      if (result.outcome === "success") {
        this.set({ confirmations: [...this.state.confirmations, { operation, message: result.success.message, replay: result.success.replay, cleanupPending: true }], operations: this.state.operations.filter((item) => item.commandId !== operation.commandId), refreshRequired: this.state.refreshRequired || result.refreshRequired });
        if (this.readInventory()) { this.cleanup(operation); this.settle(); }
      } else if (result.outcome === "rejected" && result.reason === "account") this.deactivate();
      else if (result.outcome === "rejected" && (result.reason === "stale" || result.reason === "conflict")) {
        const block: ReopenBlock = { operation, reason: result.reason };
        // Keep the rejection in memory even if persisting its disposition fails.
        this.set({ blocks: [...this.state.blocks, block], operations: this.state.operations.filter((item) => item.commandId !== operation.commandId) });
        if (result.reason === "stale") this.staleCycles.add(cycleKey(operation.occurrenceId, operation.executionCycle));
        this.settle(); persistReopenBlock(this.deps.storage, block);
      } else if (result.outcome === "rejected" && intent.kind === "new") {
        removePendingReopen(this.deps.storage, operation);
        this.set({ operations: this.state.operations.filter((item) => item.commandId !== operation.commandId) });
        this.settle(); this.set({ error: result.error });
      } else this.set({ phase: "uncertain", error: result.error ?? unknownError });
    }, isActive);
  }
  private cleanup(operation: PendingReopen) {
    try {
      removePendingReopen(this.deps.storage, operation);
      this.set({ confirmations: this.state.confirmations.map((item) => item.operation.commandId === operation.commandId ? { ...item, cleanupPending: false } : item) });
    } catch {
      this.set({ confirmations: this.state.confirmations.map((item) => item.operation.commandId === operation.commandId ? { ...item, cleanupPending: true } : item) });
    }
  }
  async retryConfirmation(commandId: string, isActive?: () => boolean) {
    await this.locked(() => {
      if (!this.readInventory()) return;
      const confirmation = this.state.confirmations.find((item) => item.operation.commandId === commandId && item.cleanupPending);
      if (confirmation) this.cleanup(confirmation.operation);
    }, isActive);
  }
  async refreshDashboard(refresh: () => void | Promise<void>) {
    if (!this.active || this.state.refreshing) return;
    const generation = this.generation; this.set({ refreshing: true, refreshError: undefined });
    try {
      await refresh();
      // Next router.refresh returns void. Only a relevant server panel read can
      // reconcile a stale cycle; dispatching invalidation is not acknowledgement.
      if (this.current(generation) && !this.state.blocks.some((item) => item.reason === "stale")) this.set({ refreshRequired: false });
    } catch {
      if (this.current(generation)) this.set({ refreshRequired: true, refreshError: "Dashboard refresh failed. Retry the refresh or reload the selected day." });
    } finally { if (this.current(generation)) this.set({ refreshing: false }); }
  }
}
