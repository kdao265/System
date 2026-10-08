// ADR-023: pure Library vocabulary and boundaries. No UI, transport or persistence.
export const BOOK_STATUSES = ["want_to_read", "reading", "finished"] as const;
export type BookStatus = typeof BOOK_STATUSES[number];
export const DEFAULT_BOOK_STATUS: BookStatus = "want_to_read";
export const BOOK_LIMITS = { title: 240, author: 240, cover_url: 2048, summary: 4000, content_notes: 20000, lessons: 10000 } as const;
export const LIBRARY_PAGE_SIZE = 50;
export const LIBRARY_MAX_PAGE_SIZE = 100;
export const MAX_REVISION = BigInt("9223372036854775807");
export type LibraryScope = "active" | "archived";
export type LibraryFilter = { scope: LibraryScope; status: BookStatus | null };
export type BookFields = { title: string; author: string | null; cover_url: string | null; status: BookStatus; summary: string | null; content_notes: string | null; lessons: string | null };
export type BookSummary = Pick<BookFields, "title" | "author" | "cover_url" | "status"> & {
  id: string; archived_at: string | null; revision: string; created_at: string; updated_at: string;
};
export type Book = BookSummary & Pick<BookFields, "summary" | "content_notes" | "lessons"> & { user_id: string };
export type BookCursor = { created_at: string; id: string };
export type BookPage = { version: 1; books: BookSummary[]; next_cursor: BookCursor | null };
export type BookMutation = { version: 1; book_id: string; revision: string; changed: boolean; outcome: "created" | "existing" | "updated" | "unchanged" };
export type Validation<T> = { ok: true; value: T } | { ok: false; field: string; code: "shape" | "text" | "required" | "limit" | "url" | "status" };

const fields = ["title", "author", "cover_url", "status", "summary", "content_notes", "lessons"] as const;
const whitespace = "\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const edges = new RegExp(`^[${whitespace}]+|[${whitespace}]+$`, "gu");
const urlForbidden = new RegExp(`[${whitespace}\\u0000-\\u001f\\u007f-\\u009f\\\\]`, "u");
export const trimBookText = (value: string) => value.replace(edges, "");
export const characterCount = (value: string) => [...value].length;
export const isBookStatus = (value: unknown): value is BookStatus => typeof value === "string" && BOOK_STATUSES.some(s => s === value);
export const isBookId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const isRevision = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= MAX_REVISION;
export const isLibraryScope = (value: unknown): value is LibraryScope => value === "active" || value === "archived";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const validText = (s: string) => !s.includes("\0") && !/[\ud800-\udfff]/u.test(s); // PostgreSQL UTF-8 cannot store NUL or lone surrogates.

