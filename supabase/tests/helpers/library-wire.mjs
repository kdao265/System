import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isCoverUrl, normalizeBookFields, parseBookDetail, parseBookMutation, parseBookPage } from "../../../src/features/library/model.ts";
import { validCovers, invalidCovers, normalizationCases } from "../../../tests/helpers/library-fixtures.mjs";

// Only receives resources made by startAuthEnvironment; never external credentials.
export async function exerciseLibraryWire(env, owner, outsider, anon) {
  const calls = new Map();
  async function ok(name, args = {}) {
    const { data, error } = await owner.rpc(name, args);
    assert(!error, `${name} failed (${error?.code})`);
    calls.set(name, args);
    if (name === "get_book_v1") assert(parseBookDetail(data), "Invalid detail projection");
    else if (name === "list_books_v1") assert(parseBookPage(data), "Invalid metadata page");
    else assert(parseBookMutation(data), "Invalid mutation acknowledgement");
    return data;
  }
  const get = async id => (await ok("get_book_v1", { p_book_id: id })).book;
  const update = (id, revision, p_changes) => ok("update_book_v1", { p_book_id: id, p_expected_revision: revision, p_changes });
  const archive = (id, revision, p_archived) => ok("set_book_archived_v1", { p_book_id: id, p_expected_revision: revision, p_archived });
  async function engineSnapshot() {
    return env.sql(`SELECT jsonb_build_object(
      'quests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.quests t),
      'occurrences',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.quest_occurrences t),
      'events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.quest_events t),
      'exp',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.exp_ledger t),
      'goals',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.goals t),
      'rewards',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.level_reward_events t));`);
  }
  const baseline = await engineSnapshot();
  const id = randomUUID();
  const create = { p_book_id: id, p_fields: { title: "Wire book", cover_url: "https://example.invalid/a", summary: "summary", content_notes: "private synthetic notes", lessons: "lesson" } };
  const made = await ok("create_book_v1", create);
  assert.equal(made.outcome, "created");
  let current = await get(id);
  assert.equal(current.user_id, env.owner.id);
  assert.equal((await ok("create_book_v1", create)).outcome, "existing");
  assert.equal((await ok("create_book_v1", { ...create, p_fields: { title: "Different payload" } })).outcome, "existing");
  assert.deepEqual(await get(id), current);
  assert.equal((await update(id, "1", { status: "reading" })).revision, "2");
  current = await get(id);
  assert.equal((await update(id, "2", { status: "reading" })).changed, false);
  assert.deepEqual(await get(id), current);
  assert.equal((await owner.rpc("update_book_v1", { p_book_id: id, p_expected_revision: "1", p_changes: { status: "reading" } })).error?.code, "23514");
  await archive(id, "2", true);
  current = await get(id);
  assert.equal((await archive(id, "3", true)).changed, false);
  assert.deepEqual(await get(id), current);
  assert.equal((await owner.rpc("update_book_v1", { p_book_id: id, p_expected_revision: "3", p_changes: { status: "reading" } })).error?.code, "23514");
  assert.equal((await ok("create_book_v1", create)).outcome, "existing");
  assert.deepEqual(await get(id), current);
  assert.equal((await ok("list_books_v1", { p_scope: "archived", p_status: "reading" })).books[0].id, id);
  await archive(id, "3", false);
  assert.equal((await owner.rpc("set_book_archived_v1", { p_book_id: id, p_expected_revision: "2", p_archived: true })).error?.code, "23514");

  // One stable UUID across concurrent requests, including different payloads.
  const concurrentId = randomUUID();
  const creations = await Promise.all(["First", "Second"].map(title => owner.rpc("create_book_v1", { p_book_id: concurrentId, p_fields: { title } })));
  assert(creations.every(r => !r.error));
  assert.deepEqual(creations.map(r => r.data.outcome).sort(), ["created", "existing"]);
  const winnerIndex = creations.findIndex(r => r.data.outcome === "created");
  assert.equal((await get(concurrentId)).title, ["First", "Second"][winnerIndex]);
  const writes = await Promise.all(["Edit one", "Edit two"].map(title => owner.rpc("update_book_v1", { p_book_id: concurrentId, p_expected_revision: "1", p_changes: { title } })));
  assert.equal(writes.filter(r => !r.error).length, 1);
  assert.equal(writes.find(r => r.error).error.code, "23514");
  assert.equal((await get(concurrentId)).revision, "2");
  // Edit versus archive also shares the same row guard, with one winner.
  const races = await Promise.all([
    owner.rpc("update_book_v1", { p_book_id: concurrentId, p_expected_revision: "2", p_changes: { summary: "racing note" } }),
    owner.rpc("set_book_archived_v1", { p_book_id: concurrentId, p_expected_revision: "2", p_archived: true }),
  ]);
  assert.equal(races.filter(r => !r.error).length, 1);
  assert.equal(races.find(r => r.error).error.code, "23514");

  // Consume an actual committed HTTP response then discard it at the transport
  // boundary. The caller gets a transport failure, never the saved acknowledgement.
  const token = (await owner.auth.getSession()).data.session.access_token;
  let dropped = false;
  const lossy = createClient(env.url, env.key, {
    accessToken: async () => token,
    global: { fetch: async (url, options) => {
      const response = await fetch(url, options);
      assert(response.ok, "Response-loss fixture must first commit successfully");
      await response.arrayBuffer();
      dropped = true;
      throw new TypeError("Synthetic response lost after commit");
    } },
  });
  const lostId = randomUUID();
  const lostCreate = { p_book_id: lostId, p_fields: { title: "Response loss fixture" } };
  assert((await lossy.rpc("create_book_v1", lostCreate)).error);
  assert(dropped);
  assert.equal((await get(lostId)).revision, "1");
  assert.equal((await ok("create_book_v1", lostCreate)).outcome, "existing");
  const lostEdit = { p_book_id: lostId, p_expected_revision: "1", p_changes: { lessons: "Committed lesson" } };
  assert((await lossy.rpc("update_book_v1", lostEdit)).error);
  assert.equal((await get(lostId)).lessons, "Committed lesson");
  assert.equal((await owner.rpc("update_book_v1", lostEdit)).error?.code, "23514");
  assert((await lossy.rpc("set_book_archived_v1", { p_book_id: lostId, p_expected_revision: "2", p_archived: true })).error);
  assert((await get(lostId)).archived_at);
  await archive(lostId, "3", false);
  assert.equal((await owner.rpc("set_book_archived_v1", { p_book_id: lostId, p_expected_revision: "2", p_archived: true })).error?.code, "23514");

  // Same accepted/rejected corpus passes through TypeScript and real JSON/SQL.
  for (const p_fields of normalizationCases) {
    const n = normalizeBookFields(p_fields, "create"); assert(n.ok);
    const p_book_id = randomUUID();
    await ok("create_book_v1", { p_book_id, p_fields });
    const saved = await get(p_book_id);
    for (const [field, value] of Object.entries(n.value)) assert.equal(saved[field], value, `Shared normalization ${field}`);
    assert.equal((await update(p_book_id, "1", p_fields)).changed, false);
  }
  for (const cover of [...validCovers, ...invalidCovers]) {
    const accepted = validCovers.includes(cover);
    assert.equal(isCoverUrl(cover), accepted);
    const result = await owner.rpc("create_book_v1", { p_book_id: randomUUID(), p_fields: { title: "Cover syntax fixture", cover_url: cover } });
    assert.equal(!result.error, accepted, "Shared URL acceptance differs");
    if (!accepted) assert(["22023", "22P02", "22P05", "PGRST102"].includes(result.error.code),
      `Invalid cover case ${invalidCovers.indexOf(cover)} returned ${result.error.code}`);
  }
  // Duplicate titles allowed; bounded pages including maximum/default size.
  for (let n = 0; n < 105; n++) await ok("create_book_v1", { p_book_id: randomUUID(), p_fields: { title: "Pagination fixture" } });
  assert.equal((await ok("list_books_v1")).books.length, 50);
  assert.equal((await ok("list_books_v1", { p_limit: 100 })).books.length, 100);
  const seen = new Set(); let cursor = null;
  do {
    const page = await ok("list_books_v1", { p_limit: 7, p_after_created_at: cursor?.created_at, p_after_id: cursor?.id });
    for (const book of page.books) { assert(!seen.has(book.id)); seen.add(book.id); }
    cursor = page.next_cursor;
  } while (cursor);
  const direct = await owner.from("books").select("id").is("archived_at", null);
  assert(!direct.error); assert.equal(seen.size, direct.data.length);

  // A foreign row makes row-isolation assertions non-vacuous; RLS cannot be
  // replaced by the configured-owner gate alone. Administrative test fixture only.
  const foreignId = randomUUID();
  await env.sql(`INSERT INTO public.books(id,user_id,title) VALUES('${foreignId}','${env.other.id}','Foreign fixture');`);
  const missingId = randomUUID();
  for (const name of ["get_book_v1", "update_book_v1", "set_book_archived_v1"]) {
    const args = name === "get_book_v1" ? {} : name === "update_book_v1" ? { p_expected_revision: "1", p_changes: { title: "x" } } : { p_expected_revision: "1", p_archived: true };
    const foreign = await owner.rpc(name, { ...args, p_book_id: foreignId });
    const missing = await owner.rpc(name, { ...args, p_book_id: missingId });
    assert.equal(foreign.error?.code, "P0002"); assert.deepEqual(foreign.error, missing.error);
  }
  const collision = await owner.rpc("create_book_v1", { p_book_id: foreignId, p_fields: { title: "x" } });
  const missing = await owner.rpc("get_book_v1", { p_book_id: missingId });
  assert.deepEqual(collision.error, missing.error, "Collision must use uniform unavailable response");
  const visible = await owner.from("books").select("id,user_id");
  assert(!visible.error && visible.data.length > 0 && visible.data.every(row => row.user_id === env.owner.id));
  const hidden = await outsider.from("books").select("*");
  assert(!hidden.error && hidden.data.length === 0);
  assert((await anon.from("books").select("*")).error);
  for (const client of [owner, outsider, anon]) {
    assert((await client.from("books").insert({ id: randomUUID(), user_id: env.owner.id, title: "forged" })).error);
    for (const patch of [{ title: "forged" }, { user_id: env.other.id }, { id: randomUUID() }, { created_at: "2030-01-01" }, { revision: "99" }]) {
      assert((await client.from("books").update(patch).eq("id", id)).error);
    }
    assert((await client.from("books").delete().eq("id", id)).error);
    assert((await client.schema("system_internal").rpc("book_fields_v1", { value: {}, creating: true })).error);
  }
  assert.equal((await owner.rpc("create_book_v1", { p_book_id: randomUUID(), p_fields: { title: "x", user_id: env.other.id } })).error?.code, "22023");
  assert.equal((await owner.rpc("get_book_v1", { p_book_id: "malformed" })).error?.code, "22P02");
  for (const client of [outsider, anon]) for (const [name, args] of calls) {
    assert.equal((await client.rpc(name, args)).error?.code, "42501", `${name} entry guard`);
  }
  assert.equal(calls.size, 5);
  assert.equal(await engineSnapshot(), baseline, "Library changed unrelated domain state");

  // Exact bigint representation round-trips through PostgREST and all parsers.
  await env.sql(`UPDATE public.books SET revision=9007199254740993 WHERE id='${id}';`);
  assert.equal((await get(id)).revision, "9007199254740993");
  assert.equal((await update(id, "9007199254740993", { title: "Exact bigint" })).revision, "9007199254740994");
  return [...calls];
}
