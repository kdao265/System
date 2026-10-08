import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const time = "2026-10-08T00:00:00.123456Z";
const root = new URL("../src/", import.meta.url);
const mocksUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = {};
  export function reset(owner) {
    Object.assign(state, { user: { id: owner }, authError: null, authThrows: false,
      profile: { display_name: null, timezone: "Asia/Ho_Chi_Minh" }, profileError: null,
      rpc: [], calls: [], paths: [], authCalls: 0, profileCalls: 0, clientFailure: false,
      cacheFailure: false, cacheControlFlow: null });
  }
  export async function createServerSupabaseClient(readOnly = false) {
    if (state.clientFailure && !readOnly) throw new Error("Synthetic client failure");
    return {
      auth: { getUser: async () => {
        state.authCalls++;
        if (state.authThrows) throw new Error("Synthetic auth transport");
        return { data: { user: state.user }, error: state.authError };
      } },
      from: table => {
        if (table !== "profiles") throw new Error("Unexpected direct table read");
        state.profileCalls++;
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile, error: state.profileError }) }) }) };
      },
      rpc: async (name, args) => {
        state.calls.push({ name, args });
        if (!state.rpc.length) throw new Error("Unexpected RPC");
        const step = state.rpc.shift();
        return typeof step === "function" ? step(name, args) : step;
      },
    };
  }
  export function revalidatePath(path) {
    state.paths.push(path);
    if (state.cacheControlFlow) throw state.cacheControlFlow;
    if (state.cacheFailure) throw new Error("Synthetic cache failure");
  }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root.href)) {
      if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
      if (["@/lib/supabase/server", "next/cache"].includes(specifier)) return { url: mocksUrl, shortCircuit: true };
      if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
      if (specifier.startsWith("@/") || specifier.startsWith("./")) {
        const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, context.parentURL);
        const url = new URL(base.href + ".ts");
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
const actions = await import("../src/features/library/actions.ts");
const { getBooks, getBook } = await import("../src/features/library/data.ts");
const { state, reset } = await import(mocksUrl);
hooks.deregister();

const book = (patch = {}) => ({ id, user_id: owner, title: "Book", author: null, cover_url: null,
  status: "want_to_read", summary: null, content_notes: null, lessons: null,
  archived_at: null, revision: "1", created_at: time, updated_at: time, ...patch });
const summary = b => Object.fromEntries(Object.entries(b).filter(([k]) => !["user_id", "summary", "content_notes", "lessons"].includes(k)));
const detail = (patch = {}) => ({ data: { version: 1, book: book(patch) }, error: null });
const page = (books = [], next_cursor = null) => ({ data: { version: 1, books: books.map(summary), next_cursor }, error: null });
const ack = (outcome = "created", revision = "1", patch = {}) => ({ data: { version: 1, book_id: id,
  outcome, revision, changed: ["created", "updated"].includes(outcome), ...patch }, error: null });
const error = code => ({ data: null, error: { code, message: "Synthetic private database detail" } });
const lost = () => { throw new TypeError("Synthetic response loss"); };
const base = { userId: owner, bookId: id, expected_revision: "1" };
const creation = { userId: owner, bookId: id, fields: { title: " Book " } };
const edit = { ...base, changes: { title: "Revised" } };
const redirect = e => e.digest?.includes(";/login;");
function setup() { reset(owner); process.env.SYSTEM_OWNER_USER_ID = owner; }

test("Library uses the real verified-user/configured-owner gate before all reads and actions", async () => {
  for (const operation of [() => getBooks(), () => getBook(id),
    ...Object.values(actions).map(action => () => action({ userId: owner, bookId: id }))]) {
    for (const [config, user] of [[owner, null], [owner, { id: other, user_metadata: { owner: true, user_id: owner } }],
      ["", { id: owner }], ["invalid", { id: owner }]]) {
      setup(); process.env.SYSTEM_OWNER_USER_ID = config; state.user = user;
      await assert.rejects(operation(), redirect);
      assert.equal(state.calls.length, 0); assert.equal(state.profileCalls, 0);
    }
  }
});

test("auth transport/profile infrastructure failure stays distinct from onboarding", async () => {
  setup(); state.authThrows = true;
  assert.equal((await getBooks()).outcome, "infrastructure_failure");
  for (const operation of [() => getBook(id), () => actions.createBook(creation)]) {
    setup(); state.profileError = { message: "Synthetic failure" };
    assert.equal((await operation()).outcome, "infrastructure_failure");
    assert.equal(state.calls.length, 0);
    setup(); state.profile = null;
    assert.equal((await operation()).outcome, "onboarding_required");
    assert.equal(state.calls.length, 0);
  }
  setup(); state.authError = { message: "Invalid auth" };
  await assert.rejects(actions.createBook(creation), redirect);
});

test("active defaults, archived scope, every status and bounded cursor arguments use metadata RPC", async () => {
  setup(); state.rpc.push(page([book()]));
  const active = await getBooks();
  assert.equal(active.outcome, "success");
  assert.deepEqual(state.calls[0], { name: "list_books_v1", args: {
    p_scope: "active", p_status: null, p_after_created_at: null, p_after_id: null, p_limit: 50,
  } });
  assert.equal("content_notes" in active.value.books[0], false);
  for (const scope of ["active", "archived"]) for (const status of ["want_to_read", "reading", "finished"]) {
    setup(); state.rpc.push(page([book({ status, archived_at: scope === "archived" ? time : null })]));
    assert.equal((await getBooks({ scope, status, limit: 1 })).outcome, "success");
    assert.equal(state.calls[0].args.p_status, status);
    assert.equal(state.calls[0].args.p_scope, scope);
  }
  setup(); state.rpc.push(page());
  assert.equal((await getBooks({ limit: 100, cursor: { id, created_at: time } })).outcome, "success");
  assert.equal(state.calls[0].args.p_after_created_at, time);
  assert.equal(state.calls[0].args.p_after_id, id);
});

test("list rejects invalid bounds/filter/cursor shapes before dispatch", async () => {
  for (const input of [null, [], { scope: "all" }, { status: "bad" }, { limit: 0 }, { limit: 101 },
    { limit: 1.5 }, { limit: "50" }, { limit: null }, { limit: NaN }, { cursor: { id } },
    { cursor: { id, created_at: "2026-02-30T00:00:00Z" } }, { user_id: other }]) {
    setup(); assert.equal((await getBooks(input)).outcome, "validation_error");
    assert.equal(state.calls.length, 0);
  }
});

test("list rejects malformed rows, private projections, wrong scope/status and over-limit pages", async () => {
  const badPages = [null, { version: 1, books: [book()], next_cursor: null },
    { version: 1, books: [{ ...summary(book()), revision: 1 }], next_cursor: null },
    page([book({ archived_at: time })]).data, page([book({ status: "finished" })]).data,
    page([book(), book({ id: owner, created_at: "2026-10-07T00:00:00Z" })]).data];
  for (const data of badPages) {
    setup(); state.rpc.push({ data, error: null });
    assert.equal((await getBooks({ status: "want_to_read", limit: 1 })).outcome, "infrastructure_failure");
  }
});

test("detail returns validated notes and archived state; wrong owner/ID and missing are uniformly unavailable", async () => {
  setup(); state.rpc.push(detail({ content_notes: "Synthetic notes", archived_at: time }));
  const result = await getBook(id.toUpperCase());
  assert.equal(result.outcome, "success"); assert.equal(result.value.content_notes, "Synthetic notes");
  assert.equal(result.value.archived_at, time);
  for (const response of [error("P0002"), detail({ user_id: other }), detail({ id: other })]) {
    setup(); state.rpc.push(response); assert.deepEqual(await getBook(id), { outcome: "not_found" });
  }
  setup(); assert.equal((await getBook("bad")).outcome, "validation_error"); assert.equal(state.calls.length, 0);
  setup(); state.rpc.push({ data: { version: 1, book: { ...book(), revision: 2 } }, error: null });
  assert.equal((await getBook(id)).outcome, "infrastructure_failure");
});

test("read errors and thrown transports never become empty collections or missing detail", async () => {
  for (const read of [() => getBooks(), () => getBook(id)]) for (const response of [error("XX000"), lost, error("42501")]) {
    setup(); state.rpc.push(response);
    assert.equal((await read()).outcome, response?.error?.code === "42501" ? "unauthorized" : "infrastructure_failure");
  }
});

test("create normalizes through L1, retains the supplied stable UUID and invalidates only Library", async () => {
  setup(); state.rpc.push(ack());
  const result = await actions.createBook({ ...creation, bookId: id.toUpperCase() });
  assert.deepEqual(result, { outcome: "success", bookId: id, revision: "1", effect: "created", evidence: "acknowledged", refreshRequired: false });
  assert.equal(state.calls[0].name, "create_book_v1");
  assert.equal(state.calls[0].args.p_book_id, id);
  assert.equal(state.calls[0].args.p_fields.title, "Book");
  assert.equal(state.calls[0].args.p_fields.status, "want_to_read");
  assert.equal("user_id" in state.calls[0].args.p_fields, false);
  assert.deepEqual(state.paths, ["/library", `/library/${id}`]);
});

test("untrusted create/edit fields and forged authority cannot dispatch", async () => {
  for (const fields of [{ title: " " }, { title: 1 }, { title: "x", author: [] }, { title: "x", cover_url: "http://example.invalid" },
    { title: "x", status: "bad" }, { title: "x", summary: 1 }, { title: "x", content_notes: "x".repeat(20001) },
    { title: "x", lessons: {} }, { title: "x", user_id: owner }]) {
    setup(); assert.equal((await actions.createBook({ ...creation, fields })).outcome, "validation_error");
    assert.equal(state.calls.length, 0);
  }
  for (const input of [null, [], {}, { ...creation, user_id: owner }, { ...creation, bookId: "bad" }]) {
    setup(); assert.equal((await actions.createBook(input)).outcome, "validation_error"); assert.equal(state.calls.length, 0);
  }
  for (const [action, input] of [[actions.createBook, creation], [actions.editBook, edit], [actions.setBookStatus, { ...base, status: "reading" }],
    [actions.archiveBook, base], [actions.restoreBook, base], [actions.resolveBookCreate, { userId: owner, bookId: id }]]) {
    setup(); assert.equal((await action({ ...input, userId: other })).outcome, "unauthorized"); assert.equal(state.calls.length, 0);
    setup(); assert.equal((await action({ ...input, user_id: other })).outcome, "validation_error"); assert.equal(state.calls.length, 0);
  }
});

test("existing create reads current content without applying a replacement payload, even after archive", async () => {
  setup(); state.rpc.push(ack("existing", "9"), detail({ revision: "9", title: "Earlier book", archived_at: time }));
  const result = await actions.createBook(creation);
  assert.equal(result.effect, "existing"); assert.equal(result.book.title, "Earlier book");
  assert.equal(result.book.archived_at, time);
  assert.deepEqual(state.calls.map(c => c.name), ["create_book_v1", "get_book_v1"]);
  setup(); state.rpc.push(ack("existing", "9"), error("XX000"));
  const unavailable = await actions.createBook(creation);
  assert.equal(unavailable.outcome, "success"); assert.equal(unavailable.detailUnavailable, true);
});

test("create response lost after simulated commit resolves stable identity without replay", async () => {
  setup(); let stored;
  state.rpc.push((_name, args) => { stored = book({ ...args.p_fields, id: args.p_book_id }); return lost(); },
    (_name, args) => ({ data: { version: 1, book: args.p_book_id === stored.id ? stored : null }, error: null }));
  const result = await actions.createBook(creation);
  assert.equal(result.effect, "existing"); assert.equal(result.evidence, "current_state");
  assert.equal(state.calls.length, 2); assert(state.calls.every(c => c.args.p_book_id === id));
});

test("uncertain create retains identity through absence/read failure; reload resolver never writes", async () => {
  for (const response of [error("P0002"), error("XX000")]) {
    setup(); state.rpc.push(error(""), response);
    const result = await actions.createBook(creation);
    assert.deepEqual(result, { outcome: "uncertain", bookId: id, retryAllowed: response.error.code === "P0002" });
  }
  for (const response of [detail(), error("P0002"), error("XX000")]) {
    setup(); state.rpc.push(response);
    const result = await actions.resolveBookCreate({ userId: owner, bookId: id });
    assert.equal(result.outcome, response.error ? response.error.code === "P0002" ? "not_found" : "infrastructure_failure" : "success");
    assert.deepEqual(state.calls.map(c => c.name), ["get_book_v1"]);
  }
});

test("foreign create collision returns only uniform not-found and no raw database detail", async () => {
  setup(); state.rpc.push(error("P0002"));
  assert.deepEqual(await actions.createBook(creation), { outcome: "not_found" });
  assert.equal(state.calls.length, 1); assert.equal(state.paths.length, 0);
});

test("cache failure after acknowledged or observed saves stays saved and attempts both paths", async () => {
  for (const responses of [[ack()], [lost, detail()]]) {
    setup(); state.cacheFailure = true; state.rpc.push(...responses);
    const result = await actions.createBook(creation);
    assert.equal(result.outcome, "success"); assert.equal(result.refreshRequired, true);
    assert.deepEqual(state.paths, ["/library", `/library/${id}`]);
  }
});

test("successful and no-op edits preserve exact revisions and only send normalized explicit changes", async () => {
  for (const [outcome, revision] of [["updated", "2"], ["unchanged", "1"]]) {
    setup(); state.rpc.push(ack(outcome, revision));
    const result = await actions.editBook({ ...base, changes: { summary: " a\r\nb ", author: " " } });
    assert.equal(result.revision, revision); assert.equal(result.effect, outcome);
    assert.deepEqual(state.calls[0].args, { p_book_id: id, p_expected_revision: "1", p_changes: { summary: " a\nb ", author: null } });
  }
  setup(); state.rpc.push(ack("updated", "9007199254740994"));
  assert.equal((await actions.editBook({ ...edit, expected_revision: "9007199254740993" })).revision, "9007199254740994");
});

test("stale and archived rejections remain conflicts, including equal desired values", async () => {
  for (const [patch, reason] of [[{ revision: "2", title: "Revised" }, "stale_revision"],
    [{ archived_at: time }, "archived"], [{}, "review_required"]]) {
    setup(); state.rpc.push(error("23514"), detail(patch));
    const result = await actions.editBook(edit);
    assert.equal(result.outcome, "conflict"); assert.equal(result.reason, reason);
    assert.equal("book" in result, false); assert.equal("changes" in result, false);
    assert.equal(state.calls.filter(c => c.name === "update_book_v1").length, 1);
    assert.equal(state.paths.length, 0);
  }
});

test("malformed revision/edit/status/archive requests never reach RPC", async () => {
  for (const expected_revision of [1, "0", "01", "9223372036854775808", null]) {
    setup(); assert.equal((await actions.editBook({ ...edit, expected_revision })).outcome, "validation_error");
    assert.equal(state.calls.length, 0);
  }
  for (const changes of [{}, { title: null }, { summary: 3 }, { content_notes: [] }, { lessons: false }, { revision: "2" }]) {
    setup(); assert.equal((await actions.editBook({ ...base, changes })).outcome, "validation_error"); assert.equal(state.calls.length, 0);
  }
  setup(); assert.equal((await actions.setBookStatus({ ...base, status: "done" })).outcome, "validation_error");
  assert.equal((await actions.archiveBook({ ...base, archived: false })).outcome, "validation_error");
  assert.equal(state.calls.length, 0);
});

test("every status transition and no-op uses a status-only revision guarded update", async () => {
  for (const from of ["want_to_read", "reading", "finished"]) for (const to of ["want_to_read", "reading", "finished"]) {
    setup(); state.rpc.push(ack(from === to ? "unchanged" : "updated", from === to ? "1" : "2"));
    const result = await actions.setBookStatus({ ...base, status: to });
    assert.equal(result.outcome, "success");
    assert.deepEqual(state.calls[0], { name: "update_book_v1", args: { p_book_id: id, p_expected_revision: "1", p_changes: { status: to } } });
  }
  setup(); state.rpc.push(error("23514"), detail({ revision: "2", status: "reading" }));
  assert.equal((await actions.setBookStatus({ ...base, status: "reading" })).outcome, "conflict");
});

test("archive/restore are explicit boolean commands with successful/no-op/stale outcomes", async () => {
  for (const [action, archived] of [[actions.archiveBook, true], [actions.restoreBook, false]]) {
    for (const [outcome, revision] of [["updated", "2"], ["unchanged", "1"]]) {
      setup(); state.rpc.push(ack(outcome, revision));
      assert.equal((await action(base)).effect, outcome);
      assert.deepEqual(state.calls[0], { name: "set_book_archived_v1", args: { p_book_id: id, p_expected_revision: "1", p_archived: archived } });
    }
    setup(); state.rpc.push(error("23514"), detail({ revision: "2" }));
    assert.equal((await action(base)).reason, "stale_revision");
  }
});

test("lost revision responses resolve matching current state at base or immediate successor only", async () => {
  for (const [action, input, desired] of [[actions.editBook, edit, { title: "Revised" }],
    [actions.setBookStatus, { ...base, status: "reading" }, { status: "reading" }],
    [actions.archiveBook, base, { archived_at: time }], [actions.restoreBook, base, { archived_at: null }]]) {
    for (const revision of ["1", "2", "3"]) {
      setup(); let committed;
      state.rpc.push(() => { committed = book({ ...desired, revision }); return lost(); },
        () => ({ data: { version: 1, book: committed }, error: null }));
      const result = await action(input);
      assert.equal(result.outcome, revision === "3" ? "conflict" : "success");
      if (result.outcome === "success") { assert.equal(result.effect, "observed"); assert.equal(result.evidence, "current_state"); }
      assert.equal(state.calls.length, 2);
    }
  }
});

test("opposing later archive/status/edit cannot be blindly replayed; unchanged mismatches permit only explicit retry", async () => {
  for (const [action, input] of [[actions.editBook, edit], [actions.setBookStatus, { ...base, status: "finished" }], [actions.archiveBook, base]]) {
    setup(); state.rpc.push(lost, detail({ revision: "3" }));
    assert.equal((await action(input)).outcome, "conflict"); assert.equal(state.calls.length, 2);
    setup(); state.rpc.push(lost, detail());
    assert.deepEqual(await action(input), { outcome: "uncertain", bookId: id, retryAllowed: true });
  }
  setup(); state.rpc.push(lost, detail({ archived_at: time }));
  assert.equal((await actions.editBook(edit)).outcome, "conflict");
  setup(); state.rpc.push(lost, error("XX000"));
  assert.deepEqual(await actions.editBook(edit), { outcome: "uncertain", bookId: id, retryAllowed: false });
});

test("malformed or incompatible acknowledgements require reconciliation, never false success", async () => {
  for (const response of [ack("updated", "3"), ack("created"), ack("updated", "2", { book_id: other }),
    ack("unchanged", "2"), { data: null, error: null }]) {
    setup(); state.rpc.push(response, error("XX000"));
    assert.equal((await actions.editBook(edit)).outcome, "uncertain"); assert.equal(state.paths.length, 0);
  }
  setup(); state.rpc.push(ack("updated", "2"), error("XX000"));
  assert.equal((await actions.createBook(creation)).outcome, "uncertain");
});

test("known action rejections, pre-dispatch infrastructure failure and cache outcomes stay separate", async () => {
  for (const [action, input] of [[actions.createBook, creation], [actions.editBook, edit], [actions.archiveBook, base], [actions.restoreBook, base]]) {
    for (const [code, outcome] of [["42501", "unauthorized"], ["P0002", "not_found"], ["22023", "validation_error"]]) {
      setup(); state.rpc.push(error(code)); assert.equal((await action(input)).outcome, outcome); assert.equal(state.calls.length, 1);
    }
    setup(); state.clientFailure = true;
    assert.equal((await action(input)).outcome, "infrastructure_failure"); assert.equal(state.calls.length, 0);
    setup(); state.cacheFailure = true; state.rpc.push(ack(action === actions.createBook ? "created" : "updated", action === actions.createBook ? "1" : "2"));
    const result = await action(input); assert.equal(result.outcome, "success"); assert.equal(result.refreshRequired, true);
  }
});
