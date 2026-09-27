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
const { resolveQuestCompletion } = await import("../src/features/quests/completion-resolution-action.ts");
const { validateCompletionResolution } = await import("../src/features/quests/completion-resolution.ts");
const { validateQuestCompletionReceipt } = await import("../src/features/quests/completion-receipt.ts");
const { CompletionRecoveryLifecycle, COMPLETION_LOCK } = await import("../src/features/quests/completion-recovery.ts");
const { persistPendingCompletion, persistCompletionDisposition, readPendingCompletions, removePendingCompletion, completionStorageKey, COMPLETION_PREFIX } = await import("../src/features/quests/completion-pending.ts");
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
const resolution = (outcome = "unrecorded_current", commandId = C, occurrenceId = O) => ({
  version: 1, outcome, command_id: commandId, occurrence_id: occurrenceId, expected_execution_cycle: 3,
  current_execution_cycle: outcome === "unrecorded_superseded" || outcome === "recorded" ? 4 : 3,
  current_status: "scheduled", receipt: outcome === "recorded" ? receipt(commandId, occurrenceId, 37, true) : null,
  canonical_receipt: outcome === "unrecorded_superseded" ? receipt(D, occurrenceId, 37, true) : null,
  correction_event_id: outcome === "unrecorded_superseded" ? "40000000-0000-4000-8000-000000000002" : null,
  reopened_event_id: outcome === "unrecorded_superseded" ? "40000000-0000-4000-8000-000000000003" : null,
  reversal_entry_id: outcome === "unrecorded_superseded" ? "60000000-0000-4000-8000-000000000002" : null,
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
function setup({ store = new Store(), send = async () => unknown, resolve = async (_previous, form) => ({ outcome: "resolved", resolution: resolution("unrecorded_current", form.get("command_id"), form.get("occurrence_id")) }), lock = immediateLock, account = A } = {}) {
  const sent = []; const checked = []; let ids = 0;
  const coordinator = new CompletionRecoveryLifecycle(account, {
    storage: () => store, lock, uuid: () => ++ids === 1 ? C : D,
    send: async (previous, form) => { sent.push(Object.fromEntries(form)); return send(previous, form); },
    resolve: async (previous, form) => { checked.push(Object.fromEntries(form)); return resolve(previous, form); },
  });
  return { coordinator, store, sent, checked, ids: () => ids };
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
  assert.match(h.renderer.html(), /Check completion resolution/);
  h.setRows([P]);
  assert.equal(authCallbacks.size, 1); assert.equal(readers[0]().accountChanged, false);
  await h.click("Complete"); assert.equal(calls[1].args.occurrence_id, P);
  configure((_name, args) => ({ data: resolution("recorded", args.command_id, args.occurrence_id), error: null }), A);
  await h.click("Check completion resolution", first);
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
  assert.equal(h.button("Check completion resolution", C).length, 1);
  assert.match(h.renderer.html(), /awaiting confirmation/);
});

test("two confirmed cleanup failures render two enabled controls; cleaning A preserves B and never sends again", async (t) => {
  const store = new Store(); seed(store); seed(store, pending(D, P));
  configure((_name, args) => ({ data: resolution("recorded", args.command_id, args.occurrence_id), error: null }), A, true);
  const h = browser(t, store); h.setRows([]); await tick(); h.render(); store.fail = "remove";
  await h.click("Check completion resolution", C); await h.click("Check completion resolution", D);
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

test("non-today refresh retry invokes actual UI router callback after historical resolution, without mutation replay", async (t) => {
  const store = new Store(); seed(store);
  configure((_name, args) => ({ data: resolution("recorded", args.command_id, args.occurrence_id), error: null }), A, true);
  const h = browser(t, store); h.setRows([]); await tick(); h.render();
  await h.click("Check completion resolution", C);
  assert.equal(calls.length, 1); assert.equal(invalidations.length, 0);
  assert.match(h.renderer.html(), /Completion is confirmed. Refresh/);
  let refreshes = 0;
  setRefresh(() => { refreshes++; assert.equal(h.window.location.search, "?date=" + selectedDate); throw Error("refresh failed"); });
  await h.click("Refresh Dashboard");
  assert.equal(refreshes, 1); assert.match(h.renderer.html(), /Dashboard refresh failed/);
  assert.match(h.renderer.html(), /Completion confirmed from an earlier request/);
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

test("resolution validates all twelve fields and every migration-ten outcome", () => {
  for (const outcome of ["recorded", "unrecorded_current", "unrecorded_superseded", "conflict"]) {
    const good = resolution(outcome);
    assert.equal(validateCompletionResolution(good, C, O, 3), true, outcome);
    for (const key of Object.keys(good)) {
      const missing = { ...good }; delete missing[key];
      assert.equal(validateCompletionResolution(missing, C, O, 3), false, outcome + ":" + key);
      assert.equal(validateCompletionResolution({ ...good, [key]: undefined }, C, O, 3), false, outcome + ":undefined:" + key);
    }
    for (const patch of [{ extra: true }, { version: 2 }, { command_id: D }, { occurrence_id: P }, { expected_execution_cycle: 4 },
      { current_execution_cycle: 0 }, { current_execution_cycle: 2147483648 }, { current_execution_cycle: 3.5 },
      { current_status: "reopened" }, { current_status: null }, { outcome: "superseded" }]) {
      assert.equal(validateCompletionResolution({ ...good, ...patch }, C, O, 3), false, JSON.stringify(patch));
    }
  }
});

test("resolution enforces caller versus canonical receipts, nullable fields and undo invariants", () => {
  const recorded = resolution("recorded");
  for (const patch of [{ receipt: { ...recorded.receipt, replay: false } }, { receipt: receipt(D, O, 37, true) },
    { receipt: { ...recorded.receipt, execution_cycle: 4 } }, { canonical_receipt: receipt(D, O, 37, true) },
    { correction_event_id: D }, { current_execution_cycle: 2 }, { current_execution_cycle: 3 }]) {
    assert.equal(validateCompletionResolution({ ...recorded, ...patch }, C, O, 3), false);
  }
  assert.equal(validateCompletionResolution({ ...recorded, current_execution_cycle: 3, current_status: "completed" }, C, O, 3), true);
  const older = resolution("unrecorded_superseded");
  for (const patch of [{ receipt: recorded.receipt }, { canonical_receipt: recorded.receipt }, { canonical_receipt: null },
    { canonical_receipt: { ...older.canonical_receipt, replay: false } }, { current_execution_cycle: 3 },
    { correction_event_id: null }, { reopened_event_id: null }, { reversal_entry_id: null },
    { correction_event_id: "invalid" }, { correction_event_id: older.reopened_event_id },
    { reversal_entry_id: older.canonical_receipt.exp_entry_id }]) {
    assert.equal(validateCompletionResolution({ ...older, ...patch }, C, O, 3), false);
  }
  for (const reported of [null, "2026-08-01T00:00:00+07:00"]) {
    assert.equal(validateCompletionResolution({ ...older, canonical_receipt: { ...older.canonical_receipt, reported_completed_at: reported, exp_amount: "9223372036854775807" } }, C, O, 3), true);
  }
  for (const amount of [-1, "9223372036854775808", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateCompletionResolution({ ...older, canonical_receipt: { ...older.canonical_receipt, exp_amount: amount } }, C, O, 3), false);
  }
  const current = resolution();
  assert.equal(validateCompletionResolution({ ...current, current_status: "completed" }, C, O, 3), false);
  assert.equal(validateCompletionResolution({ ...current, canonical_receipt: older.canonical_receipt }, C, O, 3), false);
  assert.equal(validateCompletionResolution({ ...current, current_status: "completed", canonical_receipt: older.canonical_receipt }, C, O, 3), true);
  for (const status of ["draft", "scheduled", "active", "failed", "cancelled"]) {
    assert.equal(validateCompletionResolution({ ...current, current_status: status }, C, O, 3), true);
  }
  // SQL checks bindings before the ahead-of-current error.
  assert.equal(validateCompletionResolution({ ...resolution("conflict"), current_execution_cycle: 2 }, C, O, 3), true);
  assert.equal(validateCompletionResolution({ ...current, current_execution_cycle: 2 }, C, O, 3), false);
});

const completionForm = (patch = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ expected_account: A, command_id: C, occurrence_id: O, execution_cycle: "3", ...patch })) form.set(key, value);
  return form;
};

test("resolution action uses exactly the owner-authenticated three-argument RPC without mutation or cache invalidation", async () => {
  configure(() => ({ data: resolution("recorded"), error: null }), A);
  const result = await resolveQuestCompletion({}, completionForm());
  assert.equal(result.outcome, "resolved");
  assert.deepEqual(calls, [{ name: "get_quest_completion_resolution_v1", args: { command_id: C, occurrence_id: O, expected_execution_cycle: 3 } }]);
  assert.equal(invalidations.length, 0);
  for (const patch of [{ command_id: "bad" }, { occurrence_id: "bad" }, { execution_cycle: "0" }, { execution_cycle: "2147483648" }, { execution_cycle: "3.0" }]) {
    assert.equal((await resolveQuestCompletion({}, completionForm(patch))).reason, "validation");
  }
  assert.equal((await resolveQuestCompletion({}, completionForm({ expected_account: B }))).reason, "account");
  assert.equal(calls.length, 1);
});

test("durable alias lost response resolves after Reopen and later recompletion without another mutation", async () => {
  let mutationCount = 0;
  configure((name, args) => {
    if (name === "complete_quest_occurrence") { mutationCount++; throw Error("alias committed; response lost"); }
    assert.equal(name, "get_quest_completion_resolution_v1");
    assert.deepEqual(args, { command_id: C, occurrence_id: O, expected_execution_cycle: 3 });
    return { data: { ...resolution("recorded"), current_execution_cycle: 7, current_status: "completed" }, error: null };
  }, A);
  const first = setup({ send: completeQuest, resolve: resolveQuestCompletion });
  await first.coordinator.submitForOccurrence(O, 3);
  const restored = setup({ store: first.store, send: completeQuest, resolve: resolveQuestCompletion });
  await restored.coordinator.recover(); await restored.coordinator.retry(C);
  assert.equal(mutationCount, 1); assert.equal(restored.sent.length, 0); assert.equal(restored.ids(), 0);
  assert.equal(restored.coordinator.getSnapshot().confirmations[0].replay, true);
  assert.equal(restored.coordinator.getSnapshot().refreshRequired, true); assert.equal(first.store.length, 0);
});

test("legacy superseded reconciliation retains full terminal evidence after acknowledgement and reload", async () => {
  configure(() => ({ data: resolution("unrecorded_superseded"), error: null }), A);
  const h = setup({ resolve: resolveQuestCompletion }); seed(h.store); await h.coordinator.recover(); await h.coordinator.retry(C);
  assert.equal(h.sent.length, 0); assert.equal(h.coordinator.getSnapshot().confirmations.length, 0);
  const before = JSON.parse(h.store.getItem(completionStorageKey(A, C)));
  assert.deepEqual(before.operation, pending()); assert.deepEqual(before.resolution, resolution("unrecorded_superseded"));
  await h.coordinator.acknowledgeSuperseded(C);
  assert.deepEqual(JSON.parse(h.store.getItem(completionStorageKey(A, C))), { ...before, acknowledged: true });
  assert.throws(() => removePendingCompletion(() => h.store, pending()));
  const restored = setup({ store: h.store }); await restored.coordinator.recover();
  assert.equal(restored.coordinator.getSnapshot().dispositions[0].acknowledged, true);
  await restored.coordinator.retry(C); await restored.coordinator.submitForOccurrence(O, 3);
  assert.equal(restored.sent.length, 0); assert.equal(restored.checked.length, 0); assert.equal(restored.ids(), 0);
  const b = setup({ store: h.store, account: B }); await b.coordinator.recover();
  assert.equal(b.coordinator.getSnapshot().dispositions.length, 0); assert.equal(h.store.length, 1);
});

test("legacy Recovery UI distinguishes uncertainty from success and keeps acknowledged evidence visible", async (t) => {
  const store = new Store(); seed(store);
  configure(() => ({ data: resolution("unrecorded_superseded"), error: null }), A);
  const h = browser(t, store); await h.mount(); await h.click("Check completion resolution", C);
  assert.match(h.renderer.html(), /earlier success cannot be confirmed/);
  assert.doesNotMatch(h.renderer.html(), /EXP awarded|Quest completed|Completion is confirmed/);
  assert.equal(h.button("Check completion resolution", C).length, 0);
  await h.click("Acknowledge reconciliation", C);
  assert.match(h.renderer.html(), /Historical uncertainty and evidence remain saved/);
  assert.match(h.renderer.html(), /Canonical command/); assert.equal(store.length, 1); assert.equal(calls.length, 1);
  assert.equal(h.button("Acknowledge reconciliation", C).length, 0);
  setRefresh(() => { throw Error("refresh unavailable"); }); await h.click("Refresh Dashboard");
  assert.match(h.renderer.html(), /Dashboard refresh failed/); assert.doesNotMatch(h.renderer.html(), /Completion is confirmed/);
});

for (const failure of ["transport", "server", "missing-rpc", "history", "unknown-subject", "ahead", "malformed"]) test("resolver " + failure + " failure never redispatches and offers another resolution check", async () => {
  configure(() => {
    if (failure === "transport") throw Error("offline");
    if (failure === "malformed") return { data: { ...resolution(), receipt: receipt() }, error: null };
    const errors = {
      server: { code: "XX000", message: "generic server failure" },
      "missing-rpc": { code: "PGRST202", message: "not deployed" },
      history: { code: "23514", message: "Completion history is inconsistent" },
      "unknown-subject": { code: "23514", message: "Unknown quest occurrence" },
      ahead: { code: "23514", message: "Expected execution cycle is ahead of current occurrence" },
    };
    return { data: null, error: errors[failure] };
  }, A);
  const h = setup({ resolve: resolveQuestCompletion }); seed(h.store); await h.coordinator.recover();
  await h.coordinator.retry(C); await h.coordinator.retry(C);
  assert.equal(calls.length, 2); assert.ok(calls.every((call) => call.name === "get_quest_completion_resolution_v1"));
  assert.equal(h.sent.length, 0); assert.equal(h.coordinator.getSnapshot().phase, "uncertain");
  assert.deepEqual(JSON.parse(h.store.getItem(completionStorageKey(A, C))), pending());
});

test("only a validated current outcome allows identical redispatch; ambiguity requires a new resolution check", async () => {
  configure((name) => name === "get_quest_completion_resolution_v1" ? { data: resolution(), error: null } : { data: null, error: { code: "network" } }, A);
  const h = setup({ resolve: resolveQuestCompletion, send: completeQuest }); seed(h.store); await h.coordinator.recover();
  await h.coordinator.retry(C); await h.coordinator.retry(C);
  assert.deepEqual(calls.map((call) => call.name), ["get_quest_completion_resolution_v1", "complete_quest_occurrence", "get_quest_completion_resolution_v1", "complete_quest_occurrence"]);
  assert.deepEqual(calls[1].args, calls[3].args);
  assert.deepEqual(calls[1].args, { command_id: C, occurrence_id: O, expected_execution_cycle: 3, reported_completed_at: null, origin: "web_ui" });
  assert.equal(h.ids(), 0); assert.equal(h.store.length, 1);
});

test("initial exact stale rejection and ambiguous SQL failures all retain immutable operations", async () => {
  for (const error of [{ code: "23514", message: "Stale quest completion cycle" }, { code: "23514", message: "Completion history is inconsistent" }, { code: "23514", message: "generic" }, { code: "23505", message: "generic" }]) {
    configure(() => ({ data: null, error }), A);
    const h = setup({ send: completeQuest }); await h.coordinator.submitForOccurrence(O, 3);
    assert.deepEqual(JSON.parse(h.store.getItem(completionStorageKey(A, C))), pending());
    assert.equal(h.coordinator.getSnapshot().phase, "uncertain");
    const result = await completeQuest({}, completionForm());
    assert.equal(result.outcome, error.message === "Stale quest completion cycle" ? "rejected" : "unknown");
  }
});

for (const source of ["resolver", "mutation"]) test(source + " conflict survives reload and blocks identical or replacement mutations", async () => {
  configure(() => source === "resolver" ? { data: resolution("conflict"), error: null } : { data: null, error: { code: "23505", message: "Conflicting quest command reuse" } }, A);
  const h = setup({ send: completeQuest, resolve: resolveQuestCompletion });
  if (source === "resolver") { seed(h.store); await h.coordinator.recover(); await h.coordinator.retry(C); }
  else await h.coordinator.submitForOccurrence(O, 3);
  assert.equal(h.coordinator.getSnapshot().dispositions[0].reason, "conflict");
  const restored = setup({ store: h.store }); await restored.coordinator.recover();
  await restored.coordinator.retry(C); await restored.coordinator.submitForOccurrence(O, 3);
  assert.equal(restored.sent.length, 0); assert.equal(restored.checked.length, 0); assert.equal(restored.ids(), 0);
  assert.equal(calls.length, 1); assert.equal(h.store.length, 1);
});

test("recorded resolver cleanup failure survives reload; cleanup never redispatches", async () => {
  configure(() => ({ data: resolution("recorded"), error: null }), A);
  const h = setup({ resolve: resolveQuestCompletion }); seed(h.store); await h.coordinator.recover(); h.store.fail = "remove";
  await h.coordinator.retry(C); assert.equal(h.coordinator.getSnapshot().confirmations[0].cleanupPending, true);
  const restored = setup({ store: h.store, resolve: resolveQuestCompletion }); await restored.coordinator.recover(); await restored.coordinator.retry(C);
  h.store.fail = undefined; await restored.coordinator.retryConfirmation(C);
  assert.equal(calls.length, 2); assert.equal(h.sent.length + restored.sent.length, 0); assert.equal(h.store.length, 0);
});

test("terminal persistence and acknowledgement failures keep evidence and recover without RPC", async () => {
  const h = setup({ resolve: async () => ({ outcome: "resolved", resolution: resolution("unrecorded_superseded") }) });
  seed(h.store); await h.coordinator.recover(); h.store.fail = "write"; await h.coordinator.retry(C);
  assert.equal(h.coordinator.getSnapshot().phase, "blocked");
  assert.equal(h.coordinator.getSnapshot().dispositions[0].reason, "superseded");
  await h.coordinator.retry(C); assert.equal(h.checked.length, 1);
  h.store.fail = undefined; await h.coordinator.recover();
  h.store.fail = "write"; await h.coordinator.acknowledgeSuperseded(C);
  assert.equal(h.coordinator.getSnapshot().dispositions[0].acknowledged, false);
  assert.equal(JSON.parse(h.store.getItem(completionStorageKey(A, C))).acknowledged, false);
  h.store.fail = undefined; await h.coordinator.recover(); await h.coordinator.acknowledgeSuperseded(C);
  h.store.values.clear(); await h.coordinator.recover();
  assert.equal(JSON.parse(h.store.getItem(completionStorageKey(A, C))).acknowledged, true);
  assert.equal(h.checked.length, 1); assert.equal(h.sent.length, 0);
});

test("stale tab queued retry consumes another tab's terminal disposition under the shared lock", async () => {
  const gate = deferred(); let queued = false; const store = new Store(); seed(store);
  const first = setup({ store, resolve: async () => ({ outcome: "resolved", resolution: resolution("unrecorded_superseded") }) });
  const second = setup({ store, lock: async (_user, work) => { if (queued) await gate.promise; return work(); } });
  await first.coordinator.recover(); await second.coordinator.recover(); queued = true;
  const retry = second.coordinator.retry(C);
  await first.coordinator.retry(C); await first.coordinator.acknowledgeSuperseded(C); gate.resolve(); await retry;
  assert.equal(second.checked.length, 0); assert.equal(second.sent.length, 0);
  assert.equal(second.coordinator.getSnapshot().dispositions[0].acknowledged, true);
  await second.coordinator.recover(); assert.equal(store.length, 1);
});

test("two concurrent tab resolution checks serialize and never downgrade acknowledgement", async () => {
  let tail = Promise.resolve(); let held = false;
  const lock = (_user, work) => { const result = tail.then(async () => { assert.equal(held, false); held = true; try { return await work(); } finally { held = false; } }); tail = result.catch(() => {}); return result; };
  const store = new Store(); seed(store);
  const resolve = async () => ({ outcome: "resolved", resolution: resolution("unrecorded_superseded") });
  const a = setup({ store, lock, resolve }); const b = setup({ store, lock, resolve });
  await Promise.all([a.coordinator.recover(), b.coordinator.recover()]);
  await Promise.all([a.coordinator.retry(C), b.coordinator.retry(C)]);
  assert.equal(a.checked.length + b.checked.length, 1); assert.equal(a.sent.length + b.sent.length, 0);
  await a.coordinator.acknowledgeSuperseded(C); await b.coordinator.recover();
  assert.equal(b.coordinator.getSnapshot().dispositions[0].acknowledged, true);
});

test("account change during resolution retains A's request and cannot dispatch current outcome", async () => {
  const gate = deferred(); const h = setup({ resolve: () => gate.promise }); seed(h.store); await h.coordinator.recover();
  const task = h.coordinator.retry(C); await tick(); h.coordinator.changeAccount(B);
  gate.resolve({ outcome: "resolved", resolution: resolution() }); await task;
  assert.equal(h.sent.length, 0); assert.equal(h.coordinator.getSnapshot().accountChanged, true);
  assert.deepEqual(JSON.parse(h.store.getItem(completionStorageKey(A, C))), pending());
  const b = setup({ store: h.store, account: B }); await b.coordinator.recover(); assert.equal(b.coordinator.getSnapshot().operations.length, 0);
});

test("resolver action account mismatch and expired session preserve requests without RPC", async () => {
  for (const account of [B, undefined]) {
    configure(() => assert.fail("No RPC permitted"), account);
    const h = setup({ resolve: resolveQuestCompletion }); seed(h.store); await h.coordinator.recover(); await h.coordinator.retry(C);
    assert.equal(h.sent.length, 0); assert.equal(calls.length, 0); assert.equal(h.store.length, 1);
    assert.equal(h.coordinator.getSnapshot().phase, account === B ? "blocked" : "uncertain");
  }
});

test("V1 compatibility and strict V2 envelopes reject damaged evidence without overwrite", async () => {
  const store = new Store(); seed(store);
  assert.deepEqual(readPendingCompletions(() => store, A).operations, [pending()]);
  const disposition = { operation: pending(), reason: "superseded", resolution: resolution("unrecorded_superseded"), acknowledged: false };
  persistCompletionDisposition(() => store, disposition);
  const serialized = store.getItem(completionStorageKey(A, C));
  const h = setup({ store }); await h.coordinator.recover();
  for (const patch of [{ acknowledged: "yes" }, { reason: "other" }, { resolution: null }, { extra: true }, { operation: { ...pending(), executionCycle: 4 } }]) {
    const bad = JSON.stringify({ ...JSON.parse(serialized), ...patch }); store.setItem(completionStorageKey(A, C), bad);
    assert.equal(readPendingCompletions(() => store, A).status, "corrupt");
    await h.coordinator.recover(); assert.equal(h.coordinator.getSnapshot().phase, "blocked");
    assert.equal(store.getItem(completionStorageKey(A, C)), bad);
    assert.deepEqual(h.coordinator.getSnapshot().dispositions[0], disposition);
  }
});

test("current completed canonical receipt is not caller success until the exact mutation registers its alias", async () => {
  configure((name) => name === "get_quest_completion_resolution_v1" ? {
    data: { ...resolution(), current_status: "completed", canonical_receipt: receipt(D, O, 37, true) }, error: null,
  } : { data: receipt(C, O, 37, true), error: null }, A);
  const h = setup({ resolve: resolveQuestCompletion, send: completeQuest }); seed(h.store); await h.coordinator.recover(); await h.coordinator.retry(C);
  assert.deepEqual(calls.map((call) => call.name), ["get_quest_completion_resolution_v1", "complete_quest_occurrence"]);
  assert.equal(h.sent[0].command_id, C); assert.equal(h.coordinator.getSnapshot().confirmations[0].operation.commandId, C);
  assert.equal(h.store.length, 0);
});

test("Reopen racing a current observation yields stale and requires resolution without changing cycle", async () => {
  let current = true;
  configure((name) => {
    if (name === "get_quest_completion_resolution_v1") return { data: resolution(current ? "unrecorded_current" : "unrecorded_superseded"), error: null };
    current = false; return { data: null, error: { code: "23514", message: "Stale quest completion cycle" } };
  }, A);
  const h = setup({ resolve: resolveQuestCompletion, send: completeQuest }); seed(h.store); await h.coordinator.recover(); await h.coordinator.retry(C);
  assert.deepEqual(JSON.parse(h.store.getItem(completionStorageKey(A, C))), pending());
  await h.coordinator.retry(C);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].execution_cycle, "3");
  assert.equal(h.coordinator.getSnapshot().dispositions[0].reason, "superseded"); assert.equal(h.ids(), 0);
});

