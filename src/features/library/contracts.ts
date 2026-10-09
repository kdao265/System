import {
  isBookCursor, isBookId, isBookStatus, isLibraryScope, isRevision,
  LIBRARY_MAX_PAGE_SIZE, LIBRARY_PAGE_SIZE, normalizeBookFields,
  type Book, type BookCursor, type BookFields, type BookStatus, type LibraryScope, type Validation,
} from "./model";

// Serializable, feature-local contracts. Failures never echo drafts or SQL messages.
export type LibraryFailure =
  | { outcome: "validation_error"; field: string; code: string }
  | { outcome: "unauthorized" | "onboarding_required" | "not_found" | "infrastructure_failure" }
  | { outcome: "conflict"; reason: "stale_revision" | "archived" | "review_required"; revision?: string }
  | { outcome: "uncertain"; bookId: string; retryAllowed: boolean };
export type LibrarySaved = {
  outcome: "success"; bookId: string; revision: string;
  effect: "created" | "existing" | "updated" | "unchanged" | "observed";
  evidence: "acknowledged" | "current_state"; refreshRequired: boolean;
  book?: Book; detailUnavailable?: true;
};
export type LibraryActionResult = LibrarySaved | LibraryFailure;
export type LibraryRead<T> = { outcome: "success"; value: T } | LibraryFailure;
export type LibraryListInput = { scope: LibraryScope; status: BookStatus | null; cursor: BookCursor | null; limit: number };
export type CreateBookInput = { userId: string; bookId: string; fields: BookFields };
export type EditBookInput = { userId: string; bookId: string; expected_revision: string; changes: Partial<BookFields> };
export type RevisionInput = Pick<EditBookInput, "userId" | "bookId" | "expected_revision">;

export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const keysAre = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const invalid = (field = "request", code = "shape"): LibraryFailure => ({ outcome: "validation_error", field, code });
const bad = (field = "request"): Validation<never> => ({ ok: false, field, code: "shape" });

export function validateList(input: unknown): Validation<LibraryListInput> {
  if (!object(input) || Object.keys(input).some(k => !["scope", "status", "cursor", "limit"].includes(k))) return bad();
  const scope = input.scope === undefined ? "active" : input.scope;
  const status = input.status === undefined ? null : input.status;
  const cursor = input.cursor === undefined ? null : input.cursor;
  const limit = input.limit === undefined ? LIBRARY_PAGE_SIZE : input.limit;
  if (!isLibraryScope(scope)) return bad("scope");
  if (status !== null && !isBookStatus(status)) return bad("status");
  if (cursor !== null && !isBookCursor(cursor)) return bad("cursor");
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > LIBRARY_MAX_PAGE_SIZE) return bad("limit");
  return { ok: true, value: { scope, status, cursor, limit } };
}

export function validateIdentity(input: unknown): input is { userId: string; bookId: string } {
  return object(input) && isBookId(input.userId) && isBookId(input.bookId);
}
export function validateCreate(input: unknown): Validation<CreateBookInput> {
  if (!validateIdentity(input) || !keysAre(input, ["userId", "bookId", "fields"])) return bad();
  const fields = normalizeBookFields((input as Record<string, unknown>).fields, "create");
  return fields.ok ? { ok: true, value: { userId: input.userId.toLowerCase(), bookId: input.bookId.toLowerCase(), fields: fields.value } } : fields;
}
export function validateRevision(input: unknown, extra: string[] = []): Validation<RevisionInput> {
  if (!validateIdentity(input) || !keysAre(input, ["userId", "bookId", "expected_revision", ...extra]) ||
      !isRevision((input as Record<string, unknown>).expected_revision)) return bad();
  return { ok: true, value: { userId: input.userId.toLowerCase(), bookId: input.bookId.toLowerCase(), expected_revision: (input as Record<string, unknown>).expected_revision as string } };
}
export function validateEdit(input: unknown): Validation<EditBookInput> {
  const base = validateRevision(input, ["changes"]);
  if (!base.ok) return base;
  const changes = normalizeBookFields((input as Record<string, unknown>).changes, "update");
  return changes.ok ? { ok: true, value: { ...base.value, changes: changes.value } } : changes;
}
