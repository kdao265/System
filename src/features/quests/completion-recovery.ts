import type { CompletionState } from "./completion-action";
import { persistPendingCompletion, readPendingCompletions, removePendingCompletion, type PendingCompletion, type CompletionRead } from "./completion-pending";

export type CompletionConfirmation = {
  operation: PendingCompletion;
  message: string;
  replay: boolean;
  cleanupPending: boolean;
};
export type RecoveryView = {
  phase: "recovering" | "ready" | "sending" | "uncertain" | "blocked";
  storage: CompletionRead["status"] | "unchecked";
  busy: boolean;
  accountChanged: boolean;
  operations: PendingCompletion[];
  confirmations: CompletionConfirmation[];
  refreshRequired: boolean;
  refreshing: boolean;
  refreshError?: string;
  error?: string;
};
export type RecoveryDependencies = {
  storage: () => Storage;
  lock: <T>(userId: string, work: () => Promise<T>) => Promise<T>;
  send: (previous: unknown, form: FormData) => Promise<CompletionState>;
  uuid: () => string;
};
export const COMPLETION_LOCK = "system.quest-completion";
const storageError = "Browser recovery storage or tab coordination is unavailable. Your saved requests are preserved; check recovery again.";
const corruptError = "Saved completion recovery data is unreadable or changed. Preserve the data and resolve the original requests before continuing.";
const unknownError = "The completion outcome is unknown. Retry the exact saved request to confirm it.";
const accountError = "Your account changed or your session ended. Refresh to continue with the signed-in account.";
const sameOperation = (a: PendingCompletion, b: PendingCompletion) => JSON.stringify(a) === JSON.stringify(b);
const sameIntent = (a: PendingCompletion, occurrenceId: string, cycle: number) => a.occurrenceId === occurrenceId && a.executionCycle === cycle;
type Intent = { kind: "new"; occurrenceId: string; executionCycle: number } | { kind: "retry"; operation: PendingCompletion };

/** Owned by one account-keyed Dashboard provider, never by individual rows. */
export class CompletionRecoveryLifecycle {
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = true;
  private readonly userId: string;
  private readonly deps: RecoveryDependencies;
  private state: RecoveryView = {
    phase: "recovering", storage: "unchecked", busy: false, accountChanged: false,
    operations: [], confirmations: [], refreshRequired: false, refreshing: false,
  };

