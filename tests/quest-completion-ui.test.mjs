import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import ts from "typescript";
import { CompletionRenderer } from "./helpers/completion-renderer.mjs";

// All feature modules below are real. Only external Auth, RPC, cache/router and
// browser APIs are doubles. The component host runs context, effects and handlers.
const root = new URL("../src/", import.meta.url);
const hooksUrl = new URL("./helpers/completion-renderer.mjs", import.meta.url).href;
const mocksUrl = new URL("./helpers/completion-mocks.mjs", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root.href)) {
      if (specifier === "react") return { url: hooksUrl, shortCircuit: true };
      if (["@/features/auth/session", "@/lib/supabase/server", "@/lib/supabase/client", "next/cache", "next/navigation"].includes(specifier)) return { url: mocksUrl, shortCircuit: true };
      if (specifier.startsWith("@/") || specifier.startsWith("./")) {
        const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, context.parentURL);
        for (const extension of [".ts", ".tsx"]) {
          const url = new URL(base.href + extension);
          if (existsSync(url)) return { url: url.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { completeQuest } = await import("../src/features/quests/completion-action.ts");
const { validateQuestCompletionReceipt } = await import("../src/features/quests/completion-receipt.ts");
const { CompletionRecoveryLifecycle, COMPLETION_LOCK } = await import("../src/features/quests/completion-recovery.ts");
const { persistPendingCompletion, completionStorageKey, COMPLETION_PREFIX } = await import("../src/features/quests/completion-pending.ts");
const { QuestCompletionProvider, QuestReopenRead } = await import("../src/features/quests/completion-provider.tsx");
const { QuestCompletionControl } = await import("../src/features/quests/completion-control.tsx");
const { QuestReopenControl } = await import("../src/features/quests/completion-control.tsx");
const { QuestCompletionRecovery } = await import("../src/features/quests/completion-recovery-ui.tsx");
const { reopenQuest } = await import("../src/features/quests/reopen-action.ts");
const { ReopenRecoveryLifecycle } = await import("../src/features/quests/reopen-recovery.ts");
const { persistPendingReopen, reopenStorageKey } = await import("../src/features/quests/reopen-pending.ts");
const { configure, calls, invalidations, setRefresh, authCallbacks } = await import(mocksUrl);
hooks.deregister();

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const C = "20000000-0000-4000-8000-000000000001";
const D = "20000000-0000-4000-8000-000000000002";
const O = "30000000-0000-4000-8000-000000000001";
const P = "30000000-0000-4000-8000-000000000002";
const selectedDate = "2026-07-03";
const unknown = { outcome: "unknown", error: "lost response" };
const success = (message = "Historical completion confirmed.", replay = true) => ({ outcome: "success", success: { message, replay }, refreshRequired: false });
const pending = (commandId = C, occurrenceId = O, userId = A, executionCycle = 3) => ({ version: 1, userId, commandId, occurrenceId, executionCycle, reportedCompletedAt: null, origin: "web_ui" });
const receipt = (commandId = C, occurrenceId = O, amount = 0, replay = false) => ({
  command_id: commandId, occurrence_id: occurrenceId, quest_id: "50000000-0000-4000-8000-000000000001", execution_cycle: 3,
  completed_event_id: "40000000-0000-4000-8000-000000000001", exp_entry_id: "60000000-0000-4000-8000-000000000001",
  exp_amount: amount, reported_completed_at: null, recorded_completed_at: "2026-09-24T10:00:00Z", replay,
});
const reopenReceipt = (commandId = C, occurrenceId = O, replay = false) => ({
  command_id: commandId, occurrence_id: occurrenceId, quest_id: "50000000-0000-4000-8000-000000000001", undone_cycle: 3,
  correction_event_id: "40000000-0000-4000-8000-000000000001", reopened_event_id: "40000000-0000-4000-8000-000000000002",
  reversal_entry_id: "60000000-0000-4000-8000-000000000001", reversed_amount: "-37", original_credit_entry_id: "60000000-0000-4000-8000-000000000003", replay,
});
const day = (occurrenceId = O, cycle = 4) => ({ status: "ok", quests: [{
  occurrence_id: occurrenceId, execution_cycle: cycle, quest_id: "50000000-0000-4000-8000-000000000001",
  quest_title: "Synthetic Quest", status: "completed", scheduled_at: null, deadline_at: null, source_slot_date: null,
  reward_exp_snapshot: 37, progression_ready: true, completable: false, already_completed_cycle: cycle,
}] });
class Store {
  values = new Map(); fail;
  get length() { if (this.fail === "length") throw Error("unavailable"); return this.values.size; }
  key(index) { if (this.fail === "key") throw Error("unavailable"); return [...this.values.keys()][index] ?? null; }
  getItem(key) { if (this.fail === "get") throw Error("unavailable"); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.fail === "write") throw Error("quota"); this.values.set(key, value); }
  removeItem(key) { if (this.fail === "remove") throw Error("unavailable"); this.values.delete(key); }
}
const seed = (store, operation = pending()) => persistPendingCompletion(() => store, operation);
const immediateLock = async (_user, work) => work();
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup({ store = new Store(), send = async () => unknown, lock = immediateLock, account = A } = {}) {
  const sent = []; let ids = 0;
  const coordinator = new CompletionRecoveryLifecycle(account, {
    storage: () => store, lock, uuid: () => ++ids === 1 ? C : D,
    send: async (previous, form) => { sent.push(Object.fromEntries(form)); return send(previous, form); },
  });
  return { coordinator, store, sent, ids: () => ids };
}
function setupReopen({ store = new Store(), send = async () => unknown, lock = immediateLock, account = A } = {}) {
  const sent = []; let ids = 0;
  const coordinator = new ReopenRecoveryLifecycle(account, {
    storage: () => store, lock, uuid: () => ++ids === 1 ? C : D,
    send: async (previous, form) => { sent.push(Object.fromEntries(form)); return send(previous, form); },
  });
  return { coordinator, store, sent, ids: () => ids };
}
test.beforeEach(() => configure(() => { throw Error("unexpected RPC"); }, A));

function browser(t, store = new Store(), lock = immediateLock) {
  const originals = ["window", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const lockNames = []; const events = new Map(); let reloads = 0;
  const window = {
    localStorage: store, location: { pathname: "/dashboard", search: "?date=" + selectedDate, reload: () => { reloads++; } },
    addEventListener(name, listener) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); },
    removeEventListener(name, listener) { events.get(name)?.delete(listener); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: (name, work) => { lockNames.push(name); return lock(A, work); } } } });
  const renderer = new CompletionRenderer();
  t.after(() => {
    renderer.unmount();
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    assert.equal(authCallbacks.size, 0);
  });
  let rows = [O, P]; let reopenRows = []; let userId = A; let serverRead;
  const tree = () => createElement(QuestCompletionProvider, { userId },
    createElement(QuestCompletionRecovery, { key: "recovery", selectedDate }),
    serverRead && createElement(QuestReopenRead, { key: "read", userId, result: serverRead }),
    ...rows.map((occurrenceId) => createElement(QuestCompletionControl, { key: occurrenceId, userId, occurrenceId, executionCycle: 3, selectedDate })),
    ...reopenRows.map((occurrenceId) => createElement(QuestReopenControl, { key: "reopen-" + occurrenceId, occurrenceId, executionCycle: 3 })));
  const render = () => renderer.render(tree());
  const button = (label, commandId) => renderer.find((node) => node.type === "button" && node.props.children === label && (commandId === undefined || node.props["data-command-id"] === commandId));
  return {
    renderer, store, window, lockNames, events, render, button, reloads: () => reloads,
    async mount() { render(); await tick(); render(); },
    setRows(next) { rows = next; render(); },
    setReopenRows(next) { reopenRows = next; render(); },
    setAccount(next) { userId = next; render(); },
    setServerRead(result) { serverRead = result; render(); },
    async click(label, commandId) {
      render(); const controls = button(label, commandId); assert.ok(controls.length, "missing control: " + label);
      assert.equal(Boolean(controls[0].props.disabled), false, "disabled control: " + label);
      await controls[0].props.onClick(); render();
    },
  };
}

