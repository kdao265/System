import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const root = new URL("../src/", import.meta.url);
const mockUrl = `data:text/javascript,${encodeURIComponent(`
  export const calls = [], invalidations = [];
  export let response;
  export async function requireUser() { return { id: "10000000-0000-4000-8000-000000000001" }; }
  export async function createServerSupabaseClient() { return { rpc: async (name, args) => {
    calls.push({ name, args }); return response(name, args);
  } }; }
  export function revalidatePath(path) { invalidations.push(path); }
  export function configure(fn) { response = fn; calls.length = 0; invalidations.length = 0; }
`)}`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(root.href)) {
    if (["@/features/auth/session", "@/lib/supabase/server", "next/cache"].includes(specifier)) return { url: mockUrl, shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL(specifier.slice(2) + ".ts", root).href, shortCircuit: true };
    if (specifier.startsWith("./")) return next(specifier + ".ts", context);
  }
  return next(specifier, context);
} });
const { QuestManagementLifecycle, MANAGEMENT_PREFIX, getManagementServerSnapshot } = await import("../src/features/quests/management-lifecycle.ts");
const { manageQuest } = await import("../src/features/quests/management-action.ts");
const { calls, invalidations, configure } = await import(mockUrl);
hooks.deregister();
const userId = "10000000-0000-4000-8000-000000000001";
const questId = "20000000-0000-4000-8000-000000000001";
const commandId = "30000000-0000-4000-8000-000000000001";
const eventId = "40000000-0000-4000-8000-000000000001";
const key = MANAGEMENT_PREFIX + userId;
const unknown = { outcome: "unknown", operation: "archive" };
const success = { outcome: "success", operation: "archive", replay: true };
class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}
function setup(send = async () => unknown) {
  const storage = new Storage(), sent = [];
  let tail = Promise.resolve(), ids = 0;
  const deps = {
    storage: () => storage,
    uuid: () => { ids++; return commandId; },
    lock: (work) => { const result = tail.then(work); tail = result.catch(() => {}); return result; },
    send: async (previous, form) => {
      const data = Object.fromEntries(form);
      const pending = JSON.parse(storage.getItem(key));
      assert.equal(pending.commandId, data.command_id, "durable before send");
      assert.equal(pending.operation, data.operation);
      sent.push(data);
      return send(previous, form);
    },
  };
  return { storage, sent, deps, ids: () => ids, make: (account = userId) => new QuestManagementLifecycle(account, deps) };
}

