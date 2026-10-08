"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getBook, libraryContext, readFailure } from "./data";
import { isBookStatus, parseBookMutation, type BookFields } from "./model";
import {
  invalid, keysAre, validateCreate, validateEdit, validateIdentity, validateRevision,
  type LibraryActionResult, type LibrarySaved, type RevisionInput,
} from "./contracts";

async function refreshed(saved: Omit<LibrarySaved, "refreshRequired">): Promise<LibrarySaved> {
  let refreshRequired = false;
  for (const path of ["/library", `/library/${saved.bookId}`]) {
    try { revalidatePath(path); } catch (error) { unstable_rethrow(error); refreshRequired = true; }
  }
  return { ...saved, refreshRequired };
}

// Reload lookup is read-only and never dispatches create. Supplied account IDs
// bind intent to the verified account; they cannot authorize access.
export async function resolveBookCreate(input: unknown): Promise<LibraryActionResult> {
  const context = await libraryContext();
  if (context.outcome !== "success") return context;
  if (!validateIdentity(input) || !keysAre(input, ["userId", "bookId"])) return invalid();
  if (input.userId.toLowerCase() !== context.userId) return { outcome: "unauthorized" };
  const current = await getBook(input.bookId);
  if (current.outcome !== "success") return current;
  return refreshed({ outcome: "success", bookId: current.value.id, revision: current.value.revision,
    effect: "existing", evidence: "current_state", book: current.value });
}

export async function createBook(input: unknown): Promise<LibraryActionResult> {
  const context = await libraryContext();
  if (context.outcome !== "success") return context;
  const parsed = validateCreate(input);
  if (!parsed.ok) return invalid(parsed.field, parsed.code);
  const { userId, bookId, fields } = parsed.value;
  if (userId !== context.userId) return { outcome: "unauthorized" };
  let dispatched = false;
  try {
    const client = await createServerSupabaseClient();
    dispatched = true;
    const { data, error } = await client.rpc("create_book_v1", { p_book_id: bookId, p_fields: fields });
    if (error) {
      if (["P0002", "42501", "PGRST301", "PGRST303"].includes(error.code)) return readFailure(error);
      if (["22023", "22P02", "22P05"].includes(error.code)) return invalid();
    } else {
      const ack = parseBookMutation(data);
      if (ack?.book_id === bookId && (ack.outcome === "created" || ack.outcome === "existing")) {
        // Existing means identity only: submitted fields were NOT applied. A later
        // detail failure must not erase the successful immediate acknowledgement.
        const current = ack.outcome === "existing" ? await getBook(bookId) : null;
        return refreshed({ outcome: "success", bookId, revision: ack.revision,
          effect: ack.outcome, evidence: "acknowledged",
          ...(current?.outcome === "success" ? { book: current.value } : current ? { detailUnavailable: true as const } : {}) });
      }
    }
  } catch (error) {
    unstable_rethrow(error);
    if (!dispatched) return { outcome: "infrastructure_failure" };
  }
  const current = await getBook(bookId);
  if (current.outcome === "success") return refreshed({ outcome: "success", bookId,
    revision: current.value.revision, effect: "existing", evidence: "current_state", book: current.value });
  // Absence cannot prove rollback: the original request may still be in flight.
  return { outcome: "uncertain", bookId, retryAllowed: current.outcome === "not_found" };
}