test("storage-removal failure after success keeps confirmation and cleanup retry sends no RPC", async () => {
  const h = setup({ send: async () => success() }); seed(h.store); await h.coordinator.recover();
  h.store.fail = "remove"; await h.coordinator.retry(C);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0], { expected_account: A, command_id: C, occurrence_id: O, execution_cycle: "3" });
  assert.equal(h.coordinator.getSnapshot().confirmations[0].cleanupPending, true);
  h.store.fail = undefined; await h.coordinator.retryConfirmation(C);
  assert.equal(h.sent.length, 1); assert.equal(h.store.length, 0);
  assert.equal(h.coordinator.getSnapshot().confirmations[0].cleanupPending, false);
});

test("actual provider, Recovery and two rows share one instance; removing a row preserves other consumers", async (t) => {
  configure(() => ({ data: null, error: { code: "network" } }), A);
  const h = browser(t); await h.mount();
  const readers = [...h.renderer.instances.values()].flatMap((item) => item.snapshotReaders);
  assert.equal(readers.length, 4); assert.equal(new Set(readers).size, 2);
  assert.equal(authCallbacks.size, 1);
  await h.click("Complete");
  const first = calls[0].args.command_id;
  assert.match(h.renderer.html(), /Retry exact completion/);
  h.setRows([P]);
  assert.equal(authCallbacks.size, 1); assert.equal(readers[0]().accountChanged, false);
  await h.click("Complete"); assert.equal(calls[1].args.occurrence_id, P);
  configure((_name, args) => ({ data: receipt(args.command_id, args.occurrence_id, 0, true), error: null }), A);
  await h.click("Retry exact completion", first);
  assert.equal(calls.length, 1); assert.equal(calls[0].args.command_id, first);
  assert.equal(readers[0]().confirmations.length, 1); assert.equal(readers[0]().operations.length, 1);
  assert.ok(h.lockNames.every((name) => name === COMPLETION_LOCK));
});

