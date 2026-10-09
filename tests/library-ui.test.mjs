import "./helpers/ui-loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { en, vi } from "../src/lib/localization/dictionaries.ts";
const { createBookWorkflow } = await import("../src/features/library/create-workflow.ts");
const { createDetailWorkflow } = await import("../src/features/library/detail-workflow.ts");
const { libraryHref, libraryQuery } = await import("../src/features/library/navigation.ts");
const { prepareCreateIdentity, readCreateIdentity } = await import("../src/features/library/create-identity.ts");
const { BookCard } = await import("../src/features/library/book-card.tsx");
const { BookContent } = await import("../src/features/library/book-content.tsx");
const { BookFieldInputs } = await import("../src/features/library/book-fields.tsx");
const { LibraryFeedback } = await import("../src/features/library/feedback.tsx");
const { AppHeader } = await import("../src/components/app-header.tsx");

const userId = "11111111-1111-4111-8111-111111111111", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const time = "2026-10-08T00:00:00.123456Z";
const fields = { title: "Synthetic book", author: "Author", cover_url: null, status: "reading", summary: "Private summary", content_notes: "Private notes", lessons: "Private lessons" };
const book = { ...fields, id, user_id: userId, revision: "1", created_at: time, updated_at: time, archived_at: null };
const success = (extra = {}) => ({ outcome: "success", bookId: id, revision: "1", effect: "created", evidence: "acknowledged", refreshRequired: false, ...extra });
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function store() { const entries = new Map(); return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }; }
function creation(overrides = {}) {
  const storage = store(); const calls = { create: [], resolve: [], navigate: [], refresh: 0, generations: 0 };
  const workflow = createBookWorkflow(userId, {
    storage: () => storage, generateId: () => { calls.generations++; return id; },
    create: async input => { calls.create.push(input); return success(); },
    resolve: async input => { calls.resolve.push(input); return { outcome: "not_found" }; },
    rethrow: error => { if (error?.digest === "NEXT_REDIRECT") throw error; },
    refresh: () => { calls.refresh++; }, navigate: id => calls.navigate.push(id), ...overrides,
  });
  return { workflow, storage, calls };
}

test("Library route/auth/proxy and nested navigation integrate without changing Dashboard shortcuts", () => {
  for (const path of ["page.tsx", "new/page.tsx", "[id]/page.tsx"]) {
    const text = source(`src/app/library/${path}`);
    assert.match(text, /dynamic = "force-dynamic"/); assert.match(text, /libraryPageContext/);
    assert.match(text, /current="library"/); assert.doesNotMatch(text, /use cache/);
  }
  const nav = render(h(AppHeader, { current: "library", selectedDate: "2026-10-01", compact: true }));
  assert.match(nav, /href="\/library" aria-current="page"/);
  assert.match(nav, /href="\/calendar\?date=2026-10-01"/); assert.match(nav, /href="#daily-quests"/);
  for (const route of ["dashboard", "calendar", "goals", "library"]) assert(source("src/proxy.ts").includes(`/${route}/:path*`));
});

test("Library bilingual cards contain semantic metadata only and covers have a browser-only fallback", () => {
  assert.deepEqual(Object.keys(en.library), Object.keys(vi.library));
  assert.deepEqual(Object.keys(en.library.fields), Object.keys(vi.library.fields));
  for (const copy of [en.library, vi.library]) {
    const html = render(h(BookCard, { book, copy }));
    assert.match(html, /<article/); assert.match(html, /<h3/); assert(html.includes(fields.title));
    assert(html.includes(fields.author)); assert(html.includes(copy.statuses.reading)); assert(html.includes(copy.coverMissing));
    for (const value of [fields.summary, fields.content_notes, fields.lessons]) assert(!html.includes(value));
    const covered = render(h(BookCard, { book: { ...book, cover_url: "https://covers.invalid/book.png" }, copy }));
    assert.match(covered, /alt=""/); assert.match(covered, /referrerPolicy="no-referrer"/); assert.match(covered, /loading="lazy"/);
    assert.doesNotMatch(covered, /_next\/image/);
  }
  assert.match(source("src/features/library/book-cover.tsx"), /onError=/);
});