async function changeBook(base: RevisionInput, desired: { changes: Partial<BookFields> } | { archived: boolean }): Promise<LibraryActionResult> {
  let dispatched = false;
  let constraintRejected = false;
  try {
    const client = await createServerSupabaseClient();
    dispatched = true;
    const { data, error } = await client.rpc("changes" in desired ? "update_book_v1" : "set_book_archived_v1", {
      p_book_id: base.bookId, p_expected_revision: base.expected_revision,
      ...("changes" in desired ? { p_changes: desired.changes } : { p_archived: desired.archived }),
    });
    if (error) {
      if (["P0002", "42501", "PGRST301", "PGRST303"].includes(error.code)) return readFailure(error);
      if (["22023", "22P02", "22P05"].includes(error.code)) return invalid();
      constraintRejected = error.code === "23514";
    } else {
      const ack = parseBookMutation(data);
      if (ack?.book_id === base.bookId &&
          ((ack.outcome === "unchanged" && ack.revision === base.expected_revision) ||
           (ack.outcome === "updated" && BigInt(ack.revision) === BigInt(base.expected_revision) + BigInt(1)))) {
        return refreshed({ outcome: "success", bookId: base.bookId, revision: ack.revision,
          effect: ack.outcome, evidence: "acknowledged" });
      }
    }
  } catch (error) {
    unstable_rethrow(error);
    if (!dispatched) return { outcome: "infrastructure_failure" };
  }
  const current = await getBook(base.bookId);
  if (constraintRejected) {
    // A definite stale rejection never becomes success just because values match.
    if (current.outcome !== "success") return { outcome: "conflict", reason: "review_required" };
    const book = current.value;
    return { outcome: "conflict", revision: book.revision, reason: book.revision !== base.expected_revision
      ? "stale_revision" : "changes" in desired && book.archived_at !== null ? "archived" : "review_required" };
  }
  if (current.outcome !== "success") return { outcome: "uncertain", bookId: base.bookId, retryAllowed: false };
  const book = current.value;
  const revision = BigInt(book.revision), expected = BigInt(base.expected_revision);
  const matches = "changes" in desired
    ? book.archived_at === null && Object.entries(desired.changes).every(([key, value]) => book[key as keyof BookFields] === value)
    : (book.archived_at !== null) === desired.archived;
  // Observe only current state at the base or its immediate successor. Later
  // revisions require review even if values happen to match. Never replay here.
  if (matches && (revision === expected || revision === expected + BigInt(1))) {
    return refreshed({ outcome: "success", bookId: base.bookId, revision: book.revision,
      effect: "observed", evidence: "current_state" });
  }
  if (revision !== expected || ("changes" in desired && book.archived_at !== null)) {
    return { outcome: "conflict", reason: "review_required", revision: book.revision };
  }
  return { outcome: "uncertain", bookId: base.bookId, retryAllowed: true };
}

export async function editBook(input: unknown): Promise<LibraryActionResult> {
  const context = await libraryContext();
  if (context.outcome !== "success") return context;
  const parsed = validateEdit(input);
  if (!parsed.ok) return invalid(parsed.field, parsed.code);
  if (parsed.value.userId !== context.userId) return { outcome: "unauthorized" };
  return changeBook(parsed.value, { changes: parsed.value.changes });
}

export async function setBookStatus(input: unknown): Promise<LibraryActionResult> {
  const context = await libraryContext();
  if (context.outcome !== "success") return context;
  const parsed = validateRevision(input, ["status"]);
  if (!parsed.ok) return invalid(parsed.field, parsed.code);
  if (parsed.value.userId !== context.userId) return { outcome: "unauthorized" };
  const status = (input as Record<string, unknown>).status;
  if (!isBookStatus(status)) return invalid("status", "status");
  return changeBook(parsed.value, { changes: { status } });
}

async function setArchived(input: unknown, archived: boolean): Promise<LibraryActionResult> {
  const context = await libraryContext();
  if (context.outcome !== "success") return context;
  const parsed = validateRevision(input);
  if (!parsed.ok) return invalid(parsed.field, parsed.code);
  if (parsed.value.userId !== context.userId) return { outcome: "unauthorized" };
  return changeBook(parsed.value, { archived });
}
export async function archiveBook(input: unknown): Promise<LibraryActionResult> { return setArchived(input, true); }
export async function restoreBook(input: unknown): Promise<LibraryActionResult> { return setArchived(input, false); }