test("actual row mount and same-account refresh preserve requests and confirmations", async (t) => {
  configure((_name, args) => ({ data: receipt(args.command_id, args.occurrence_id), error: null }), A);
  const h = browser(t); await h.mount(); await h.click("Complete");
  const get = [...h.renderer.instances.values()].flatMap((item) => item.snapshotReaders)[0];
  const confirmed = get().confirmations;
  h.setRows([O]); h.setRows([O, P]); h.render();
  assert.deepEqual(get().confirmations, confirmed); assert.equal(get().accountChanged, false);
  const h2 = setup(); await h2.coordinator.submitForOccurrence(O, 3); h2.store.values.clear();
  const snapshot = h2.coordinator.getSnapshot(); h2.coordinator.changeAccount(A);
  assert.equal(h2.coordinator.getSnapshot(), snapshot);
  await h2.coordinator.recover(); assert.equal(h2.store.length, 1);
});

test("row unmount cancels its queued request only; owner and remaining row remain usable", async (t) => {
  let queued = false; const gate = deferred();
  const h = browser(t, new Store(), async (_user, work) => { if (queued) await gate.promise; return work(); });
  configure((_name, args) => ({ data: receipt(args.command_id, args.occurrence_id), error: null }), A);
  await h.mount(); queued = true;
  const submission = h.button("Complete")[0].props.onClick();
  h.setRows([P]); gate.resolve(); await submission; h.render();
  assert.equal(calls.length, 0); assert.equal(h.store.length, 0);
  queued = false; await h.click("Complete");
  assert.equal(calls.length, 1); assert.equal(calls[0].args.occurrence_id, P);
});

test("row unmount after dispatch lets the living Dashboard owner settle success", async (t) => {
  const response = deferred(); configure(() => response.promise, A);
  const h = browser(t); await h.mount();
  const task = h.button("Complete")[0].props.onClick();
  await tick(); assert.equal(calls.length, 1); h.setRows([P]);
  response.resolve({ data: receipt(calls[0].args.command_id, O), error: null });
  await task; h.render();
  assert.match(h.renderer.html(), /Quest completed/); assert.equal(h.store.length, 0);
});

test("owner unmount cancels queued dispatch; Strict Mode reactivation keeps known requests", async (t) => {
  let queued = false; const gate = deferred();
  const h = browser(t, new Store(), async (_user, work) => { if (queued) await gate.promise; return work(); });
  await h.mount(); queued = true;
  const task = h.button("Complete")[0].props.onClick(); h.renderer.unmount();
  gate.resolve(); await task; assert.equal(calls.length, 0); assert.equal(h.store.length, 0);
  const unit = setup(); await unit.coordinator.submitForOccurrence(O, 3);
  unit.store.values.clear(); unit.coordinator.deactivate(); unit.coordinator.activate(); await unit.coordinator.recover();
  assert.equal(unit.coordinator.getSnapshot().operations[0].commandId, C); assert.equal(unit.store.length, 1);
});

test("account mismatch through real action retains A's uncertain command; B cannot see it", async () => {
  const h = setup({ send: completeQuest }); seed(h.store); await h.coordinator.recover();
  configure(() => assert.fail("RPC must not run"), B); await h.coordinator.retry(C);
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(h.store.getItem(completionStorageKey(A, C))), pending());
  assert.equal(h.coordinator.getSnapshot().accountChanged, true);
  const b = setup({ store: h.store, account: B }); await b.coordinator.recover();
  assert.deepEqual(b.coordinator.getSnapshot().operations, []);
});

test("account-keyed provider remount isolates state and old queued callbacks", async (t) => {
  let queued = false; const gate = deferred();
  const h = browser(t, new Store(), async (_user, work) => { if (queued) await gate.promise; return work(); });
  await h.mount(); queued = true; const task = h.button("Complete")[0].props.onClick();
  h.setAccount(B); gate.resolve(); await task; await tick(); h.render();
  assert.equal(calls.length, 0); assert.equal(h.store.length, 0);
  const readers = [...h.renderer.instances.values()].flatMap((item) => item.snapshotReaders);
  assert.equal(new Set(readers).size, 2); assert.equal(readers[0]().accountChanged, false);
});

test("stale second tab discovers command C under lock and never allocates or dispatches D", async () => {
  const store = new Store(); const first = setup({ store }); const second = setup({ store });
  await second.coordinator.recover(); await first.coordinator.submitForOccurrence(O, 3);
  await second.coordinator.submitForOccurrence(O, 3);
  assert.equal(first.sent.length, 1); assert.equal(second.sent.length, 0); assert.equal(second.ids(), 0);
  assert.deepEqual(second.coordinator.getSnapshot().operations, [pending()]);
  await second.coordinator.retry(C);
  assert.equal(second.sent[0].command_id, C); assert.equal(store.length, 1);
});