test("create/edit fields use model validation, labelled inputs and no UTF-16 maxlength truncation", () => {
  const html = render(h(BookFieldInputs, { value: fields, onChange() {}, disabled: false, failure: { outcome: "validation_error", field: "title", code: "required" }, copy: en.library, prefix: "test" }));
  for (const field of Object.keys(fields)) {
    assert(html.includes(`name="${field}"`));
    assert(html.includes(`<label for="test-${field}">${en.library.fields[field]}</label>`));
  }
  assert.match(html, /aria-invalid="true"/); assert.match(html, /test-title-error/); assert.doesNotMatch(html, /maxLength=/i);
  const archived = render(h(BookContent, { book: { ...book, archived_at: time }, copy: en.library }));
  assert(archived.includes(en.library.archived)); assert(archived.includes(fields.content_notes));
  for (const file of ["book-workspace.tsx", "create-form.tsx", "book-card.tsx"]) assert.doesNotMatch(source(`src/features/library/${file}`), /deleteBook|Delete book|localStorage|setItem/);
});

test("cursor URLs round-trip exact PostgreSQL microseconds and reset on filter changes", () => {
  const cursor = { created_at: time, id };
  const url = new URL(libraryHref({ scope: "archived", status: "reading" }, cursor), "https://system.invalid");
  assert.deepEqual(libraryQuery(Object.fromEntries(url.searchParams)), { scope: "archived", status: "reading", cursor });
  assert(!libraryHref({ scope: "active", status: null }).includes("after"));
  assert.equal(libraryQuery({ after: "{", scope: "bad", status: "bad" }).cursor, null);
});

test("new create persists identity only, blocks duplicate synchronous submits and clears acknowledged success", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let dispatched = 0;
  const { workflow, storage, calls } = creation({ create: async () => { dispatched++; await gate; return success(); } });
  await workflow.initialize(); const first = workflow.submit(fields); const duplicate = workflow.submit(fields);
  assert.equal(dispatched, 1); assert.equal(calls.generations, 1);
  assert.deepEqual(JSON.parse([...storage.entries.values()][0]), { version: 1, userId, bookId: id });
  release(); await Promise.all([first, duplicate]);
  assert.equal(storage.entries.size, 0); assert.deepEqual(calls.navigate, [id]);
});

test("mount resolves an existing stable identity without sending or applying a draft", async () => {
  const { workflow, storage, calls } = creation({ resolve: async () => success({ effect: "existing", evidence: "current_state", book }) });
  prepareCreateIdentity(storage, userId, () => id);
  await workflow.initialize();
  assert.equal(workflow.snapshot().notice, "existing"); assert.deepEqual(workflow.snapshot().book, book);
  assert.equal(calls.create.length, 0); assert.equal(calls.generations, 0); assert.equal(storage.entries.size, 0);
});

test("absence on mount requires explicit same-attempt re-entry and never silently replaces UUID", async () => {
  const { workflow, storage, calls } = creation(); prepareCreateIdentity(storage, userId, () => id);
  await workflow.initialize(); await workflow.submit(fields);
  assert.equal(workflow.snapshot().notice, "absent"); assert.equal(calls.create.length, 0); assert.equal(calls.generations, 0);
  workflow.continueSame(); await workflow.submit(fields);
  assert.equal(calls.create[0].bookId, id); assert.equal(calls.generations, 0);
});

test("invalid or changed-account metadata is only cleared through explicit helper-backed recovery", async () => {
  for (const raw of ["{", JSON.stringify({ version: 1, userId: second, bookId: id })]) {
    const { workflow, storage, calls } = creation();
    prepareCreateIdentity(storage, userId, () => id); const key = [...storage.entries.keys()][0]; storage.entries.set(key, raw);
    await workflow.initialize(); assert.equal(storage.getItem(key), raw);
    await workflow.submit(fields); assert.equal(calls.create.length, 0);
    await workflow.clearBlocked(); assert.equal(storage.entries.size, 0); assert.equal(workflow.snapshot().phase, "form");
  }
  const { workflow, storage, calls } = creation(); prepareCreateIdentity(storage, userId, () => id);
  const key = [...storage.entries.keys()][0]; storage.entries.set(key, "{"); await workflow.initialize();
  storage.entries.set(key, JSON.stringify({ version: 1, userId, bookId: id }));
  await workflow.clearBlocked(); assert.equal(readCreateIdentity(storage, userId).outcome, "ready");
  assert.equal(calls.resolve.length, 1); assert.equal(calls.generations, 0);
});