test("resolution failure UI retains an enabled check and never exposes a mutation retry", async (t) => {
  const store = new Store(); seed(store);
  configure(() => ({ data: null, error: { code: "XX000", message: "synthetic diagnostic" } }), A);
  const h = browser(t, store); await h.mount(); await h.click("Check completion resolution", C);
  assert.equal(h.button("Check completion resolution", C)[0].props.disabled, false);
  assert.match(h.renderer.html(), /Check resolution again/); assert.doesNotMatch(h.renderer.html(), /synthetic diagnostic|Retry exact completion/);
  await h.click("Check completion resolution", C);
  assert.equal(calls.length, 2); assert.ok(calls.every((call) => call.name === "get_quest_completion_resolution_v1"));
});

for (const observation of [{ current_execution_cycle: 4, current_status: "completed" }, { current_execution_cycle: 5, current_status: "scheduled" }]) test("failed terminal write reconciles another tab's acknowledged observation " + JSON.stringify(observation), async () => {
  let tail = Promise.resolve();
  const lock = (_user, work) => { const task = tail.then(work); tail = task.catch(() => {}); return task; };
  const store = new Store(); seed(store);
  let current = resolution("unrecorded_superseded");
  const resolve = async () => ({ outcome: "resolved", resolution: structuredClone(current) });
  const a = setup({ store, lock, resolve }); const b = setup({ store, lock, resolve }); const stale = setup({ store, lock, resolve });
  await Promise.all([a.coordinator.recover(), b.coordinator.recover(), stale.coordinator.recover()]);
  store.fail = "write"; await a.coordinator.retry(C);
  const oldEvidence = structuredClone(a.coordinator.getSnapshot().dispositions[0]);
  assert.equal(a.coordinator.getSnapshot().phase, "blocked");
  assert.deepEqual(JSON.parse(store.getItem(completionStorageKey(A, C))), pending());
  // The current cycle changes after A releases the shared lock; old history does not.
  current = { ...current, ...observation }; store.fail = undefined;
  await b.coordinator.retry(C); await b.coordinator.acknowledgeSuperseded(C);
  const durable = store.getItem(completionStorageKey(A, C));
  await a.coordinator.recover();
  assert.equal(a.coordinator.getSnapshot().phase, "ready");
  assert.deepEqual(a.coordinator.getSnapshot().dispositions, b.coordinator.getSnapshot().dispositions);
  await lock(A, async () => persistCompletionDisposition(() => store, oldEvidence));
  assert.equal(store.getItem(completionStorageKey(A, C)), durable);
  await stale.coordinator.retry(C); await a.coordinator.retry(C); await a.coordinator.submitForOccurrence(O, 3);
  assert.equal(a.sent.length + b.sent.length + stale.sent.length, 0);
  assert.equal(a.checked.length + b.checked.length + stale.checked.length, 2);
  assert.equal(a.ids() + b.ids() + stale.ids(), 0);
  // Cleanup cannot erase terminal evidence; a stale V1 restoration cannot revive it.
  store.fail = "remove";
  assert.throws(() => removePendingCompletion(() => store, pending())); store.fail = undefined;
  store.setItem(completionStorageKey(A, C), JSON.stringify(pending())); await a.coordinator.recover();
  assert.equal(store.getItem(completionStorageKey(A, C)), durable);
  const reloaded = setup({ store, lock }); await reloaded.coordinator.recover();
  assert.equal(reloaded.coordinator.getSnapshot().dispositions[0].acknowledged, true);
  assert.deepEqual(reloaded.coordinator.getSnapshot().dispositions[0].resolution, current);
});