test("storage corrupted after rendering but before lock acquisition blocks persistence and RPC", async () => {
  const gate = deferred(); let queue = false;
  const h = setup({ lock: async (_u, work) => { if (queue) await gate.promise; return work(); } });
  await h.coordinator.recover(); queue = true;
  const task = h.coordinator.submitForOccurrence(O, 3);
  h.store.setItem(COMPLETION_PREFIX + A + ":broken", "{"); gate.resolve(); await task;
  assert.equal(h.sent.length, 0); assert.equal(h.ids(), 0); assert.equal(h.store.length, 1);
  assert.equal(h.coordinator.getSnapshot().storage, "corrupt");
});

for (const failure of ["length", "key", "get", "write"]) test("storage " + failure + " failure blocks new dispatch", async () => {
  const h = setup(); h.store.setItem("unrelated", "preserved"); await h.coordinator.recover();
  h.store.fail = failure; await h.coordinator.submitForOccurrence(O, 3);
  assert.equal(h.sent.length, 0); assert.equal(h.coordinator.getSnapshot().phase, "blocked");
});

for (const mode of ["unavailable", "corrupt"]) test("in-memory-only request survives " + mode + " inventory and recovers exact original", async () => {
  const h = setup(); await h.coordinator.submitForOccurrence(O, 3); h.store.values.clear();
  if (mode === "unavailable") h.store.fail = "length"; else h.store.setItem(COMPLETION_PREFIX + A + ":broken", "{");
  await h.coordinator.recover();
  assert.equal(h.coordinator.getSnapshot().phase, "blocked"); assert.deepEqual(h.coordinator.getSnapshot().operations, [pending()]);
  h.store.fail = undefined; h.store.values.clear(); await h.coordinator.recover(); await h.coordinator.retry(C);
  assert.deepEqual(h.sent[1], h.sent[0]); assert.equal(h.ids(), 1);
});

test("changed stored immutable payload blocks without overwriting known memory", async () => {
  const h = setup(); await h.coordinator.submitForOccurrence(O, 3);
  h.store.setItem(completionStorageKey(A, C), JSON.stringify({ ...pending(), executionCycle: 4 }));
  await h.coordinator.recover(); assert.equal(h.coordinator.getSnapshot().phase, "blocked");
  assert.deepEqual(h.coordinator.getSnapshot().operations, [pending()]); assert.equal(h.sent.length, 1);
});

test("lost response and fresh same-account coordinator replay the entire saved request", async () => {
  const effects = new Map(); let lost = true;
  configure((_name, args) => {
    if (!effects.has(args.command_id)) effects.set(args.command_id, structuredClone(args));
    if (lost) { lost = false; throw Error("response lost after commit"); }
    assert.deepEqual(args, effects.get(args.command_id));
    return { data: receipt(args.command_id, args.occurrence_id, 0, true), error: null };
  }, A);
  const first = setup({ send: completeQuest }); await first.coordinator.submitForOccurrence(O, 3);
  const restored = setup({ store: first.store, send: completeQuest }); await restored.coordinator.recover(); await restored.coordinator.retry(C);
  assert.deepEqual(first.sent[0], restored.sent[0]); assert.equal(restored.ids(), 0);
  assert.equal(effects.size, 1); assert.equal(first.store.length, 0);
  assert.equal(restored.coordinator.getSnapshot().confirmations[0].replay, true);
});

test("actual Recovery remains rendered without rows and offers saved requests on another date", async (t) => {
  const store = new Store(); seed(store, pending(C, O, A, 7));
  const h = browser(t, store); h.setRows([]); await tick(); h.render();
  assert.equal(h.button("Retry exact completion", C).length, 1);
  assert.match(h.renderer.html(), /awaiting confirmation/);
});

test("two confirmed cleanup failures render two enabled controls; cleaning A preserves B and never sends again", async (t) => {
  const store = new Store(); seed(store); seed(store, pending(D, P));
  configure((_name, args) => ({ data: receipt(args.command_id, args.occurrence_id, 0, true), error: null }), A, true);
  const h = browser(t, store); h.setRows([]); await tick(); h.render(); store.fail = "remove";
  await h.click("Retry exact completion", C); await h.click("Retry exact completion", D);
  assert.equal(calls.length, 2); assert.equal(h.button("Retry recovery confirmation").length, 2);
  assert.match(h.renderer.html(), /Completion is confirmed. Refresh the Dashboard/);
  for (const node of h.button("Retry recovery confirmation")) assert.equal(node.props.disabled, false);
  assert.equal((h.renderer.html().match(/historical request/g) ?? []).length, 2);
  store.fail = undefined; await h.click("Retry recovery confirmation", C);
  assert.equal(h.button("Retry recovery confirmation", C).length, 0);
  assert.equal(h.button("Retry recovery confirmation", D).length, 1);
  assert.equal(h.button("Retry recovery confirmation", D)[0].props.disabled, false);
  await h.click("Retry recovery confirmation", D);
  assert.equal(calls.length, 2); assert.equal(store.length, 0);
  assert.equal(h.button("Retry recovery confirmation").length, 0);
  assert.equal((h.renderer.html().match(/historical request/g) ?? []).length, 2);
});