// A deliberately shared safe URL subset: ASCII DNS/punycode, canonical IPv4 or
// bracketed IPv6; optional decimal port. Unicode is allowed in path/query/fragment.
// Never fetch, resolve DNS, or canonicalize a user's URL as a validation side effect.
export function isCoverUrl(value: unknown): value is string {
  if (typeof value !== "string" || !validText(value) || characterCount(value) > BOOK_LIMITS.cover_url || urlForbidden.test(value)) return false;
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value)?.[1];
  if (!authority || authority.includes("@")) return false;
  const parts = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(authority);
  if (!parts || (parts[2] && Number(parts[2]) > 65535)) return false;
  const host = parts[1];
  if (!host.startsWith("[")) {
    const dns = host.replace(/\.$/, "");
    if (dns.length > 253 || !dns.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return false;
    const last = dns.split(".").at(-1)!;
    if (/^[0-9]+$/.test(last) || /^0x[0-9a-f]+$/i.test(last)) {
      const octets = dns.split(".");
      if (host !== dns || octets.length !== 4 || !octets.every(s => /^(0|[1-9][0-9]{0,2})$/.test(s) && Number(s) <= 255)) return false;
    }
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function normalizeBookFields(input: unknown, mode: "create"): Validation<BookFields>;
export function normalizeBookFields(input: unknown, mode: "update"): Validation<Partial<BookFields>>;
export function normalizeBookFields(input: unknown, mode: "create" | "update"): Validation<Partial<BookFields>> {
  if (!record(input) || Object.keys(input).some(k => !fields.some(f => f === k)) || (mode === "update" && !Object.keys(input).length)) return { ok: false, field: "request", code: "shape" };
  const out: Partial<BookFields> = {};
  for (const field of fields) {
    if (mode === "update" && !Object.hasOwn(input, field)) continue;
    const raw = Object.hasOwn(input, field) ? input[field] : field === "status" ? DEFAULT_BOOK_STATUS : null;
    if (field === "status") {
      if (!isBookStatus(raw)) return { ok: false, field, code: "status" };
      out.status = raw; continue;
    }
    if (raw !== null && (typeof raw !== "string" || !validText(raw))) return { ok: false, field, code: "text" };
    const long = field === "summary" || field === "content_notes" || field === "lessons";
    const normalized = typeof raw === "string" ? long ? raw.replace(/\r\n?/g, "\n") : trimBookText(raw) : null;
    const value = normalized !== null && trimBookText(normalized) !== "" ? normalized : null;
    if (field === "title") {
      if (value === null) return { ok: false, field, code: "required" };
      out.title = value;
    } else out[field] = value;
    if (value !== null && characterCount(value) > BOOK_LIMITS[field]) return { ok: false, field, code: "limit" };
    if (field === "cover_url" && value !== null && !isCoverUrl(value)) return { ok: false, field, code: "url" };
  }
  return { ok: true, value: out };
}

// Preserve PostgreSQL microseconds when validating keyset order. Date.parse alone
// truncates to milliseconds and can incorrectly reorder rows in the same millisecond.
function instant(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!m) return null;
  const [y, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (y < 1 || month < 1 || month > 12 || day < 1 || day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[8]}`);
  return Number.isFinite(ms) ? BigInt(ms) * BigInt(1000) + BigInt((m[7] ?? "").padEnd(6, "0")) : null;
}
const summaryKeys = ["id", "title", "author", "cover_url", "status", "archived_at", "revision", "created_at", "updated_at"];
function validSummary(v: Record<string, unknown>) {
  const metadata = normalizeBookFields({ title: v.title, author: v.author, cover_url: v.cover_url, status: v.status }, "create");
  if (!metadata.ok || !["title", "author", "cover_url", "status"].every(k => metadata.value[k as keyof BookFields] === v[k])) return false;
  const created = instant(v.created_at), updated = instant(v.updated_at), archived = instant(v.archived_at);
  return isBookId(v.id) && isRevision(v.revision) && created !== null && updated !== null && updated >= created &&
    (v.archived_at === null || (archived !== null && archived >= created && archived <= updated));
}
export function parseBookSummary(value: unknown): BookSummary | null {
  return record(value) && exactKeys(value, summaryKeys) && validSummary(value) ? value as BookSummary : null;
}
export function parseBook(value: unknown): Book | null {
  if (!record(value) || !exactKeys(value, [...summaryKeys, "user_id", "summary", "content_notes", "lessons"]) || !validSummary(value) || !isBookId(value.user_id)) return null;
  const normalized = normalizeBookFields(Object.fromEntries(fields.map(k => [k, value[k]])), "create");
  return normalized.ok && fields.every(k => normalized.value[k] === value[k]) ? value as Book : null;
}
export function parseBookDetail(value: unknown): Book | null {
  return record(value) && exactKeys(value, ["version", "book"]) && value.version === 1 ? parseBook(value.book) : null;
}
export function isBookCursor(value: unknown): value is BookCursor {
  return record(value) && exactKeys(value, ["created_at", "id"]) && instant(value.created_at) !== null && isBookId(value.id);
}
export function parseBookPage(value: unknown): BookPage | null {
  if (!record(value) || !exactKeys(value, ["version", "books", "next_cursor"]) || value.version !== 1 || !Array.isArray(value.books) || value.books.length > LIBRARY_MAX_PAGE_SIZE || (value.next_cursor !== null && !isBookCursor(value.next_cursor))) return null;
  const ids = new Set<string>();
  let previous: BookSummary | null = null;
  for (const raw of value.books) {
    const row = parseBookSummary(raw);
    if (!row || ids.has(row.id.toLowerCase())) return null;
    if (previous) {
      const a = instant(previous.created_at)!, b = instant(row.created_at)!;
      if (a < b || (a === b && previous.id.toLowerCase() <= row.id.toLowerCase())) return null;
    }
    ids.add(row.id.toLowerCase()); previous = row;
  }
  if (value.next_cursor !== null && (!previous || value.next_cursor.id !== previous.id || instant(value.next_cursor.created_at) !== instant(previous.created_at))) return null;
  return value as BookPage;
}
export function parseBookMutation(value: unknown): BookMutation | null {
  if (!record(value) || !exactKeys(value, ["version", "book_id", "revision", "changed", "outcome"]) || value.version !== 1 || !isBookId(value.book_id) || !isRevision(value.revision)) return null;
  if (value.outcome === "created") return value.changed === true && value.revision === "1" ? value as BookMutation : null;
  if (value.outcome === "updated") return value.changed === true && BigInt(value.revision) > BigInt(1) ? value as BookMutation : null;
  return (value.outcome === "existing" || value.outcome === "unchanged") && value.changed === false ? value as BookMutation : null;
}
export const canEditBook = (book: Pick<BookSummary, "archived_at">) => book.archived_at === null;