test("failed conflict persistence accepts validated resolver evidence and never downgrades it to null", async () => {
  const store = new Store();
  const a = setup({ store, send: async () => { store.fail = "write"; return { outcome: "rejected", reason: "conflict", error: "conflict" }; } });
  await a.coordinator.submitForOccurrence(O, 3);
  const bare = structuredClone(a.coordinator.getSnapshot().dispositions[0]);
  assert.equal(bare.resolution, null); store.fail = undefined;
  const b = setup({ store, resolve: async () => ({ outcome: "resolved", resolution: resolution("conflict") }) });
  await b.coordinator.recover(); await b.coordinator.retry(C); await a.coordinator.recover();
  assert.equal(a.coordinator.getSnapshot().phase, "ready");
  assert.deepEqual(a.coordinator.getSnapshot().dispositions, b.coordinator.getSnapshot().dispositions);
  const durable = store.getItem(completionStorageKey(A, C));
  persistCompletionDisposition(() => store, bare);
  assert.equal(store.getItem(completionStorageKey(A, C)), durable);
  await a.coordinator.retry(C); await a.coordinator.submitForOccurrence(O, 3);
  assert.equal(a.sent.length, 1); assert.equal(b.sent.length, 0);
  // A richer in-memory conflict also upgrades a compatible bare durable envelope.
  store.setItem(completionStorageKey(A, C), JSON.stringify({ version: 2, ...bare }));
  await b.coordinator.recover(); assert.equal(store.getItem(completionStorageKey(A, C)), durable);
});