test("cleanup uses the same lock, cancels when owner deactivates, and never self-deadlocks", async () => {
  let held = false; let queue = false; let entries = 0; const gate = deferred();
  const h = setup({ send: async () => success(), lock: async (_u, work) => {
    if (queue) await gate.promise;
    assert.equal(held, false, "recursive lock acquisition"); held = true; entries++;
    try { return await work(); } finally { held = false; }
  } });
  seed(h.store); await h.coordinator.recover(); h.store.fail = "remove"; await h.coordinator.retry(C);
  h.store.fail = undefined; queue = true;
  const task = h.coordinator.retryConfirmation(C); h.coordinator.deactivate(); gate.resolve(); await task;
  assert.equal(h.store.length, 1); assert.equal(h.sent.length, 1);
  queue = false; h.coordinator.activate(); await h.coordinator.retryConfirmation(C);
  assert.equal(h.store.length, 0); assert.equal(h.sent.length, 1); assert.equal(entries, 4);
});

test("cleanup already performed by another tab is idempotent and remains confirmed", async () => {
  const h = setup({ send: async () => success() }); seed(h.store); await h.coordinator.recover();
  h.store.fail = "remove"; await h.coordinator.retry(C); h.store.fail = undefined; h.store.values.clear();
  await h.coordinator.retryConfirmation(C);
  assert.equal(h.coordinator.getSnapshot().confirmations[0].cleanupPending, false); assert.equal(h.sent.length, 1);
});

test("non-today refresh retry invokes actual UI router callback after invalidation throws, without mutation replay", async (t) => {
  const store = new Store(); seed(store);
  configure((_name, args) => ({ data: receipt(args.command_id, args.occurrence_id), error: null }), A, true);
  const h = browser(t, store); h.setRows([]); await tick(); h.render();
  await h.click("Retry exact completion", C);
  assert.equal(calls.length, 1); assert.equal(invalidations.length, 0);
  assert.match(h.renderer.html(), /Completion is confirmed. Refresh/);
  let refreshes = 0;
  setRefresh(() => { refreshes++; assert.equal(h.window.location.search, "?date=" + selectedDate); throw Error("refresh failed"); });
  await h.click("Refresh Dashboard");
  assert.equal(refreshes, 1); assert.match(h.renderer.html(), /Dashboard refresh failed/);
  assert.match(h.renderer.html(), /Quest completed/);
  setRefresh(() => { refreshes++; assert.equal(h.window.location.search, "?date=" + selectedDate); });
  await h.click("Refresh Dashboard");
  assert.equal(refreshes, 2); assert.equal(calls.length, 1); assert.equal(store.length, 0);
  assert.doesNotMatch(h.renderer.html(), /Dashboard refresh failed/);
  assert.ok(h.renderer.html().includes('href="/dashboard?date=' + selectedDate + '"'));
});

test("actual action returns refresh status and exact fixed RPC arguments", async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ expected_account: A, command_id: C, occurrence_id: O, execution_cycle: "3" })) form.set(key, value);
  for (const throwing of [false, true]) {
    configure(() => ({ data: receipt(), error: null }), A, throwing);
    const result = await completeQuest({}, form);
    assert.equal(result.outcome, "success"); assert.equal(result.refreshRequired, throwing);
    assert.deepEqual(calls, [{ name: "complete_quest_occurrence", args: { command_id: C, occurrence_id: O, expected_execution_cycle: 3, reported_completed_at: null, origin: "web_ui" } }]);
  }
});

test("all ten receipt fields are required; zero and exact bigint strings remain safe", () => {
  const good = receipt();
  for (const key of Object.keys(good)) {
    const missing = { ...good }; delete missing[key];
    assert.equal(validateQuestCompletionReceipt(missing, C, O, 3), false);
    assert.equal(validateQuestCompletionReceipt({ ...good, [key]: undefined }, C, O, 3), false);
  }
  assert.equal(validateQuestCompletionReceipt(good, C, O, 3), true);
  for (const value of ["9223372036854775807", "0"]) assert.equal(validateQuestCompletionReceipt({ ...good, exp_amount: value }, C, O, 3), true);
  for (const value of ["9223372036854775808", Number.MAX_SAFE_INTEGER + 1, -1]) assert.equal(validateQuestCompletionReceipt({ ...good, exp_amount: value }, C, O, 3), false);
});

test("double click dispatches once; rejected retry and malformed receipt retain original request", async () => {
  const wait = deferred(); const h = setup({ send: () => wait.promise });
  const first = h.coordinator.submitForOccurrence(O, 3); await tick();
  await h.coordinator.submitForOccurrence(O, 3); assert.equal(h.sent.length, 1);
  wait.resolve(unknown); await first;
  const rejected = setup({ store: h.store, send: async () => ({ outcome: "rejected", reason: "validation", error: "invalid" }) });
  await rejected.coordinator.recover(); await rejected.coordinator.retry(C);
  assert.equal(h.store.length, 1); assert.equal(rejected.coordinator.getSnapshot().operations[0].commandId, C);
  configure(() => ({ data: { ...receipt(), exp_amount: -1 }, error: null }), A);
  const invalid = setup({ store: h.store, send: completeQuest }); await invalid.coordinator.recover(); await invalid.coordinator.retry(C);
  assert.equal(invalid.coordinator.getSnapshot().phase, "uncertain"); assert.equal(h.store.length, 1);
});