test("uncertain create retains identity and draft submission is blocked until explicit checking", async () => {
  const { workflow, storage, calls } = creation({ create: async () => ({ outcome: "uncertain", bookId: id, retryAllowed: true }) });
  await workflow.initialize(); await workflow.submit(fields); const before = [...storage.entries];
  assert.equal(workflow.snapshot().notice, "uncertain"); await workflow.submit(fields);
  assert.deepEqual([...storage.entries], before); assert.equal(calls.generations, 1);
  await workflow.check(); assert.equal(workflow.snapshot().notice, "absent"); assert.deepEqual([...storage.entries], before);
});

test("direct not_found stays collision after status checks; only explicit reset allows the next attempt", async () => {
  let creates = 0;
  const { workflow, storage, calls } = creation({ create: async () => { creates++; return { outcome: "not_found" }; } });
  await workflow.initialize(); await workflow.submit(fields);
  assert.equal(workflow.snapshot().notice, "collision"); assert.equal(calls.generations, 1); assert.equal(storage.entries.size, 1);
  const identity = workflow.snapshot().identity;
  const stored = [...storage.entries];
  assert.deepEqual(readCreateIdentity(storage, userId), { outcome: "ready", identity });
  for (let checks = 1; checks <= 2; checks++) {
    await workflow.check();
    assert.equal(workflow.snapshot().notice, "collision");
    assert.deepEqual(workflow.snapshot().identity, identity); assert.deepEqual([...storage.entries], stored);
    assert.equal(calls.resolve.length, checks); assert.deepEqual(calls.resolve.at(-1), { userId, bookId: id });
    workflow.continueSame(); await workflow.submit(fields);
    assert.equal(workflow.snapshot().phase, "pending"); assert.equal(creates, 1); assert.equal(calls.generations, 1);
  }
  workflow.resetAttempt(); assert.equal(storage.entries.size, 0); assert.equal(workflow.snapshot().phase, "form");
  await workflow.submit(fields); assert.equal(calls.generations, 2); assert.equal(creates, 2);
});

test("existing with unavailable detail retains identity, fetches safely and never claims payload saved", async () => {
  const { workflow, storage, calls } = creation({ create: async () => success({ effect: "existing", detailUnavailable: true }), resolve: async () => success({ effect: "existing", book }) });
  await workflow.initialize(); await workflow.submit({ ...fields, title: "Not applied" });
  assert.equal(workflow.snapshot().notice, "existingUnavailable"); assert.equal(storage.entries.size, 1);
  await workflow.check(); assert.equal(workflow.snapshot().book.title, fields.title); assert.equal(storage.entries.size, 0);
  assert.equal(calls.generations, 1); assert.equal(workflow.snapshot().notice, "existing");
});

test("auth redirects preserve pending identity; failed cleanup and storage verification fail closed", async () => {
  const redirect = { digest: "NEXT_REDIRECT" };
  const { workflow, storage } = creation({ create: async () => { throw redirect; } });
  await workflow.initialize(); await assert.rejects(workflow.submit(fields), error => error === redirect);
  assert.equal(storage.entries.size, 1); assert.equal(workflow.snapshot().saved, undefined);
  const c = creation(); await c.workflow.initialize(); c.storage.removeItem = () => {};
  await c.workflow.submit(fields); assert.equal(c.workflow.snapshot().notice, "cleanupFailed"); assert.equal(c.calls.navigate.length, 0);
  const s = creation({ storage: () => { throw new Error("No storage"); } }); await s.workflow.initialize(); await s.workflow.submit(fields);
  assert.equal(s.workflow.snapshot().phase, "blocked"); assert.equal(s.calls.create.length, 0);
});