test("higher-cycle terminal memory survives a stale stored observation and merges acknowledgement", async () => {
  const store = new Store(); seed(store);
  const older = { operation: pending(), reason: "superseded", resolution: resolution("unrecorded_superseded"), acknowledged: true };
  const newer = { ...older, resolution: { ...older.resolution, current_execution_cycle: 6 }, acknowledged: false };
  persistCompletionDisposition(() => store, newer);
  const h = setup({ store }); await h.coordinator.recover();
  store.setItem(completionStorageKey(A, C), JSON.stringify({ version: 2, ...older }));
  await h.coordinator.recover();
  assert.equal(h.coordinator.getSnapshot().phase, "ready");
  assert.deepEqual(h.coordinator.getSnapshot().dispositions[0], { ...newer, acknowledged: true });
  assert.deepEqual(readPendingCompletions(() => store, A).dispositions, h.coordinator.getSnapshot().dispositions);
  assert.equal(h.sent.length + h.checked.length, 0);
});

test("terminal merge rejects changed immutable requests and every changed historical receipt fact", async () => {
  const original = { operation: pending(), reason: "superseded", resolution: resolution("unrecorded_superseded"), acknowledged: false };
  const patches = [
    { operation: { ...pending(), commandId: D } }, { operation: { ...pending(), occurrenceId: P } },
    { operation: { ...pending(), executionCycle: 2 } },
    { operation: { ...pending(), occurrenceId: P }, resolution: { ...original.resolution, occurrence_id: P,
      canonical_receipt: { ...original.resolution.canonical_receipt, occurrence_id: P } } },
    { operation: { ...pending(), executionCycle: 2 }, resolution: { ...original.resolution, expected_execution_cycle: 2,
      canonical_receipt: { ...original.resolution.canonical_receipt, execution_cycle: 2 } } },
    ...Object.entries({ command_id: P, occurrence_id: P, quest_id: P, execution_cycle: 2, completed_event_id: P, exp_entry_id: P,
      exp_amount: 38, reported_completed_at: "2026-09-23T00:00:00Z", recorded_completed_at: "2026-09-23T00:00:00Z", replay: false })
      .map(([key, value]) => ({ resolution: { ...original.resolution, canonical_receipt: { ...original.resolution.canonical_receipt, [key]: value } } })),
    ...["command_id", "occurrence_id", "correction_event_id", "reopened_event_id", "reversal_entry_id"].map((key) => ({ resolution: { ...original.resolution, [key]: P } })),
    { reason: "conflict", resolution: resolution("conflict") },
  ];
  for (const patch of patches) {
    const store = new Store(); persistCompletionDisposition(() => store, original);
    const h = setup({ store }); await h.coordinator.recover();
    const changed = JSON.stringify({ version: 2, ...original, ...patch }); store.setItem(completionStorageKey(A, C), changed);
    assert.throws(() => persistCompletionDisposition(() => store, original));
    await h.coordinator.recover(); await h.coordinator.retry(C); await h.coordinator.submitForOccurrence(P, 3);
    assert.equal(h.coordinator.getSnapshot().storage, "corrupt", JSON.stringify(patch));
    assert.deepEqual(h.coordinator.getSnapshot().dispositions, [original]);
    assert.equal(store.getItem(completionStorageKey(A, C)), changed);
    assert.equal(h.sent.length + h.checked.length, 0);
  }
});

