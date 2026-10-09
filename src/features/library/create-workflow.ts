import { clearBlockedCreateIdentity, clearCreateIdentity, prepareCreateIdentity, readCreateIdentity, type CreateIdentity } from "./create-identity";
import { normalizeBookFields, type Book, type BookFields } from "./model";
import type { CreateBookInput, LibraryActionResult, LibraryFailure, LibrarySaved } from "./contracts";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CreateNotice = "pending" | "absent" | "collision" | "invalidIdentity" | "accountChanged" |
  "storageUnavailable" | "existingUnavailable" | "cleanupFailed" | "existing" | "saved" | "savedRefresh" | "uncertain";
export type CreateState = {
  phase: "loading" | "form" | "blocked" | "pending" | "saved";
  busy: boolean; identity: CreateIdentity | null; notice: CreateNotice | null;
  failure: LibraryFailure | null; book?: Book; saved?: LibrarySaved;
};
type Ports = {
  storage: () => StoragePort; generateId: () => string;
  create: (input: CreateBookInput) => Promise<LibraryActionResult>;
  resolve: (input: { userId: string; bookId: string }) => Promise<LibraryActionResult>;
  rethrow: (error: unknown) => void;
  refresh: () => void; navigate: (id: string) => void;
};

// In-memory UI orchestration only. Identity persistence and validation remain L2's.
export function createBookWorkflow(userId: string, ports: Ports) {
  let state: CreateState = { phase: "loading", busy: false, identity: null, notice: "pending", failure: null };
  const initial = state;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<CreateState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  function storageFailure() { set({ phase: "blocked", notice: "storageUnavailable", failure: null }); }
  function read() {
    try { return readCreateIdentity(ports.storage(), userId); }
    catch { return { outcome: "storage_unavailable" } as const; }
  }
  function blocked(outcome: string) {
    set({ phase: "blocked", identity: null, failure: null, notice: outcome === "account_changed" ? "accountChanged" : outcome === "invalid_identity" ? "invalidIdentity" : "storageUnavailable" });
  }
  function cleanup(identity: CreateIdentity) {
    try { return clearCreateIdentity(ports.storage(), identity).outcome === "cleared"; }
    catch { return false; }
  }
  async function accept(result: LibraryActionResult, identity: CreateIdentity, resolving: boolean) {
    if (result.outcome === "success") {
      if (result.effect === "existing" && (!result.book || result.detailUnavailable)) {
        set({ phase: "pending", saved: result, notice: "existingUnavailable", failure: null });
        if (result.refreshRequired) ports.refresh();
        return;
      }
      const cleared = cleanup(identity);
      set({ phase: "saved", saved: result, book: result.book, failure: null,
        notice: !cleared ? "cleanupFailed" : result.effect === "existing" ? "existing" : result.refreshRequired ? "savedRefresh" : "saved" });
      if (result.refreshRequired) ports.refresh();
      // Existing identities require review of saved content, never a claim that
      // the newly entered payload was applied. Failed cleanup stays actionable.
      if (cleared && result.effect === "created" && !result.refreshRequired) ports.navigate(result.bookId);
      return;
    }
    if (result.outcome === "not_found") {
      set({ phase: "pending", failure: null, notice: resolving && !state.saved && state.notice !== "collision" ? "absent" : "collision" });
    } else if (result.outcome === "uncertain") {
      set({ phase: "pending", failure: null, notice: "uncertain" });
    } else {
      set({ phase: resolving ? "pending" : "form", failure: result, notice: null });
    }
  }
  async function resolve(identity: CreateIdentity) {
    set({ identity, phase: "pending", notice: state.notice === "collision" ? "collision" : "pending", failure: null });
    await accept(await ports.resolve({ userId, bookId: identity.bookId }), identity, true);
  }
  async function run(task: () => Promise<void>) {
    if (state.busy) return;
    set({ busy: true });
    try { await task(); }
    catch (error) { ports.rethrow(error); set({ phase: "pending", notice: "uncertain", failure: null }); }
    finally { set({ busy: false }); }
  }
  return {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    snapshot: () => state, initial: () => initial,
    initialize: () => run(async () => {
      const pending = read();
      if (pending.outcome === "empty") set({ phase: "form", notice: null, failure: null, identity: null });
      else if (pending.outcome === "ready") await resolve(pending.identity);
      else blocked(pending.outcome);
    }),
    check: () => run(async () => {
      const pending = read();
      if (pending.outcome === "ready") await resolve(pending.identity);
      else if (pending.outcome === "empty") storageFailure();
      else blocked(pending.outcome);
    }),
    submit: (fields: BookFields) => run(async () => {
      if (state.phase !== "form") return;
      const parsed = normalizeBookFields(fields, "create");
      if (!parsed.ok) { set({ failure: { outcome: "validation_error", field: parsed.field, code: parsed.code } }); return; }
      const pending = read();
      if (pending.outcome === "ready" && (!state.identity || pending.identity.bookId !== state.identity.bookId)) {
        await resolve(pending.identity); return;
      }
      if (state.identity && (pending.outcome !== "ready" || pending.identity.bookId !== state.identity.bookId)) {
        storageFailure(); return;
      }
      let prepared;
      try { prepared = prepareCreateIdentity(ports.storage(), userId, ports.generateId); }
      catch { storageFailure(); return; }
      if (prepared.outcome !== "ready") { blocked(prepared.outcome); return; }
      set({ identity: prepared.identity, notice: null, failure: null });
      await accept(await ports.create({ userId, bookId: prepared.identity.bookId, fields: parsed.value }), prepared.identity, false);
    }),
    continueSame: () => {
      if (!state.busy && state.phase === "pending" && state.notice === "absent") set({ phase: "form", notice: null, failure: null });
    },
    clearBlocked: () => run(async () => {
      if (state.phase !== "blocked") return;
      let result;
      try { result = clearBlockedCreateIdentity(ports.storage(), userId); }
      catch { storageFailure(); return; }
      if (result.outcome === "cleared") set({ phase: "form", identity: null, notice: null, failure: null });
      else if (result.outcome === "resolution_required") {
        const current = read();
        if (current.outcome === "ready") await resolve(current.identity);
        else blocked(current.outcome);
      } else blocked(result.outcome);
    }),
    resetAttempt: () => {
      if (state.busy || state.phase !== "pending" || !["absent", "collision"].includes(state.notice ?? "") || !state.identity) return;
      if (cleanup(state.identity)) set({ phase: "form", identity: null, notice: null, failure: null, saved: undefined, book: undefined });
      else storageFailure();
    },
    retryCleanup: () => {
      if (state.busy || state.phase !== "saved" || !state.identity || !state.saved) return;
      if (cleanup(state.identity)) set({ notice: state.saved.effect === "existing" ? "existing" : state.saved.refreshRequired ? "savedRefresh" : "saved" });
      else set({ notice: "cleanupFailed" });
    },
  };
}