test("completion cleanup preserves every creation and foreign-account record", async () => {
  const h = setup({ send: async () => success() });
  const creationKey = "system.quest-creation.pending.v2:" + A + ":original";
  h.store.setItem(creationKey, "creation"); seed(h.store, pending(D, P, B));
  await h.coordinator.submitForOccurrence(O, 3);
  assert.equal(h.store.getItem(creationKey), "creation");
  assert.deepEqual(JSON.parse(h.store.getItem(completionStorageKey(B, D))), pending(D, P, B));
});

test("reopen action sends the V2 cycle guard and reports cache refresh state", async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ expected_account: A, command_id: C, occurrence_id: O, execution_cycle: "3" })) form.set(key, value);
  configure((_name, args) => ({ data: reopenReceipt(args.command_id, args.occurrence_id), error: null }), A, true);
  const result = await reopenQuest({}, form);
  assert.equal(result.outcome, "success"); assert.equal(result.refreshRequired, true);
  assert.deepEqual(calls, [{ name: "reopen_quest_occurrence_v2", args: { command_id: C, occurrence_id: O, expected_execution_cycle: 3, origin: "web_ui" } }]);
});

test("completed-row reopen requires confirmation and settles through the shared provider", async (t) => {
  configure((_name, args) => ({ data: reopenReceipt(args.command_id, args.occurrence_id), error: null }), A);
  const h = browser(t); h.setRows([]); h.setReopenRows([O]); await h.mount();
  await h.click("Reopen"); assert.match(h.renderer.html(), /Confirm reopen/);
  await h.click("Confirm reopen"); await tick(); h.render();
  assert.equal(calls[0].name, "reopen_quest_occurrence_v2"); assert.equal(calls[0].args.occurrence_id, O); assert.match(h.renderer.html(), /Reopen confirmed/);
});

test("reopen lost response retries the identical command and never allocates a second command", async () => {
  const effects = []; let first = true;
  const h = setupReopen({ send: async (_previous, form) => { effects.push(Object.fromEntries(form)); if (first) { first = false; return { outcome: "unknown", error: "lost response" }; } return { outcome: "success", success: { message: "Reopen confirmed.", replay: true }, refreshRequired: false }; } });
  await h.coordinator.submitForOccurrence(O, 3); await h.coordinator.recover(); await h.coordinator.retry(C);
  assert.deepEqual(effects[1], effects[0]); assert.equal(h.ids(), 1); assert.equal(h.coordinator.getSnapshot().confirmations[0].replay, true); assert.equal(h.store.length, 0);
});

test("reopen stale-cycle rejection retains a blocker until a relevant fresh server read", async () => {
  const h = setupReopen({ send: async () => ({ outcome: "rejected", reason: "stale", refreshRequired: true, error: "stale" }) });
  await h.coordinator.submitForOccurrence(O, 3);
  assert.equal(h.store.length, 1); assert.equal(h.coordinator.getSnapshot().refreshRequired, true);
  await h.coordinator.recover();
  await h.coordinator.refreshDashboard(() => {});
  await h.coordinator.submitForOccurrence(O, 3);
  await h.coordinator.submitForOccurrence(O, 4);
  assert.equal(h.sent.length, 1); assert.equal(h.ids(), 1);
  assert.equal(h.coordinator.getSnapshot().phase, "awaiting-refresh");
  for (const [owner, result] of [[A, { status: "unavailable" }], [B, day(O, 4)], [A, day(P, 4)], [A, day(O, 3)], [A, day(O, 2)]]) {
    await h.coordinator.observeServerRead(owner, result);
    assert.equal(h.coordinator.getSnapshot().phase, "awaiting-refresh");
  }
  await h.coordinator.observeServerRead(A, day(O, 4));
  assert.equal(h.coordinator.getSnapshot().phase, "ready");
  assert.equal(h.coordinator.getSnapshot().refreshRequired, false);
  await h.coordinator.submitForOccurrence(O, 3);
  assert.equal(h.sent.length, 1);
  await h.coordinator.submitForOccurrence(O, 4);
  assert.equal(h.sent.length, 2); assert.equal(h.sent[1].execution_cycle, "4");
});

test("unclassified reopen failure retains the exact request for recovery", async () => {
  const h = setupReopen({ send: async () => ({ outcome: "unknown", error: "conflict" }) });
  await h.coordinator.submitForOccurrence(O, 3);
  assert.equal(h.coordinator.getSnapshot().operations[0].commandId, C); assert.equal(h.store.getItem(reopenStorageKey(A, C)) !== null, true);
  assert.match(h.coordinator.getSnapshot().error, /conflict/);
  const operation = JSON.parse(h.store.getItem(reopenStorageKey(A, C))); persistPendingReopen(() => h.store, { ...operation, commandId: D });
  assert.equal(h.store.length, 2);
});

