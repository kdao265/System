import assert from "node:assert/strict";
import test from "node:test";
import * as m from "../src/features/library/model.ts";
import { validCovers, invalidCovers, normalizationCases } from "./helpers/library-fixtures.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const time = "2026-10-07T01:00:00.123456+00:00";
const fields = { title: "Book", author: null, cover_url: null, status: "want_to_read", summary: null, content_notes: null, lessons: null };
const book = { ...fields, id, user_id: id, archived_at: null, revision: "1", created_at: time, updated_at: time };
const card = (book) => Object.fromEntries(Object.entries(book).filter(([key]) => !["user_id", "summary", "content_notes", "lessons"].includes(key)));
const create = value => m.normalizeBookFields(value, "create");
const update = value => m.normalizeBookFields(value, "update");

test("Library vocabulary, defaults and closed create/update field shapes", () => {
  assert.deepEqual(m.BOOK_STATUSES, ["want_to_read", "reading", "finished"]);
  assert.deepEqual(create({ title: " Book " }), { ok: true, value: fields });
  assert.deepEqual(update({ status: "reading" }), { ok: true, value: { status: "reading" } });
  for (const input of [null, [], {}, { title: "x", user_id: id }, { title: "x", revision: "2" }, { title: "x", archived_at: time }, { title: "x", status: null }, { title: "x", status: "READING" }, { title: "x", author: undefined }]) assert.equal(create(input).ok, false);
  for (const input of [{}, { title: null }, { id }, { created_at: time }, { lessons: [] }]) assert.equal(update(input).ok, false);
});

test("all text limits count Unicode code points, preserve Vietnamese and reject invalid UTF-8 text", () => {
  for (const [key, max] of Object.entries(m.BOOK_LIMITS).filter(([key]) => key !== "cover_url")) {
    assert(create({ title: "x", [key]: "😀".repeat(max) }).ok, key);
    assert.equal(create({ title: "x", [key]: "😀".repeat(max + 1) }).ok, false, key);
  }
  // Code points (PostgreSQL char_length) = 9; UTF-16 code units = 10 because 😀 is a
  // surrogate pair. The model must count code points, never UTF-16 units.
  assert.equal("Việt 😀 e\u0301".length, 10);
  assert.equal(m.characterCount("Việt 😀 e\u0301"), 9);
  assert.equal(create({ title: "  Tiếng Việt 😀  " }).value.title, "Tiếng Việt 😀");
  assert.equal(create({ title: "e\u0301" }).value.title, "e\u0301");
  for (const text of ["", " \t\n", "\u00a0\u2003\ufeff", "\0", "\ud800", "\udfff"]) assert.equal(create({ title: text }).ok, false);
  for (const key of Object.keys(m.BOOK_LIMITS)) {
    assert.equal(create({ title: "x", [key]: "a\0b" }).ok, false);
    assert.equal(create({ title: "x", [key]: "a\ud800b" }).ok, false);
  }
});

test("shared whitespace set, nullable text and line-ending normalization", () => {
  const ws = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  assert.deepEqual(create({ title: ws + "Book" + ws, author: ws, cover_url: ws, summary: ws, content_notes: ws, lessons: ws }), { ok: true, value: fields });
  const normalized = create({ title: "Book", author: "  Author  ", summary: " a\r\nb\rc ", content_notes: "\n  😀\r\n", lessons: " lesson " }).value;
  assert.equal(normalized.author, "Author");
  assert.equal(normalized.summary, " a\nb\nc ");
  assert.equal(normalized.content_notes, "\n  😀\n");
  assert.equal(normalized.lessons, " lesson ");
  assert.equal(update({ summary: "  " }).value.summary, null);
});