function detail(overrides = {}, initial = book) {
  const calls = { edit: [], status: [], archive: [], restore: [], refresh: 0 };
  const workflow = createDetailWorkflow(initial, {
    edit: async input => { calls.edit.push(input); return success({ effect: "updated", revision: "2" }); },
    status: async input => { calls.status.push(input); return success({ effect: "unchanged" }); },
    archive: async input => { calls.archive.push(input); return success({ effect: "updated", revision: "2" }); },
    restore: async input => { calls.restore.push(input); return success({ effect: "updated", revision: "2" }); },
    read: async () => ({ outcome: "success", value: initial }), refresh: () => { calls.refresh++; }, rethrow: () => {}, ...overrides,
  }); return { workflow, calls };
}

test("revision conflicts fetch authoritative state while preserving draft and base until explicit review", async () => {
  const current = { ...book, title: "Saved elsewhere", revision: "2" };
  const { workflow, calls } = detail({ edit: async input => { calls.edit.push(input); return { outcome: "conflict", reason: "stale_revision", revision: "2" }; }, read: async () => ({ outcome: "success", value: current }) });
  workflow.edit(); workflow.draft({ ...fields, title: "My unsaved draft" }); await workflow.save();
  assert.equal(workflow.snapshot().draft.title, "My unsaved draft"); assert.equal(workflow.snapshot().book.revision, "1");
  assert.equal(workflow.snapshot().latest.title, "Saved elsewhere"); await workflow.save(); assert.equal(calls.edit.length, 1);
  workflow.acceptLatest(true); assert.equal(workflow.snapshot().book.revision, "2"); assert.equal(workflow.snapshot().draft.title, "My unsaved draft");
  assert.equal(calls.edit.length, 1); await workflow.save(); assert.equal(calls.edit[1].expected_revision, "2");
});

test("archived workspace keeps readable content and prohibits edits/status/archive until explicit restore", async () => {
  const archived = { ...book, archived_at: time };
  const { workflow, calls } = detail({}, archived);
  workflow.edit(); await workflow.save(); await workflow.status("finished"); await workflow.archive();
  assert.equal(workflow.snapshot().editing, false); assert.deepEqual(calls.edit, []); assert.deepEqual(calls.status, []); assert.deepEqual(calls.archive, []);
  await workflow.restore(); assert.equal(calls.restore[0].expected_revision, "1"); assert.equal(workflow.snapshot().book.content_notes, fields.content_notes);
});

test("all status transitions send only status and exact revision; no-op does not invent a revision", async () => {
  for (const status of ["want_to_read", "reading", "finished"]) {
    const { workflow, calls } = detail(); await workflow.status(status);
    assert.deepEqual(calls.status, [{ userId, bookId: id, expected_revision: "1", status }]);
    assert.equal(workflow.snapshot().book.revision, "1");
  }
});

test("observed and refreshRequired results stay successful even if subsequent read fails, without replay", async () => {
  for (const effect of ["updated", "observed", "unchanged"]) {
    const saved = success({ effect, refreshRequired: true });
    const { workflow, calls } = detail({ edit: async input => { calls.edit.push(input); return saved; }, read: async () => { throw new Error("Unavailable"); } });
    workflow.edit(); await workflow.save(); assert.deepEqual(workflow.snapshot().saved, saved);
    assert.equal(workflow.snapshot().failure, null); assert.equal(workflow.snapshot().needsRefresh, true); assert.equal(calls.refresh, 1);
    await workflow.save(); assert.equal(calls.edit.length, 1);
    assert(render(h(LibraryFeedback, { saved, copy: en.library })).includes(en.library.savedRefresh));
  }
});

test("uncertain edits keep mounted draft and require read/review; conflict feedback exposes no raw backend message", async () => {
  const { workflow, calls } = detail({ edit: async input => { calls.edit.push(input); throw new Error("Synthetic lost transport"); } });
  workflow.edit(); workflow.draft({ ...fields, summary: "Unsaved" }); await workflow.save(); await workflow.save();
  assert.equal(calls.edit.length, 1); assert.equal(workflow.snapshot().draft.summary, "Unsaved");
  await workflow.check(); assert.deepEqual(workflow.snapshot().latest, book); assert.equal(workflow.snapshot().review, true);
  const html = render(h(LibraryFeedback, { failure: { outcome: "conflict", reason: "stale_revision" }, copy: en.library }));
  assert.match(html, /role="alert"/); assert(html.includes(en.library.conflict)); assert.doesNotMatch(html, /23514|PostgREST/);
});
