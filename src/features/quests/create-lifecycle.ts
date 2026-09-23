import type { QuestCreationState } from "./create-action";
import { draftFromPending, emptyDraft, requestFromDraft, type QuestDraft } from "./create-draft";
import { persistPending, readPendingCreations, removePending, type PendingCreation, type StorageAccess, type PendingRead } from "./create-pending";

export type CreationView = {
  phase: "recovering" | "ready" | "sending" | "uncertain" | "blocked";
  storage: PendingRead["status"] | "unchecked";
  accountChanged: boolean;
  draft: QuestDraft;
  draftTimezone: string;
  profileTimezone: string;
  operations: PendingCreation[];
  error?: string;
  message?: string;
};
export type CreationDependencies = {
  storage: StorageAccess;
  lock: <T>(userId: string, work: () => Promise<T>) => Promise<T>;
  send: (previous: unknown, data: FormData) => Promise<QuestCreationState>;
  uuid: () => string;
};
const storageError = "Browser recovery storage or tab coordination is unavailable or could not be verified. No new request will be sent. Use a supported secure browser with storage enabled, then check recovery again.";
const corruptError = "Saved Quest recovery data is corrupt or from an older version. Creation is blocked; preserve the data and resolve the original command before continuing.";

/** The form and Node tests use this same lifecycle. All tab mutations share a browser lock. */
export class QuestCreationLifecycle {
  private listeners = new Set<() => void>();
  private generation = 0;
  private busy = false;
  private state: CreationView;
  private userId: string;
  private deps: CreationDependencies;
  constructor(userId: string, timezone: string, deps: CreationDependencies) {
    this.deps = deps;
    this.userId = userId;
    this.state = this.initial(timezone);
  }
  private initial(timezone: string): CreationView {
    return { phase: "recovering", storage: "unchecked", accountChanged: false, draft: { ...emptyDraft }, draftTimezone: timezone, profileTimezone: timezone, operations: [] };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<CreationView>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  changeAccount(userId: string, timezone: string) {
    this.generation++;
    this.busy = false;
    this.userId = userId;
    this.state = this.initial(timezone);
    this.set({});
  }
  deactivate = () => {
    this.generation++;
    this.busy = false;
    this.state = this.initial(this.state.profileTimezone);
    this.set({ phase: "blocked", accountChanged: true, error: "Your account changed or your session ended. Refresh to continue with the signed-in account." });
  };
  profileChanged(timezone: string) { if (timezone !== this.state.profileTimezone) this.set({ profileTimezone: timezone }); }
  reviewTimezone() {
    if (this.state.phase === "ready") this.set({ draftTimezone: this.state.profileTimezone, error: undefined });
  }
  updateDraft<K extends keyof QuestDraft>(name: K, value: QuestDraft[K]) {
    if (this.state.phase === "ready") this.set({ draft: { ...this.state.draft, [name]: value }, error: undefined, message: undefined });
  }
  private applyRead(read: PendingRead, restoreDraft = false) {
    if (read.status === "unavailable" || read.status === "corrupt") {
      this.set({ phase: "blocked", storage: read.status, error: read.status === "corrupt" ? corruptError : storageError });
      return false;
    }
    const first = read.operations[0];
    this.set({ storage: read.status, operations: read.operations, phase: first ? "uncertain" : "ready",
      ...(restoreDraft && first ? { draft: draftFromPending(first), draftTimezone: first.timezone } : {}) });
    return true;
  }
  async recover() {
    if (this.busy || this.state.accountChanged) return;
    this.busy = true;
    const generation = this.generation;
    const userId = this.userId;
    this.set({ phase: "recovering", error: undefined });
    try {
      await this.deps.lock(userId, async () => {
        if (generation !== this.generation) return;
        let read = readPendingCreations(this.deps.storage, userId);
        if (read.status === "missing" || read.status === "valid") {
          // Another tab may have resolved it, or storage may have been cleared.
          // Restore known IDs and confirm by replay, never allocate replacements.
          for (const operation of this.state.operations) {
            const stored = read.operations.find((item) => item.commandId === operation.commandId);
            if (stored && JSON.stringify(stored) !== JSON.stringify(operation)) {
              this.set({ phase: "blocked", storage: "corrupt", error: corruptError });
              return;
            }
            if (!stored) persistPending(this.deps.storage, operation);
          }
          read = readPendingCreations(this.deps.storage, userId);
        }
        this.applyRead(read, true);
      });
    } catch { if (generation === this.generation) this.set({ phase: "blocked", error: storageError }); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async submit() {
    if (this.busy || this.state.phase !== "ready") return;
    const normalized = requestFromDraft(this.state.draft, this.state.draftTimezone);
    if (!normalized.request) { this.set({ error: normalized.error }); return; }
    await this.execute("new", () => ({ version: 2, userId: this.userId, commandId: this.deps.uuid(), timezone: this.state.draftTimezone, request: normalized.request }));
  }
  async retry(commandId: string) {
    if (this.busy || this.state.phase !== "uncertain") return;
    const known = this.state.operations.find((operation) => operation.commandId === commandId);
    if (!known || known.userId !== this.userId) return;
    await this.execute("retry", () => known);
  }
  private async execute(mode: "new" | "retry", snapshot: () => PendingCreation) {
    this.busy = true;
    const generation = this.generation;
    const userId = this.userId;
    this.set({ phase: "sending", error: undefined, message: undefined });
    try {
      await this.deps.lock(userId, async () => {
        if (generation !== this.generation) return;
        const read = readPendingCreations(this.deps.storage, userId);
        if (!this.applyRead(read)) return;
        if (mode === "new" && read.operations.length) {
          this.set({ error: "Another tab has a pending request. Resolve the saved request before starting another." });
          return;
        }
        const operation = snapshot();
        if (mode === "retry") {
          const stored = read.operations.find((item) => item.commandId === operation.commandId);
          if (!stored) persistPending(this.deps.storage, operation);
          else if (JSON.stringify(stored) !== JSON.stringify(operation)) {
            this.set({ phase: "blocked", error: "This pending request was changed or resolved in another tab. Check recovery before continuing.", operations: [operation, ...read.operations.filter((item) => item.commandId !== operation.commandId)] });
            return;
          }
        } else {
          persistPending(this.deps.storage, operation);
        }
        this.set({ phase: "sending", storage: "valid", operations: [operation, ...read.operations.filter((item) => item.commandId !== operation.commandId)] });
        const form = new FormData();
        form.set("expected_account", userId);
        form.set("command_id", operation.commandId);
        form.set("timezone", operation.timezone);
        form.set("mode", mode);
        form.set("request_json", JSON.stringify(operation.request));
        let result: QuestCreationState;
        try { result = await this.deps.send({}, form); }
        catch { result = { outcome: "unknown", error: "Connection lost. The creation outcome is unknown; retry the exact saved request." }; }
        // A response for the old account must not mutate either account's current UI or records.
        if (generation !== this.generation) return;
        if (result.outcome === "success" || (mode === "new" && result.outcome === "rejected")) {
          removePending(this.deps.storage, operation);
          const remaining = readPendingCreations(this.deps.storage, userId);
          if (!this.applyRead(remaining)) return;
          if (result.outcome === "success") {
            this.set({ draft: { ...emptyDraft }, draftTimezone: this.state.profileTimezone, message: result.success?.message });
          } else {
            this.set({ error: result.error, ...(result.currentTimezone ? { profileTimezone: result.currentTimezone } : {}) });
          }
        } else {
          this.set({ phase: "uncertain", error: result.error ?? "The outcome is unknown. Retry the exact saved request." });
        }
        if (result.reason === "account") this.deactivate();
      });
    } catch {
      if (generation === this.generation) this.set({ phase: "blocked", storage: "unavailable", error: storageError });
    } finally { if (generation === this.generation) this.busy = false; }
  }
}