test("HTTPS covers use pure syntax validation and reject credentials, repaired URL forms and invalid hosts", () => {
  for (const value of validCovers) assert(m.isCoverUrl(value), value);
  for (const value of invalidCovers) assert.equal(m.isCoverUrl(value), false, JSON.stringify(value));
  assert(create({ title: "x", cover_url: "  https://example.invalid/a  " }).ok);
  const prefix = "https://example.invalid/";
  assert(m.isCoverUrl(prefix + "x".repeat(2048 - prefix.length)));
  assert(m.isCoverUrl(prefix + "😀".repeat(2048 - prefix.length)));
  assert.equal(m.isCoverUrl(prefix + "x".repeat(2049 - prefix.length)), false);
  assert.equal(m.isCoverUrl(prefix + "😀".repeat(2049 - prefix.length)), false);
});

test("revisions stay exact across the entire positive PostgreSQL bigint range", () => {
  for (const revision of ["1", "9007199254740993", "9223372036854775807"]) assert(m.isRevision(revision));
  for (const revision of [1, null, "0", "01", "-1", "+1", "1.0", "1e2", "9223372036854775808", " "]) assert.equal(m.isRevision(revision), false);
});

test("detail/card parsers enforce canonical text, closed projections, timestamps and archive rules", () => {
  assert.deepEqual(m.parseBook(book), book);
  assert.deepEqual(m.parseBookDetail({ version: 1, book }), book);
  assert.deepEqual(m.parseBookSummary(card(book)), card(book));
  assert(m.canEditBook(book));
  const archived = { ...book, archived_at: time };
  assert(m.parseBook(archived)); assert.equal(m.canEditBook(archived), false);
  for (const patch of [{ title: " Book " }, { author: " " }, { summary: "a\rb" }, { revision: 1 }, { status: "bad" }, { user_id: "bad" }, { created_at: "2026-02-30T00:00:00Z" }, { updated_at: "2025-01-01T00:00:00Z" }, { archived_at: "infinity" }, { cover_url: "https://@example.invalid" }, { unexpected: true }]) assert.equal(m.parseBook({ ...book, ...patch }), null);
  assert.equal(m.parseBookSummary(book), null, "card parser rejects note/owner payloads");
  assert.equal(m.parseBookDetail({ version: 2, book }), null);
});

test("page parser preserves microsecond cursor ordering, closed projections and bounded pagination", () => {
  const first = card(book), second = { ...first, id: "22222222-2222-4222-8222-222222222222", created_at: "2026-10-07T01:00:00.123455Z" };
  const page = { version: 1, books: [first, second], next_cursor: { created_at: second.created_at, id: second.id } };
  assert.deepEqual(m.parseBookPage(page), page);
  assert.equal(m.parseBookPage({ ...page, books: [second, first] }), null);
  assert.equal(m.parseBookPage({ ...page, books: [first, first] }), null);
  assert.equal(m.parseBookPage({ ...page, next_cursor: { created_at: first.created_at, id: first.id } }), null);
  assert.equal(m.parseBookPage({ ...page, books: Array(101).fill(first) }), null);
  assert.equal(m.parseBookPage({ ...page, books: [{ ...first, summary: "private" }] }), null);
  assert(m.parseBookPage({ version: 1, books: [], next_cursor: null }));
});

test("immediate mutation acknowledgements are not historical receipts", () => {
  const ack = { version: 1, book_id: id, revision: "1", changed: true, outcome: "created" };
  assert(m.parseBookMutation(ack));
  assert(m.parseBookMutation({ ...ack, changed: false, outcome: "existing", revision: "9007199254740993" }));
  assert(m.parseBookMutation({ ...ack, outcome: "updated", revision: "2" }));
  assert(m.parseBookMutation({ ...ack, outcome: "unchanged", changed: false }));
  for (const patch of [{ revision: "2" }, { changed: false }, { replay: true }, { outcome: "updated" }, { outcome: "existing" }, { book_id: "invalid" }]) assert.equal(m.parseBookMutation({ ...ack, ...patch }), null);
});

// The same corpus is submitted to PostgreSQL in helpers/library-wire.mjs.
test("shared normalization corpus is stable on repeated updates", () => {
  for (const fields of normalizationCases) {
    const result = create(fields);
    assert(result.ok);
    assert.deepEqual(update(result.value), result);
  }
});
