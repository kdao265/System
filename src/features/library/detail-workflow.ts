import { canEditBook, normalizeBookFields, type Book, type BookFields, type BookStatus } from "./model";
import type { EditBookInput, LibraryActionResult, LibraryFailure, LibraryRead, LibrarySaved, RevisionInput } from "./contracts";

export const fieldsOf = (book: Book): BookFields => ({ title: book.title, author: book.author, cover_url: book.cover_url,
  status: book.status, summary: book.summary, content_notes: book.content_notes, lessons: book.lessons });
export type DetailState = {
  book: Book; draft: BookFields; editing: boolean; busy: boolean;
  failure: LibraryFailure | null; saved: LibrarySaved | null; latest: Book | null;
  review: boolean; readFailed: boolean; needsRefresh: boolean;
};
type Ports = {
  edit: (input: EditBookInput) => Promise<LibraryActionResult>;
  status: (input: RevisionInput & { status: BookStatus }) => Promise<LibraryActionResult>;
  archive: (input: RevisionInput) => Promise<LibraryActionResult>;
  restore: (input: RevisionInput) => Promise<LibraryActionResult>;
  read: (id: string) => Promise<LibraryRead<Book>>;
  refresh: () => void; rethrow: (error: unknown) => void;
};

// Draft/base revisions live only in this mounted workspace. Authoritative refresh
// never rebases an unsaved draft; the user explicitly accepts a newer base.
export function createDetailWorkflow(book: Book, ports: Ports) {
  let state: DetailState = { book, draft: fieldsOf(book), editing: false, busy: false, failure: null,
    saved: null, latest: null, review: false, readFailed: false, needsRefresh: false };
  const initial = state;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DetailState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const base = (): RevisionInput => ({ userId: book.user_id, bookId: book.id, expected_revision: state.book.revision });
  async function read(adopt: boolean) {
    const result = await ports.read(book.id);
    if (result.outcome === "success" && result.value.id === book.id && result.value.user_id === book.user_id) {
      if (adopt) set({ book: result.value, draft: fieldsOf(result.value), editing: false, needsRefresh: false, readFailed: false, latest: null });
      else set({ latest: result.value, readFailed: false });
    } else set({ readFailed: true });
  }
  async function run(task: () => Promise<void>) {
    if (state.busy) return;
    set({ busy: true });
    try { await task(); }
    catch (error) {
      ports.rethrow(error);
      // A read failure after a save cannot erase the successful acknowledgement.
      if (state.saved) set({ readFailed: true, needsRefresh: true });
      else set({ review: true, failure: { outcome: "uncertain", bookId: book.id, retryAllowed: false } });
    } finally { set({ busy: false }); }
  }
  async function mutate(action: () => Promise<LibraryActionResult>) {
    if (state.review || state.needsRefresh) return;
    set({ failure: null, saved: null, latest: null, readFailed: false });
    const result = await action();
    if (result.outcome === "success") {
      set({ saved: result, needsRefresh: true, editing: false });
      ports.refresh();
      await read(true);
    } else {
      set({ failure: result });
      if (result.outcome === "conflict" || result.outcome === "uncertain") {
        set({ review: true });
        await read(false);
      }
    }
  }
  return {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    snapshot: () => state, initial: () => initial,
    edit: () => { if (!state.busy && !state.review && !state.needsRefresh && canEditBook(state.book)) set({ editing: true, draft: fieldsOf(state.book), saved: null, failure: null }); },
    draft: (draft: BookFields) => { if (!state.busy) set({ draft }); },
    cancel: () => { if (!state.busy && !state.review) set({ editing: false, draft: fieldsOf(state.book), failure: null }); },
    save: () => run(async () => {
      if (!state.editing || !canEditBook(state.book)) return;
      const parsed = normalizeBookFields(state.draft, "create");
      if (!parsed.ok) { set({ failure: { outcome: "validation_error", field: parsed.field, code: parsed.code } }); return; }
      await mutate(() => ports.edit({ ...base(), changes: parsed.value }));
    }),
    status: (status: BookStatus) => run(async () => {
      if (!state.editing && canEditBook(state.book)) await mutate(() => ports.status({ ...base(), status }));
    }),
    archive: () => run(async () => { if (!state.editing && canEditBook(state.book)) await mutate(() => ports.archive(base())); }),
    restore: () => run(async () => { if (!state.editing && !canEditBook(state.book)) await mutate(() => ports.restore(base())); }),
    check: () => run(async () => { await read(!!state.saved || (!state.editing && !state.review)); }),
    acceptLatest: (keepDraft: boolean) => {
      if (state.busy || !state.latest || (keepDraft && !canEditBook(state.latest))) return;
      set({ book: state.latest, draft: keepDraft ? state.draft : fieldsOf(state.latest), editing: keepDraft,
        latest: null, review: false, failure: null, readFailed: false, needsRefresh: false, saved: null });
    },
  };
}