test("reopen action distinguishes exact V2 rejection messages from generic SQL errors", async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ expected_account: A, command_id: C, occurrence_id: O, execution_cycle: "3" })) form.set(key, value);
  for (const [code, message, outcome, reason] of [
    ["23505", "Conflicting quest command reuse", "rejected", "conflict"],
    ["23505", "duplicate key value violates unique constraint", "unknown", undefined],
    ["23514", "Stale quest reopen cycle", "rejected", "stale"],
    ["23514", "Accepted reversal receipt is missing", "unknown", undefined],
    ["23514", "Unknown quest occurrence", "unknown", undefined],
  ]) {
    configure(() => ({ data: null, error: { code, message } }), A);
    const result = await reopenQuest({}, form);
    assert.equal(result.outcome, outcome); assert.equal(result.reason, reason);
  }
});

test("reopen definitive conflict survives focus and reload without identical retries or replacement IDs", async () => {
  configure(() => ({ data: null, error: { code: "23505", message: "Conflicting quest command reuse" } }), A);
  const h = setupReopen({ send: reopenQuest }); await h.coordinator.submitForOccurrence(O, 3);
  const before = [...h.store.values];
  await h.coordinator.recover(); await h.coordinator.retry(C); await h.coordinator.submitForOccurrence(O, 3);
  assert.equal(h.coordinator.getSnapshot().phase, "blocked"); assert.equal(h.sent.length, 1); assert.equal(h.ids(), 1);
  const restored = setupReopen({ store: h.store, send: reopenQuest }); await restored.coordinator.recover();
  await restored.coordinator.retry(C); await restored.coordinator.submitForOccurrence(O, 3);
  assert.equal(restored.sent.length, 0); assert.equal(restored.ids(), 0); assert.deepEqual([...h.store.values], before);
  const other = setupReopen({ store: h.store, account: B }); await other.coordinator.recover();
  assert.equal(other.coordinator.getSnapshot().phase, "ready");
});

test("reopen stale blocker survives reload and storage cleanup failure", async () => {
  const h = setupReopen({ send: async () => ({ outcome: "rejected", reason: "stale", refreshRequired: true, error: "stale" }) });
  await h.coordinator.submitForOccurrence(O, 3);
  const restored = setupReopen({ store: h.store }); await restored.coordinator.recover();
  await restored.coordinator.retry(C); await restored.coordinator.submitForOccurrence(O, 3);
  assert.equal(restored.sent.length, 0); assert.equal(restored.coordinator.getSnapshot().phase, "awaiting-refresh");
  h.store.fail = "remove"; await restored.coordinator.observeServerRead(A, day());
  assert.equal(restored.coordinator.getSnapshot().phase, "blocked"); assert.equal(h.store.length, 1);
  h.store.fail = undefined; await restored.coordinator.observeServerRead(A, day());
  assert.equal(restored.coordinator.getSnapshot().phase, "ready"); assert.equal(h.store.length, 0);
});

test("reopen UI refreshes stale state once, keeps date and controls on failure, and accepts server read acknowledgement", async (t) => {
  configure(() => ({ data: null, error: { code: "23514", message: "Stale quest reopen cycle" } }), A);
  const h = browser(t); h.setRows([]); h.setReopenRows([O]); await h.mount();
  let refreshes = 0; setRefresh(() => { refreshes++; throw Error("offline"); });
  await h.click("Reopen"); await h.click("Confirm reopen"); await tick(); h.render(); await tick(); h.render();
  assert.equal(refreshes, 1); assert.match(h.renderer.html(), /Dashboard refresh failed/);
  for (const listener of h.events.get("focus")) listener();
  await tick(); h.render();
  assert.equal(h.button("Refresh Dashboard").length, 1); assert.equal(h.button("Reopen").length, 0);
  assert.ok(h.renderer.html().includes('href="/dashboard?date=' + selectedDate + '"'));
  setRefresh(() => { refreshes++; }); await h.click("Refresh Dashboard"); await tick(); h.render();
  assert.match(h.renderer.html(), /fresh Dashboard read/); assert.equal(calls.length, 1);
  h.setServerRead({ status: "unavailable" }); await tick(); h.render();
  assert.match(h.renderer.html(), /fresh Dashboard read/);
  h.setReopenRows([]); h.setServerRead(day()); await tick(); h.render();
  assert.doesNotMatch(h.renderer.html(), /fresh Dashboard read/); assert.equal(calls.length, 1);
});

test("reopen conflict UI offers reconciliation rather than an exact retry", async (t) => {
  configure(() => ({ data: null, error: { code: "23505", message: "Conflicting quest command reuse" } }), A);
  const h = browser(t); h.setRows([]); h.setReopenRows([O]); await h.mount();
  await h.click("Reopen"); await h.click("Confirm reopen"); await tick(); h.render();
  assert.match(h.renderer.html(), /conflict/i); assert.equal(h.button("Retry exact reopen").length, 0);
  assert.equal(h.button("Reopen").length, 0); assert.equal(calls.length, 1);
});