test("mixed-case UUID aliases cannot disguise identical canonical or undo identities", () => {
  const caller = "abcdefab-0000-4000-8000-000000000001";
  const event = "abcdefab-0000-4000-8000-000000000002";
  const credit = "abcdefab-0000-4000-8000-000000000003";
  const good = resolution("unrecorded_superseded", caller);
  for (const outcome of ["unrecorded_current", "unrecorded_superseded"]) {
    const malformed = { ...resolution(outcome, caller), current_status: "completed", canonical_receipt: { ...good.canonical_receipt, command_id: caller.toUpperCase() } };
    assert.equal(validateCompletionResolution(malformed, caller, O, 3), false);
  }
  for (const patch of [
    { correction_event_id: event, reopened_event_id: event.toUpperCase() },
    { correction_event_id: event.toUpperCase(), canonical_receipt: { ...good.canonical_receipt, completed_event_id: event } },
    { reopened_event_id: event.toUpperCase(), canonical_receipt: { ...good.canonical_receipt, completed_event_id: event } },
    { reversal_entry_id: credit.toUpperCase(), canonical_receipt: { ...good.canonical_receipt, exp_entry_id: credit } },
  ]) assert.equal(validateCompletionResolution({ ...good, ...patch }, caller, O, 3), false);
});

test("valid mixed-case response identities confirm the unchanged saved request despite cleanup failure", async () => {
  const command = "abcdefab-0000-4000-8000-000000000001";
  const occurrence = "abcdefab-0000-4000-8000-000000000002";
  const saved = pending(command.toUpperCase(), occurrence.toUpperCase());
  const result = resolution("recorded", command, occurrence);
  assert.equal(validateCompletionResolution(result, saved.commandId, saved.occurrenceId, 3), true);
  const store = new Store(); seed(store, saved);
  const h = setup({ store, resolve: async () => ({ outcome: "resolved", resolution: result }) });
  await h.coordinator.recover(); store.fail = "remove"; await h.coordinator.retry(saved.commandId);
  assert.deepEqual(h.coordinator.getSnapshot().confirmations[0].operation, saved);
  assert.equal(h.coordinator.getSnapshot().confirmations[0].cleanupPending, true);
  assert.deepEqual(JSON.parse(store.getItem(completionStorageKey(A, saved.commandId))), saved);
  store.fail = undefined; await h.coordinator.retryConfirmation(saved.commandId);
  assert.equal(store.length, 0); assert.equal(h.sent.length, 0); assert.equal(h.checked.length, 1);
});