  constructor(userId: string, deps: RecoveryDependencies) { this.userId = userId; this.deps = deps; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<RecoveryView>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  // React Strict Mode can replay the owner's effect. Keep its known inventory.
  activate() { this.active = true; this.set({ accountChanged: false }); }
  changeAccount(userId: string) { if (userId !== this.userId) this.deactivate(); }
  deactivate = () => {
    this.active = false;
    this.generation++;
    this.set({ phase: "blocked", busy: false, refreshing: false, accountChanged: true, error: accountError });
  };
  private current(generation: number) { return this.active && generation === this.generation; }
  private idlePhase() { return this.state.operations.length ? "uncertain" as const : "ready" as const; }

  /** Call only under COMPLETION_LOCK. Invalid reads never replace known memory. */
  private readInventory(): boolean {
    const read = readPendingCompletions(this.deps.storage, this.userId);
    if (read.status === "corrupt" || read.status === "unavailable") {
      this.set({ phase: "blocked", storage: read.status, error: read.status === "corrupt" ? corruptError : storageError });
      return false;
    }
    const stored = new Map(read.operations.map((operation) => [operation.commandId, operation]));
    for (const operation of this.state.operations) {
      const existing = stored.get(operation.commandId);
      if (existing && !sameOperation(existing, operation)) {
        this.set({ phase: "blocked", storage: "corrupt", error: corruptError });
        return false;
      }
      if (!existing) {
        persistPendingCompletion(this.deps.storage, operation);
        stored.set(operation.commandId, operation);
      }
    }
    for (const confirmation of this.state.confirmations) {
      const existing = stored.get(confirmation.operation.commandId);
      if (existing && !sameOperation(existing, confirmation.operation)) {
        this.set({ phase: "blocked", storage: "corrupt", error: corruptError });
        return false;
      }
    }
    const confirmedIds = new Set(this.state.confirmations.map((item) => item.operation.commandId));
    this.set({
      storage: stored.size ? "valid" : "missing",
      operations: [...stored.values()].filter((operation) => !confirmedIds.has(operation.commandId)),
      // A stale tab may restore a record we already confirmed. Only cleanup is needed.
      confirmations: this.state.confirmations.map((item) => stored.has(item.operation.commandId) ? { ...item, cleanupPending: true } : item),
    });
    return true;
  }

  /** One lock acquisition per operation; helpers inside it never acquire again. */
  private async locked(work: (generation: number) => Promise<void> | void, isActive: () => boolean = () => true) {
    if (!this.active || this.state.busy || !isActive()) return;
    const generation = this.generation;
    this.set({ busy: true });
    try {
      await this.deps.lock(this.userId, async () => {
        if (!this.current(generation) || !isActive()) return;
        await work(generation);
      });
    } catch {
      if (this.current(generation)) this.set({ phase: "blocked", storage: "unavailable", error: storageError });
    } finally {
      if (this.current(generation)) this.set({ busy: false });
    }
  }

  async recover() {
    await this.locked(() => {
      if (this.readInventory()) this.set({ phase: this.idlePhase(), error: undefined });
    });
  }

  async submitForOccurrence(occurrenceId: string, executionCycle: number, isActive?: () => boolean) {
    await this.execute({ kind: "new", occurrenceId, executionCycle }, isActive);
  }
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
      if (!this.readInventory()) return;
      if (!this.current(generation) || (isActive && !isActive())) return;
      if (intent.kind === "new") {
        if (this.state.operations.some((item) => sameIntent(item, intent.occurrenceId, intent.executionCycle))) {
          this.set({ phase: "uncertain", error: "This Quest has a saved completion request. Retry that exact request to confirm it." });
          return;
        }
        if (this.state.confirmations.some((item) => sameIntent(item.operation, intent.occurrenceId, intent.executionCycle))) {
          this.set({ phase: this.idlePhase(), refreshRequired: true });
          return;
        }
      }
      const operation: PendingCompletion = intent.kind === "retry" ? intent.operation : {
        version: 1, userId: this.userId, commandId: this.deps.uuid(), occurrenceId: intent.occurrenceId,
        executionCycle: intent.executionCycle, reportedCompletedAt: null, origin: "web_ui",
      };
      if (intent.kind === "new") persistPendingCompletion(this.deps.storage, operation);
      this.set({ phase: "sending", error: undefined, operations: [operation, ...this.state.operations.filter((item) => item.commandId !== operation.commandId)] });
      const form = new FormData();
      form.set("expected_account", this.userId);
      form.set("command_id", operation.commandId);
      form.set("occurrence_id", operation.occurrenceId);
      form.set("execution_cycle", String(operation.executionCycle));
      let result: CompletionState;
      try { result = await this.deps.send({}, form); }
      catch { result = { outcome: "unknown", error: unknownError }; }
      // Row removal cannot cancel an already-dispatched effect. The owner settles it.
      if (!this.current(generation)) return;
      if (result.outcome === "success") {
        this.set({
          confirmations: [...this.state.confirmations, { operation, message: result.success.message, replay: result.success.replay, cleanupPending: true }],
          operations: this.state.operations.filter((item) => item.commandId !== operation.commandId),
          refreshRequired: this.state.refreshRequired || result.refreshRequired,
        });
        this.cleanup(operation);
        this.set({ phase: this.idlePhase() });
      } else if (result.outcome === "rejected" && result.reason === "account") {
        this.deactivate();
      } else if (result.outcome === "rejected" && intent.kind === "new") {
        // Only a first attempt's definitive rejection can discard an unaccepted request.
        removePendingCompletion(this.deps.storage, operation);
        this.set({ operations: this.state.operations.filter((item) => item.commandId !== operation.commandId), error: result.error });
        this.set({ phase: this.idlePhase() });
      } else {
        // A rejected retry is not proof that the original attempt did not commit.
        this.set({ phase: "uncertain", error: result.error ?? unknownError });
      }
    }, isActive);
  }

  private cleanup(operation: PendingCompletion) {
    try {
      removePendingCompletion(this.deps.storage, operation);
      this.set({ confirmations: this.state.confirmations.map((item) => item.operation.commandId === operation.commandId ? { ...item, cleanupPending: false } : item) });
    } catch {
      // Keep this command's validated historical confirmation and its cleanup control.
      this.set({ confirmations: this.state.confirmations.map((item) => item.operation.commandId === operation.commandId ? { ...item, cleanupPending: true } : item) });
    }
  }
  async retryConfirmation(commandId: string, isActive?: () => boolean) {
    await this.locked(() => {
      const confirmation = this.state.confirmations.find((item) => item.operation.commandId === commandId && item.cleanupPending);
      if (confirmation) this.cleanup(confirmation.operation);
    }, isActive);
  }

  /** The caller supplies actual router refresh, never an inventory read or mutation. */
  async refreshDashboard(refresh: () => void | Promise<void>) {
    if (!this.active || this.state.refreshing) return;
    const generation = this.generation;
    this.set({ refreshing: true, refreshError: undefined });
    try {
      await refresh();
      if (this.current(generation)) this.set({ refreshRequired: false });
    } catch {
      if (this.current(generation)) this.set({ refreshRequired: true, refreshError: "Completion is confirmed, but Dashboard refresh failed. Retry the refresh." });
    } finally {
      if (this.current(generation)) this.set({ refreshing: false });
    }
  }
}