test("reopen confirmed payload corruption blocks recovery and cleanup while retaining evidence", async () => {
  const h = setupReopen({ send: async () => success("Reopen confirmed.") });
  h.store.fail = "remove"; await h.coordinator.submitForOccurrence(O, 3); h.store.fail = undefined;
  const key = reopenStorageKey(A, C); const original = h.store.getItem(key);
  const confirmation = structuredClone(h.coordinator.getSnapshot().confirmations[0]);
  const changed = JSON.stringify({ ...JSON.parse(original), executionCycle: 4 }); h.store.setItem(key, changed);
  await h.coordinator.recover(); await h.coordinator.retryConfirmation(C); await h.coordinator.submitForOccurrence(P, 3);
  assert.equal(h.coordinator.getSnapshot().phase, "blocked"); assert.equal(h.coordinator.getSnapshot().storage, "corrupt");
  assert.match(h.coordinator.getSnapshot().error, /changed|unreadable/);
  assert.deepEqual(h.coordinator.getSnapshot().confirmations[0], confirmation);
  assert.equal(h.store.getItem(key), changed); assert.equal(h.sent.length, 1);
  h.store.setItem(key, original); await h.coordinator.recover(); await h.coordinator.retryConfirmation(C);
  assert.equal(h.store.length, 0); assert.equal(h.sent.length, 1);
});

test("reopen lost response reload replays immutable payload and cleanup failure never resends confirmed command", async () => {
  let lost = true; const effects = new Map();
  configure((_name, args) => {
    if (!effects.has(args.command_id)) effects.set(args.command_id, structuredClone(args));
    assert.deepEqual(args, effects.get(args.command_id));
    if (lost) { lost = false; throw Error("lost after commit"); }
    return { data: reopenReceipt(args.command_id, args.occurrence_id, true), error: null };
  }, A);
  const first = setupReopen({ send: reopenQuest }); await first.coordinator.submitForOccurrence(O, 3);
  const restored = setupReopen({ store: first.store, send: reopenQuest }); await restored.coordinator.recover();
  first.store.fail = "remove"; await restored.coordinator.retry(C);
  assert.deepEqual(first.sent[0], restored.sent[0]); assert.equal(restored.ids(), 0);
  first.store.fail = undefined; await restored.coordinator.retryConfirmation(C);
  await restored.coordinator.submitForOccurrence(O, 3);
  assert.equal(effects.size, 1); assert.equal(calls.length, 2); assert.equal(first.store.length, 0);
});

test("server read arriving while recovery holds the shared lock is not dropped", async () => {
  const first = setupReopen({ send: async () => ({ outcome: "rejected", reason: "stale", refreshRequired: true, error: "stale" }) });
  await first.coordinator.submitForOccurrence(O, 3);
  const gate = deferred();
  const restored = setupReopen({ store: first.store, lock: async (_user, work) => { await gate.promise; return work(); } });
  const recovery = restored.coordinator.recover();
  await restored.coordinator.observeServerRead(A, day()); gate.resolve(); await recovery; await tick();
  assert.equal(restored.coordinator.getSnapshot().phase, "ready"); assert.equal(first.store.length, 0);
  assert.equal(restored.sent.length, 0);
});

test("another tab's definitive conflict blocks a previously captured pending retry", async () => {
  const first = setupReopen(); await first.coordinator.submitForOccurrence(O, 3);
  const second = setupReopen({ store: first.store, send: async () => ({ outcome: "rejected", reason: "conflict", refreshRequired: false, error: "conflict" }) });
  await second.coordinator.recover(); await second.coordinator.retry(C);
  await first.coordinator.retry(C);
  assert.equal(first.sent.length, 1); assert.equal(first.coordinator.getSnapshot().phase, "blocked");
  assert.equal(first.coordinator.getSnapshot().blocks[0].operation.commandId, C);
});

test("confirmed immutable subject changes block direct cleanup even without an inventory event", async () => {
  const h = setupReopen({ send: async () => success("Reopen confirmed.") });
  h.store.fail = "remove"; await h.coordinator.submitForOccurrence(O, 3); h.store.fail = undefined;
  const key = reopenStorageKey(A, C);
  const changed = JSON.stringify({ ...JSON.parse(h.store.getItem(key)), occurrenceId: P }); h.store.setItem(key, changed);
  await h.coordinator.retryConfirmation(C);
  assert.equal(h.coordinator.getSnapshot().storage, "corrupt"); assert.equal(h.store.getItem(key), changed);
  assert.equal(h.coordinator.getSnapshot().confirmations[0].operation.occurrenceId, O); assert.equal(h.sent.length, 1);
});

test("server read with unavailable Web Locks blocks without scheduling an automatic retry loop", async () => {
  let attempts = 0;
  const h = setupReopen({ lock: async () => { attempts++; throw Error("Web Locks unavailable"); } });
  await h.coordinator.observeServerRead(A, day()); await tick();
  assert.equal(attempts, 1); assert.equal(h.coordinator.getSnapshot().phase, "blocked");
  assert.equal(h.sent.length, 0);
});