for (const operation of ["archive", "restore", "delete"]) {
  test(`${operation}: lost response, remount and retry preserve exact identity and payload`, async () => {
    let count = 0;
    const h = setup(async () => { if (++count === 1) throw Error("transport"); return { ...success, operation }; });
    const a = h.make(); await a.recover(); await a.submit(questId, operation, "Quest");
    assert.equal(a.getSnapshot().phase, "uncertain");
    const b = h.make(); await b.recover(); await b.retry();
    assert.equal(h.sent.length, 2);
    assert.deepEqual(h.sent[1], { ...h.sent[0], mode: "retry" });
    assert.deepEqual(h.sent.map(x => x.mode), ["new", "retry"]);
    assert.equal(h.ids(), 1);
    assert.equal(h.storage.getItem(key), null);
    assert.equal(b.getSnapshot().phase, "ready");
  });
}
test("safe first rejection clears; rejection after uncertainty retains", async () => {
  const rejected = { outcome: "rejected", operation: "delete", reason: "completed" };
  const h = setup(async () => rejected), a = h.make();
  await a.recover(); await a.submit(questId, "delete", "Quest");
  assert.equal(h.storage.getItem(key), null);
  const j = setup(), b = j.make(); await b.recover(); await b.submit(questId, "archive", "Quest");
  j.deps.send = async () => rejected;
  await b.retry();
  assert.ok(j.storage.getItem(key)); assert.equal(b.getSnapshot().phase, "uncertain");
});
test("tabs serialize new commands and cannot replace an unresolved command", async () => {
  const h = setup(), a = h.make(), b = h.make();
  await Promise.all([a.recover(), b.recover()]);
  await Promise.all([a.submit(questId, "archive", "Quest"), b.submit(questId, "delete", "Quest")]);
  assert.equal(h.sent.length, 1); assert.equal(h.ids(), 1);
  assert.equal(b.getSnapshot().pending.operation, "archive");
});
test("missing storage is restored from memory; changed storage blocks", async () => {
  const h = setup(), a = h.make(); await a.recover(); await a.submit(questId, "archive", "Quest");
  h.storage.removeItem(key); await a.recover(); await a.retry();
  assert.equal(h.ids(), 1); assert.equal(h.sent[1].command_id, commandId);
  const changed = JSON.parse(h.storage.getItem(key)); changed.operation = "delete";
  h.storage.setItem(key, JSON.stringify(changed)); await a.recover();
  assert.equal(a.getSnapshot().phase, "blocked");
});
test("corrupt, unavailable storage and unavailable locks fail closed", async () => {
  for (const failure of ["corrupt", "storage", "lock", "write"]) {
    const h = setup();
    if (failure === "corrupt") h.storage.setItem(key, "broken");
    if (failure === "storage") h.deps.storage = () => { throw Error("blocked"); };
    if (failure === "lock") h.deps.lock = async () => { throw Error("blocked"); };
    if (failure === "write") h.storage.setItem = () => {};
    const a = h.make(); await a.recover(); await a.submit(questId, "archive", "Quest");
    assert.equal(a.getSnapshot().phase, "blocked"); assert.equal(h.sent.length, 0);
  }
});
test("late response after account deactivation cannot clear pending state", async () => {
  let finish;
  const h = setup(() => new Promise(resolve => { finish = resolve; })), a = h.make();
  await a.recover(); const sending = a.submit(questId, "archive", "Quest");
  await new Promise(resolve => setImmediate(resolve)); a.deactivate(); finish(success); await sending;
  assert.ok(h.storage.getItem(key)); assert.equal(a.getSnapshot().phase, "blocked");
  const b = h.make("10000000-0000-4000-8000-000000000002"); await b.recover();
  assert.equal(b.getSnapshot().pending, undefined);
});
function form(operation = "archive", mode = "new") {
  const f = new FormData();
  for (const [k,v] of Object.entries({ expected_account: userId, quest_id: questId, command_id: commandId, operation, mode })) f.set(k,v);
  return f;
}
test("late-hydrating streamed controls keep the original server snapshot after recovery", async () => {
  const h = setup(), a = h.make();
  const snapshot = getManagementServerSnapshot();
  await a.recover();
  assert.equal(a.getSnapshot().phase, "ready");
  assert.equal(getManagementServerSnapshot(), snapshot);
  assert.equal(snapshot.phase, "recovering");
});
test("Server Action passes supplied command unchanged, validates receipt and invalidates all surfaces", async () => {
  configure((_name, a) => ({ data: { command_id: a.p_command_id, quest_id: a.p_quest_id, archived: a.p_archived,
    archived_at: "2026-10-02T12:00:00Z", archived_event_id: eventId, changed: true, replay: false }, error: null }));
  assert.equal((await manageQuest({}, form())).outcome, "success");
  assert.equal(calls[0].args.p_command_id, commandId);
  assert.deepEqual(invalidations, ["/dashboard", "/goals", "/calendar"]);
});
test("Server Action refuses missing or malformed client command IDs before RPC", async () => {
  configure(() => { throw Error("must not send"); });
  for (const id of [null, "invalid"]) {
    const f = form(); if (id === null) f.delete("command_id"); else f.set("command_id", id);
    assert.equal((await manageQuest({}, f)).outcome, "rejected");
  }
  assert.equal(calls.length, 0);
});
test("RPC guard rejection is safe only on a first attempt; malformed receipts remain unknown", async () => {
  configure(() => ({ error: { code: "23514", message: "Reopen completed Quest before permanent deletion" } }));
  assert.equal((await manageQuest({}, form("delete"))).outcome, "rejected");
  assert.equal((await manageQuest({}, form("delete", "retry"))).outcome, "unknown");
  configure(() => ({ data: {}, error: null }));
  assert.equal((await manageQuest({}, form())).outcome, "unknown");
  assert.deepEqual(invalidations, []);
});
