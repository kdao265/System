// Focused L2 integration. Own disposable targets only; no app build or browser.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { startAuthEnvironment } from "./helpers/auth-environment.mjs";
import { exerciseLibraryWire } from "../supabase/tests/helpers/library-wire.mjs";

assert.notEqual(process.env.SYSTEM_E2E_PRESERVE, "1", "Library integration requires disposable cleanup");
const bridgeUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { readClient: null, writeClient: null, refreshFailure: false, paths: [] };
  export async function createServerSupabaseClient(readOnly = false) { return readOnly ? state.readClient : state.writeClient; }
  export function revalidatePath(path) { state.paths.push(path); if (state.refreshFailure) throw new Error("Synthetic refresh failure"); }
`)}`;
const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (["@/lib/supabase/server", "next/cache"].includes(specifier)) return { url: bridgeUrl, shortCircuit: true };
    if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
    if (specifier.startsWith("@/") || specifier.startsWith("./")) {
      const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, context.parentURL);
      const url = new URL(base.href + ".ts");
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
} });
const actions = await import("../src/features/library/actions.ts");
const { getBooks, getBook } = await import("../src/features/library/data.ts");
const { state } = await import(bridgeUrl);
hooks.deregister();

const env = await startAuthEnvironment({ buildApp: false });
const clients = [];
const previousOwner = process.env.SYSTEM_OWNER_USER_ID;
let groups = 0;
const pass = label => { groups++; console.log(`PASS: ${label}`); };
async function login(account) {
  const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(client);
  if (account) assert(!(await client.auth.signInWithPassword(account)).error, "Disposable login failed");
  return client;
}
function selectClient(client) { state.readClient = state.writeClient = client; state.refreshFailure = false; state.paths = []; }
const redirect = e => e.digest?.includes(";/login;");
try {
  const owner = await login({ email: env.owner.email, password: env.owner.password });
  const outsider = await login({ email: env.other.email, password: env.other.password });
  const anon = await login();
  process.env.SYSTEM_OWNER_USER_ID = env.owner.id;
  const userId = env.owner.id;
  const bookId = randomUUID();
  const identity = { userId, bookId };
  const request = { ...identity, fields: { title: "Application wire book", content_notes: "Synthetic personal notes" } };
  const base = revision => ({ ...identity, expected_revision: revision });
  for (const client of [anon, outsider]) {
    selectClient(client);
    for (const action of Object.values(actions)) await assert.rejects(action(request), redirect);
    await assert.rejects(getBooks(), redirect); await assert.rejects(getBook(bookId), redirect);
  }
  selectClient(owner); process.env.SYSTEM_OWNER_USER_ID = "";
  await assert.rejects(actions.createBook(request), redirect);
  process.env.SYSTEM_OWNER_USER_ID = userId;
  assert.equal((await actions.createBook(request)).outcome, "onboarding_required");
  const profile = await owner.from("profiles").update({ timezone: "UTC" }).eq("user_id", userId).select("user_id");
  assert(!profile.error && profile.data.length === 1, "Disposable profile setup failed");
  assert.equal((await actions.createBook({ ...request, userId: env.other.id })).outcome, "unauthorized");
  pass("real Auth/configured-owner/onboarding gates and forged account rejection");

  const made = await actions.createBook(request);
  assert.equal(made.effect, "created"); assert.equal(made.revision, "1");
  const existing = await actions.createBook({ ...request, fields: { title: "Cannot overwrite" } });
  assert.equal(existing.effect, "existing"); assert.equal(existing.book.title, request.fields.title);
  let current = await getBook(bookId);
  assert.equal(current.outcome, "success"); assert.equal(current.value.content_notes, request.fields.content_notes);
  const listed = await getBooks();
  assert.equal(listed.outcome, "success"); assert.equal("content_notes" in listed.value.books[0], false);
  assert.equal((await getBook(randomUUID())).outcome, "not_found");
  pass("real create, existing identity, metadata list and full detail projection");

  assert.equal((await actions.editBook({ ...base("1"), changes: { title: "Changed", lessons: "Synthetic lesson" } })).revision, "2");
  assert.equal((await actions.editBook({ ...base("2"), changes: { title: "Changed" } })).effect, "unchanged");
  assert.equal((await actions.editBook({ ...base("1"), changes: { title: "Changed" } })).reason, "stale_revision");
  let revision = "2";
  for (const status of ["reading", "finished", "want_to_read"]) {
    const result = await actions.setBookStatus({ ...base(revision), status });
    assert.equal(result.outcome, "success"); revision = result.revision;
  }
  const archived = await actions.archiveBook(base(revision)); revision = archived.revision;
  assert.equal(archived.effect, "updated");
  assert.equal((await actions.archiveBook(base(revision))).effect, "unchanged");
  assert.equal((await actions.editBook({ ...base(revision), changes: { title: "Changed" } })).reason, "archived");
  assert.equal((await getBooks({ scope: "archived", status: "want_to_read" })).value.books[0].id, bookId);
  const restored = await actions.restoreBook(base(revision)); revision = restored.revision;
  assert.equal((await actions.restoreBook(base(revision))).effect, "unchanged");
  assert.equal((await getBook(bookId)).value.content_notes, request.fields.content_notes);
  pass("real edit/status/archive/restore revisions, no-ops, conflicts and content retention");

  const foreign = randomUUID();
  await env.sql(`INSERT INTO public.books(id,user_id,title) VALUES('${foreign}','${env.other.id}','Foreign synthetic fixture');`);
  assert.equal((await actions.createBook({ ...request, bookId: foreign })).outcome, "not_found");
  assert.equal((await getBook(foreign)).outcome, "not_found");
  pass("foreign stable-ID collision privacy through application adapters");

  // Consume the actual successful HTTP response before dropping it. Read-side
  // auth/profile/reconciliation uses the ordinary owner client and real RPCs.
  const token = (await owner.auth.getSession()).data.session.access_token;
  let dropped = 0;
  let afterDrop = null;
  const lossy = createClient(env.url, env.key, { accessToken: async () => token,
    global: { fetch: async (url, options) => {
      const response = await fetch(url, options);
      assert(response.ok, "Response-loss fixture must commit first");
      await response.arrayBuffer(); dropped++;
      if (afterDrop) await afterDrop();
      throw new TypeError("Synthetic lost HTTP response after commit");
    } } });
  state.writeClient = lossy; // accessToken clients have no auth timers/API.
  const lostId = randomUUID();
  const recoveredCreate = await actions.createBook({ ...request, bookId: lostId });
  assert.equal(recoveredCreate.effect, "existing"); assert.equal(recoveredCreate.evidence, "current_state");
  assert.equal((await actions.resolveBookCreate({ userId, bookId: lostId })).effect, "existing");
  const recoveredEdit = await actions.editBook({ ...base(revision), changes: { summary: "Saved through loss" } });
  assert.equal(recoveredEdit.effect, "observed"); revision = recoveredEdit.revision;
  const recoveredStatus = await actions.setBookStatus({ ...base(revision), status: "finished" });
  assert.equal(recoveredStatus.effect, "observed"); revision = recoveredStatus.revision;
  const recoveredArchive = await actions.archiveBook(base(revision));
  assert.equal(recoveredArchive.effect, "observed"); revision = recoveredArchive.revision;
  const recoveredRestore = await actions.restoreBook(base(revision));
  assert.equal(recoveredRestore.effect, "observed"); revision = recoveredRestore.revision;
  assert.equal(dropped, 5);
  pass("actual committed HTTP response loss reconciled for every mutation without replay");

  afterDrop = async () => {
    const result = await owner.rpc("set_book_archived_v1", { p_book_id: bookId,
      p_expected_revision: (BigInt(revision) + BigInt(1)).toString(), p_archived: false });
    assert(!result.error, "Opposing later restore must commit");
  };
  assert.equal((await actions.archiveBook(base(revision))).outcome, "conflict");
  current = await getBook(bookId); assert.equal(current.value.archived_at, null);
  selectClient(owner);
  assert.equal((await actions.archiveBook(base(revision))).reason, "stale_revision");
  pass("lost archive followed by later restore cannot reverse intervening intent");

  state.refreshFailure = true;
  const saved = await actions.editBook({ ...base(current.value.revision), changes: { author: "Writer" } });
  assert.equal(saved.outcome, "success"); assert.equal(saved.refreshRequired, true);
  assert.equal((await getBook(bookId)).value.author, "Writer");
  pass("real committed mutation remains saved when cache invalidation fails");

  for (const suite of ["library-books-catalog", "library-books"]) {
    await env.sql(readFileSync(new URL(`../supabase/tests/${suite}.sql`, import.meta.url), "utf8"));
    pass(`unchanged L1 ${suite} SQL suite`);
  }
  await exerciseLibraryWire(env, owner, outsider, anon);
  pass("unchanged L1 wire coverage: concurrency, privacy, normalization, pagination and loss");
  console.log(`PASS: ${groups} Library application/database integration groups`);
} finally {
  if (previousOwner === undefined) delete process.env.SYSTEM_OWNER_USER_ID;
  else process.env.SYSTEM_OWNER_USER_ID = previousOwner;
  try { for (const client of clients) { if (typeof client.auth.stopAutoRefresh === "function") client.auth.stopAutoRefresh(); } }
  finally { await env.close(); }
}
