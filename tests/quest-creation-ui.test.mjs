import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const root = new URL("../src/", import.meta.url);
const mocksUrl = `data:text/javascript,${encodeURIComponent(`
  export let account = "10000000-0000-4000-8000-000000000001";
  export let timezone = "UTC";
  export let authError;
  export let response;
  export const calls = [];
  export const invalidations = [];
  export async function requireUser() { if (authError) throw authError; return { id: account }; }
  export async function getProfileContext() { return { user: { id: account }, profile: { timezone } }; }
  export async function createServerSupabaseClient() { return { rpc: async (name, args) => {
    calls.push({ name, args }); return response(name, args);
  } }; }
  export function revalidatePath(...args) { invalidations.push(args); }
  export function configure(nextResponse, nextTimezone = "UTC", nextAccount = "10000000-0000-4000-8000-000000000001", error = null) {
    response = nextResponse; timezone = nextTimezone; account = nextAccount; authError = error; calls.length = 0; invalidations.length = 0;
  }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root.href)) {
      if (["@/features/auth/session", "@/features/profile/session", "@/lib/supabase/server", "next/cache"].includes(specifier)) return { url: mocksUrl, shortCircuit: true };
      if (specifier.startsWith("@/")) return { url: new URL(specifier.slice(2) + ".ts", root).href, shortCircuit: true };
      if (specifier.startsWith("./")) return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { QuestCreationLifecycle } = await import("../src/features/quests/create-lifecycle.ts");
const { pendingStorageKey, persistPending, readPendingCreations } = await import("../src/features/quests/create-pending.ts");
const { validateQuestCreationRequest } = await import("../src/features/quests/create-model.ts");
const { validateQuestCreationReceipt } = await import("../src/features/quests/create-receipt.ts");
const { localTimeToUtc } = await import("../src/features/quests/time.ts");
const { creationSuccessMessage } = await import("../src/features/quests/create-message.ts");
const { createQuest } = await import("../src/features/quests/create-action.ts");
const { configure, calls, invalidations } = await import(mocksUrl);
const { validateRecurringRequest } = await import("../src/features/quests/recurring-model.ts");
const { validateRecurringReceipt } = await import("../src/features/quests/recurring-receipt.ts");
const { parseRecurringQuests } = await import("../src/features/quests/recurring-list.ts");
const { RecurrencePauseLifecycle, PAUSE_PREFIX } = await import("../src/features/quests/recurrence-pending.ts");
const { changeRecurrencePause } = await import("../src/features/quests/recurrence-action.ts");
hooks.deregister();

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const base = { title: "Prepare report", description: null, importance: "side", priority: null, default_reward_exp: 0, scheduled_at: "2026-07-01T12:00:00.000Z", deadline_at: null };
const unknown = { outcome: "unknown", error: "Unknown outcome" };
const success = (replay = false) => ({ outcome: "success", success: { message: "Confirmed", replay } });
let sequence = 0;
const uuid = () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
function receipt(args, replay = false) {
  return { command_id: args.command_id, quest_id: "30000000-0000-4000-8000-000000000001", occurrence_id: "30000000-0000-4000-8000-000000000002", definition_created_event_id: "40000000-0000-4000-8000-000000000001", occurrence_scheduled_event_id: "40000000-0000-4000-8000-000000000002", scheduled_at: args.request.scheduled_at, deadline_at: args.request.deadline_at, reward_exp_snapshot: args.request.default_reward_exp, execution_cycle: 1, replay };
}
class MemoryStorage {
  values = new Map(); failure;
  get length() { if (this.failure === "length") throw Error("blocked"); return this.values.size; }
  key(i) { if (this.failure === "key") throw Error("blocked"); return [...this.values.keys()][i] ?? null; }
  getItem(key) { if (this.failure === "read") throw Error("blocked"); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failure === "write") throw Error("quota"); this.values.set(key, value); }
  removeItem(key) { if (this.failure === "remove") throw Error("blocked"); this.values.delete(key); }
}
function locks() {
  let tail = Promise.resolve();
  return async (_account, work) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  };
}
function setup({ send = async () => unknown, storage = new MemoryStorage(), lock = locks(), access = () => storage } = {}) {
  const sent = [];
  const deps = { storage: access, lock, uuid, send: async (previous, form) => { sent.push(Object.fromEntries(form)); return send(previous, form); } };
  const make = (account = A, timezone = "UTC") => new QuestCreationLifecycle(account, timezone, deps);
  return { storage, deps, sent, make };
}
async function fill(controller) {
  await controller.recover();
  controller.updateDraft("title", base.title);
  controller.updateDraft("scheduled_at", "2026-07-01T12:00");
}
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
const recurring = { title: "Daily reading", description: null, importance: "side", priority: null, default_reward_exp: 37,
  recurrence_mode: "daily", start_date: "2026-09-29", end_date: null };
/** create_recurring_quest_v2 receipt: the frozen v1 fields plus the closed v2 additions. */
function recurringScheduleReceipt(args, replay = false) {
  const r = args.request;
  return { version: 2, ...recurringReceipt(args, replay), revision: 1,
    local_start_time: r.local_start_time, local_end_time: r.local_end_time,
    planned_end_day_offset: r.planned_end_day_offset };
}
function recurringReceipt(args, replay = false) {
  const r = args.request;
  return { command_id: args.command_id, quest_id: A, recurrence_rule_id: B, definition_created_event_id: A,
    recurrence_changed_event_id: B, recurrence_mode: r.recurrence_mode,
    recurrence_type: r.recurrence_mode === "weekly" ? "selected_weekdays" : r.recurrence_mode,
    anchor_date: r.start_date, end_date: r.end_date, weekdays: r.weekdays ?? null, month_day: r.month_day ?? null,
    occurrence_limit: null, default_reward_exp: r.default_reward_exp, replay };
}
function form({ account = A, timezone = "UTC", mode = "new", request = base, id = uuid() } = {}) {
  const data = new FormData();
  // Mirrors the lifecycle: each record declares the exact contract version it was created under.
  const version = "local_start_time" in request ? 4 : "recurrence_mode" in request ? 3 : 2;
  for (const [key, value] of Object.entries({ expected_account: account, timezone, mode, request_json: JSON.stringify(request), command_id: id, pending_version: String(version) })) data.set(key, value);
  return data;
}

test("account switch before retry clears the old draft, gates recovery, and cannot retry A under B", async () => {
  const h = setup(); const c = h.make(); await fill(c); await c.submit(); const id = h.sent[0].command_id;
  c.changeAccount(B, "UTC");
  assert.equal(c.getSnapshot().draft.title, ""); assert.deepEqual(c.getSnapshot().operations, []);
  await c.retry(id); await c.submit(); assert.equal(h.sent.length, 1);
  await c.recover(); await c.retry(id); assert.equal(h.sent.length, 1);
  assert.equal(readPendingCreations(h.deps.storage, A).status, "valid");
});

test("account switch during an in-flight response ignores old success and preserves A recovery", async () => {
  const pending = deferred(); const h = setup({ send: () => pending.promise }); const c = h.make(); await fill(c);
  const task = c.submit(); await tick(); c.changeAccount(B, "Asia/Ho_Chi_Minh"); const recovery = c.recover();
  pending.resolve(success()); await task; await recovery;
  assert.equal(c.getSnapshot().draft.title, "");
  c.updateDraft("title", "B private draft");
  assert.equal(c.getSnapshot().draft.title, "B private draft"); assert.equal(c.getSnapshot().message, undefined);
  assert.equal(readPendingCreations(h.deps.storage, A).status, "valid"); assert.equal(readPendingCreations(h.deps.storage, B).status, "missing");
});

test("actual server action rejects stale expected-account token before RPC on new and retry", async () => {
  configure(() => assert.fail("RPC must not run"), "UTC", B);
  for (const mode of ["new", "retry"]) {
    const result = await createQuest({}, form({ mode })); assert.equal(result.reason, "account"); assert.equal(result.outcome, "rejected");
  }
  assert.equal(calls.length, 0);
});

for (const failure of ["read", "length", "key", "write", "getter"]) test(`storage ${failure} failure fails closed before dispatch and recovery can resume`, async () => {
  const h = setup(); const c = h.make(); await fill(c);
  if (failure === "key") h.storage.values.set("unrelated", "value");
  if (failure === "getter") h.deps.storage = () => { throw Error("SecurityError"); }; else h.storage.failure = failure;
  await c.submit(); assert.equal(h.sent.length, 0); assert.equal(c.getSnapshot().phase, "blocked");
  assert.equal(c.getSnapshot().draft.title, base.title);
  h.storage.failure = undefined; h.deps.storage = () => h.storage;
  await c.recover(); await c.submit(); assert.equal(h.sent.length, 1);
});

test("write read-back failure never dispatches and preserves the prepared command for recovery", async () => {
  const h = setup(); const c = h.make(); await fill(c);
  const original = h.storage.setItem.bind(h.storage);
  h.storage.setItem = (key, value) => { original(key, value); h.storage.failure = "read"; };
  await c.submit(); assert.equal(h.sent.length, 0); assert.equal(c.getSnapshot().phase, "blocked");
  h.storage.failure = undefined; h.storage.setItem = original;
  const restored = h.make(); await restored.recover(); const id = restored.getSnapshot().operations[0].commandId;
  await restored.retry(id); assert.equal(h.sent[0].command_id, id); assert.equal(h.sent[0].mode, "retry");
});

test("storage remove failure keeps the exact command until replay can clean up", async () => {
  const h = setup({ send: async () => success() }); const c = h.make(); await fill(c);
  h.storage.failure = "remove"; await c.submit(); const id = h.sent[0].command_id;
  assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(h.storage.values.size, 1);
  h.storage.failure = undefined; await c.recover(); await c.retry(id);
  assert.equal(h.sent[1].command_id, id); assert.equal(h.storage.values.size, 0); assert.equal(c.getSnapshot().phase, "ready");
});

test("corrupt schemas, wrong account, bad timezone, nonnormalized payload and malformed JSON block recovery without deletion", async () => {
  const valid = { version: 2, userId: A, commandId: uuid(), timezone: "UTC", request: base };
  const cases = ["{broken", JSON.stringify({ ...valid, version: 99 }), JSON.stringify({ ...valid, userId: B }), JSON.stringify({ ...valid, commandId: "bad" }), JSON.stringify({ ...valid, timezone: "Not/A_Zone" }), JSON.stringify({ ...valid, request: { ...base, title: " padded " } }), JSON.stringify({ ...valid, extra: true })];
  for (const raw of cases) {
    const h = setup(); h.storage.values.set(pendingStorageKey(A, valid.commandId), raw); const c = h.make(); await c.recover(); await c.submit();
    assert.equal(c.getSnapshot().storage, "corrupt"); assert.equal(h.sent.length, 0); assert.equal(h.storage.values.get(pendingStorageKey(A, valid.commandId)), raw);
  }
});

test("legacy unresolved records block new commands and remain untouched", async () => {
  const h = setup(); h.storage.values.set("system.quest-creation.pending.v1:" + A, "{old}"); const c = h.make(); await c.recover(); await c.submit();
  assert.equal(c.getSnapshot().storage, "corrupt"); assert.equal(h.sent.length, 0); assert.equal(h.storage.values.size, 1);
});

test("same-account remount and reload retry the immutable saved request without generating an ID", async () => {
  const h = setup(); const c = h.make(); await fill(c); await c.submit();
  const first = h.sent[0]; const count = sequence; c.deactivate();
  const restored = h.make(A, "Asia/Ho_Chi_Minh"); await restored.recover();
  assert.equal(restored.getSnapshot().draftTimezone, "UTC"); assert.equal(restored.getSnapshot().profileTimezone, "Asia/Ho_Chi_Minh");
  restored.updateDraft("title", "must not edit pending"); await restored.retry(first.command_id);
  assert.equal(sequence, count); assert.equal(h.sent[1].command_id, first.command_id); assert.equal(h.sent[1].request_json, first.request_json); assert.equal(h.sent[1].expected_account, A);
});

test("two tabs overlapping new submissions serialize and cannot replace an uncertain request", async () => {
  const pending = deferred(); const h = setup({ send: () => pending.promise }); const a = h.make(), b = h.make(); await fill(a); await fill(b);
  const first = a.submit(); await tick(); const second = b.submit(); await tick(); assert.equal(h.sent.length, 1);
  pending.resolve(unknown); await Promise.all([first, second]);
  assert.equal(h.sent.length, 1); assert.equal(h.storage.values.size, 1); assert.equal(b.getSnapshot().operations[0].commandId, h.sent[0].command_id);
});

test("clearing a confirmed command preserves every other account and command", async () => {
  const h = setup({ send: async () => success(true) });
  const operations = [A, A, B].map((userId) => ({ version: 2, userId, commandId: uuid(), timezone: "UTC", request: base }));
  for (const op of operations) persistPending(h.deps.storage, op);
  const c = h.make(); await c.recover(); await c.retry(operations[0].commandId);
  assert.equal(h.storage.values.has(pendingStorageKey(A, operations[0].commandId)), false);
  assert.equal(h.storage.values.has(pendingStorageKey(A, operations[1].commandId)), true);
  assert.equal(h.storage.values.has(pendingStorageKey(B, operations[2].commandId)), true);
  assert.equal(c.getSnapshot().phase, "uncertain");
});

test("a stale tab confirms another tab's success by same-ID replay, never a replacement", async () => {
  let result = unknown; const h = setup({ send: async () => result }); const a = h.make(); await fill(a); await a.submit();
  const b = h.make(); await b.recover(); const id = h.sent[0].command_id; result = success(true);
  await a.retry(id); assert.equal(h.storage.values.size, 0); await b.retry(id);
  assert.equal(h.sent[2].command_id, id); assert.equal(h.storage.values.size, 0);
});

test("confirmed pre-RPC timezone rejection unlocks and preserves the draft for explicit review", async () => {
  configure(() => assert.fail("RPC must not run"), "Asia/Ho_Chi_Minh");
  const h = setup({ send: createQuest }); const c = h.make(); await fill(c); await c.submit();
  assert.equal(calls.length, 0); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(h.storage.values.size, 0);
  assert.equal(c.getSnapshot().draft.scheduled_at, "2026-07-01T12:00"); assert.equal(c.getSnapshot().draftTimezone, "UTC");
  c.reviewTimezone(); assert.equal(c.getSnapshot().draftTimezone, "Asia/Ho_Chi_Minh");
  configure((_name, args) => ({ data: receipt(args), error: null }), "Asia/Ho_Chi_Minh"); await c.submit();
  assert.equal(calls[0].args.request.scheduled_at, "2026-07-01T05:00:00.000Z"); assert.equal(c.getSnapshot().phase, "ready");
});

test("uncertain retry after Profile timezone change preserves UTC payload and succeeds through actual action/adapter", async () => {
  configure(() => { throw Error("lost RPC response"); }); const h = setup({ send: createQuest }); const c = h.make(); await fill(c); await c.submit();
  const original = h.sent[0];
  configure((_name, args) => ({ data: receipt(args, true), error: null }), "America/New_York");
  const restored = h.make(A, "America/New_York"); await restored.recover(); await restored.retry(original.command_id);
  assert.equal(h.sent[1].request_json, original.request_json); assert.equal(calls[0].args.command_id, original.command_id);
  assert.equal(calls[0].args.request.scheduled_at, base.scheduled_at); assert.equal(restored.getSnapshot().phase, "ready"); assert.deepEqual(invalidations, [["/dashboard"]]);
});

test("commit followed by lost response creates one simulated effect, reload retry returns replay", async () => {
  const effects = new Map(); let lost = true;
  configure((_name, args) => {
    const replay = effects.has(args.command_id); if (!replay) effects.set(args.command_id, structuredClone(args.request));
    if (lost) { lost = false; throw Error("response lost after commit"); }
    assert.deepEqual(effects.get(args.command_id), args.request); return { data: receipt(args, replay), error: null };
  });
  const h = setup({ send: createQuest }); const c = h.make(); await fill(c); await c.submit(); const id = h.sent[0].command_id;
  const restored = h.make(); await restored.recover(); await restored.retry(id);
  assert.equal(effects.size, 1); assert.equal(h.storage.values.size, 0); assert.match(restored.getSnapshot().message, /earlier accepted/);
});

test("browser-to-action promise rejection shows unknown outcome and preserves exact operation", async () => {
  const h = setup({ send: async () => { throw Error("browser transport failure"); } }); const c = h.make(); await fill(c); await c.submit();
  assert.equal(c.getSnapshot().phase, "uncertain"); assert.match(c.getSnapshot().error, /outcome is unknown/);
  await c.retry(h.sent[0].command_id); assert.equal(h.sent[1].request_json, h.sent[0].request_json); assert.equal(h.sent[1].command_id, h.sent[0].command_id);
});

test("a pre-RPC rejection during retry never discards the earlier uncertain operation", async () => {
  let result = unknown; const h = setup({ send: async () => result }); const c = h.make(); await fill(c); await c.submit();
  const id = h.sent[0].command_id; result = { outcome: "rejected", reason: "validation", error: "Rejected" }; await c.retry(id);
  assert.equal(c.getSnapshot().phase, "uncertain"); assert.equal(h.storage.values.size, 1);
});

for (const replay of [false, true]) test(`normal lifecycle confirmation replay=${replay} clears only after verified success`, async () => {
  configure((_name, args) => ({ data: receipt(args, replay), error: null }));
  const h = setup({ send: createQuest }); const c = h.make(); await fill(c); await c.submit();
  assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().draft.title, ""); assert.equal(h.storage.values.size, 0);
  assert.deepEqual(calls[0], { name: "create_one_off_quest", args: { command_id: h.sent[0].command_id, request: base, origin: "web_ui" } });
  assert.deepEqual(invalidations, [["/dashboard"]]);
});

test("exact enum types and SQL code-point lengths agree in draft, request and server validation", async () => {
  for (const patch of [{ importance: ["side"] }, { priority: ["high"] }, { description: "x".repeat(4001) }, { title: "x".repeat(121) }]) assert.equal(validateQuestCreationRequest({ ...base, ...patch }), false);
  assert.equal(validateQuestCreationRequest({ ...base, title: "🌱".repeat(120), description: "🌱".repeat(4000) }), true);
  configure((_name, args) => ({ data: receipt(args), error: null })); const h = setup({ send: createQuest }); const c = h.make(); await fill(c);
  c.updateDraft("title", "🌱".repeat(120)); c.updateDraft("description", "🌱".repeat(4000)); await c.submit(); assert.equal(calls.length, 1);
  const rejected = await createQuest({}, form({ request: { ...base, importance: ["side"] } })); assert.equal(rejected.outcome, "rejected"); assert.equal(calls.length, 1);
});

test("local validation retains the draft and never persists or dispatches an invalid request", async () => {
  const h = setup(); const c = h.make(); await fill(c); c.updateDraft("description", "x".repeat(4001)); await c.submit();
  assert.equal(c.getSnapshot().draft.description.length, 4001); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(h.sent.length, 0); assert.equal(h.storage.values.size, 0);
});

test("real calendar validation and DST gap/fold conversion reject invalid input", () => {
  assert.equal(validateQuestCreationRequest({ ...base, scheduled_at: "2026-02-30T12:00:00Z" }), false);
  assert.equal(validateQuestCreationRequest({ ...base, scheduled_at: null }), false);
  assert.equal(validateQuestCreationRequest({ ...base, default_reward_exp: 2147483648 }), false);
  assert.deepEqual(localTimeToUtc("2026-03-08T02:30", "America/New_York"), { ok: false, reason: "nonexistent" });
  assert.deepEqual(localTimeToUtc("2026-11-01T01:30", "America/New_York"), { ok: false, reason: "ambiguous" });
  assert.deepEqual(localTimeToUtc("2026-04-05T01:45", "Australia/Lord_Howe"), { ok: false, reason: "ambiguous" });
  assert.deepEqual(localTimeToUtc("2026-07-01T08:00", "Asia/Ho_Chi_Minh"), { ok: true, value: "2026-07-01T01:00:00.000Z" });
});

test("runtime receipt validation rejects bad calendar, bounds, timing and request mismatches", () => {
  const id = uuid(); const good = receipt({ command_id: id, request: base });
  assert.equal(validateQuestCreationReceipt(good, id, base), true);
  for (const patch of [{ scheduled_at: "2026-02-30T12:00:00Z" }, { scheduled_at: null }, { reward_exp_snapshot: 2147483648 }, { reward_exp_snapshot: 5 }, { extra: true }, { command_id: uuid() }]) assert.equal(validateQuestCreationReceipt({ ...good, ...patch }, id, base), false);
});

test("invalid RPC receipt remains uncertain through the actual adapter and lifecycle", async () => {
  configure((_name, args) => ({ data: { ...receipt(args), reward_exp_snapshot: 12 }, error: null }));
  const h = setup({ send: createQuest }); const c = h.make(); await fill(c); await c.submit();
  assert.equal(c.getSnapshot().phase, "uncertain"); assert.equal(h.storage.values.size, 1); assert.deepEqual(invalidations, []);
});

test("day messaging checks both instants, handles deadlines, and never advertises a day selector", () => {
  const now = new Date("2026-07-02T01:00:00Z"); const id = uuid();
  const todayDeadline = receipt({ command_id: id, request: { ...base, deadline_at: "2026-07-02T12:00:00.000Z" } });
  assert.doesNotMatch(creationSuccessMessage(todayDeadline, "UTC", now), /neither|select/);
  const future = receipt({ command_id: id, request: { ...base, scheduled_at: null, deadline_at: "2026-07-03T12:00:00.000Z" } });
  const message = creationSuccessMessage(future, "UTC", now); assert.match(message, /deadline/); assert.match(message, /shows today only/); assert.doesNotMatch(message, /select|Quest created: planned start/);
});

test("missing Auth session rejects before RPC and leaves lifecycle operation recoverable", async () => {
  configure(() => assert.fail("RPC must not run"), "UTC", A, Error("expired"));
  const h = setup({ send: createQuest }); const c = h.make(); await fill(c); await c.submit();
  assert.equal(calls.length, 0); assert.equal(c.getSnapshot().phase, "uncertain"); assert.equal(h.storage.values.size, 1);
});

test("unavailable tab locking fails closed before persistence or dispatch", async () => {
  const h = setup({ lock: async () => { throw Error("locks unavailable"); } }); const c = h.make(); await c.recover(); await c.submit();
  assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(h.sent.length, 0); assert.equal(h.storage.values.size, 0);
});

test("double submit while the first action is in flight dispatches exactly once", async () => {
  const pending = deferred(); const h = setup({ send: () => pending.promise }); const c = h.make(); await fill(c);
  const first = c.submit(); await c.submit(); await tick(); assert.equal(h.sent.length, 1);
  c.updateDraft("title", "changed during flight"); pending.resolve(unknown); await first;
  assert.equal(c.getSnapshot().draft.title, base.title); assert.equal(h.storage.values.size, 1);
});

test("unmount while action is in flight leaves recovery durable and suppresses stale success", async () => {
  const pending = deferred(); const h = setup({ send: () => pending.promise }); const c = h.make(); await fill(c);
  const task = c.submit(); await tick(); c.deactivate(); pending.resolve(success()); await task;
  assert.equal(c.getSnapshot().message, undefined); assert.equal(c.getSnapshot().operations.length, 0);
  assert.equal(readPendingCreations(h.deps.storage, A).status, "valid");
});

test("recovery refuses to replace a known immutable operation with changed stored content", async () => {
  const h = setup(); const c = h.make(); await fill(c); await c.submit();
  const original = c.getSnapshot().operations[0];
  h.storage.values.set(pendingStorageKey(A, original.commandId), JSON.stringify({ ...original, request: { ...base, title: "changed" } }));
  await c.recover(); await c.retry(original.commandId);
  assert.equal(c.getSnapshot().storage, "corrupt"); assert.equal(h.sent.length, 1);
  assert.equal(c.getSnapshot().operations[0].request.title, base.title);
});

test("silent no-op persistence and removal are detected by verification", async () => {
  const h = setup({ send: async () => success() }); const c = h.make(); await fill(c);
  const write = h.storage.setItem.bind(h.storage); h.storage.setItem = () => {};
  await c.submit(); assert.equal(h.sent.length, 0); assert.equal(c.getSnapshot().phase, "blocked");
  h.storage.setItem = write; await c.recover(); h.storage.removeItem = () => {};
  await c.submit(); assert.equal(h.sent.length, 1); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(h.storage.values.size, 1);
});

test("recurring requests are closed, mode-specific and validate dates and SQL bounds", () => {
  for (const request of [recurring, { ...recurring, recurrence_mode: "weekly", weekdays: [1, 3, 7] }, { ...recurring, recurrence_mode: "monthly", month_day: 31 }]) {
    assert.equal(validateRecurringRequest(request), true);
    assert.equal(validateQuestCreationRequest(request), false, "v2 contract must not widen");
  }
  for (const patch of [{ recurrence_mode: "one_off" }, { recurrence_mode: "weekly", weekdays: [] }, { recurrence_mode: "weekly", weekdays: [1, 1] }, { recurrence_mode: "weekly", weekdays: [7, 1] }, { recurrence_mode: "weekly", weekdays: [0] }, { recurrence_mode: "monthly", month_day: 32 }, { month_day: 1 }, { scheduled_at: null }, { start_date: "2026-02-30" }, { start_date: "0000-01-01" }, { end_date: "2026-01-01" }, { default_reward_exp: 2147483648 }]) {
    assert.equal(validateRecurringRequest({ ...recurring, ...patch }), false, JSON.stringify(patch));
  }
});

test("v2 and v3 recovery coexist unchanged; version/request/key substitutions and command collisions reject", () => {
  const h = setup();
  const old = { version: 2, userId: A, commandId: uuid(), timezone: "UTC", request: base };
  const next = { version: 3, userId: A, commandId: uuid(), timezone: "UTC", request: recurring };
  persistPending(h.deps.storage, old); persistPending(h.deps.storage, next);
  assert.equal(h.storage.getItem(pendingStorageKey(A, old.commandId)), JSON.stringify(old));
  assert.equal(h.storage.getItem(pendingStorageKey(A, next.commandId, 3)), JSON.stringify(next));
  assert.deepEqual(readPendingCreations(h.deps.storage, A).operations, [old, next]);
  assert.throws(() => persistPending(h.deps.storage, { ...next, commandId: old.commandId }));
  for (const value of [{ ...next, version: 2 }, { ...next, version: 4 }, { ...next, request: base }, { ...next, extra: true }, { ...old, version: 3 }]) {
    const storage = new MemoryStorage(); const raw = JSON.stringify(value);
    storage.setItem(pendingStorageKey(A, value.commandId, value.version === 2 ? 2 : 3), raw);
    assert.equal(readPendingCreations(() => storage, A).status, "corrupt"); assert.equal(storage.length, 1);
  }
});

test("recurring commit then lost response recovers v3 dates and exact command after refresh/timezone change", async () => {
  const effects = new Map();
  const respond = (_name, args) => {
    assert.equal(_name, "create_recurring_quest_v2");
    assert.equal(args.origin, "web_ui"); assert.equal(Object.hasOwn(args, "userId"), false);
    if (!effects.has(args.command_id)) { effects.set(args.command_id, JSON.stringify(args.request)); throw Error("lost response after commit"); }
    assert.equal(effects.get(args.command_id), JSON.stringify(args.request));
    return { data: recurringScheduleReceipt(args, true), error: null };
  };
  configure(respond);
  const h = setup({ send: createQuest }); const c = h.make(); await fill(c);
  c.updateDraft("recurrence_mode", "weekly"); c.updateDraft("start_date", recurring.start_date);
  c.updateDraft("end_date", "2026-12-31"); c.updateDraft("weekdays", [7, 1]);
  await c.submit();
  const saved = c.getSnapshot().operations[0]; assert.equal(saved.version, 4); assert.deepEqual(saved.request.weekdays, [1, 7]);
  configure(respond, "Asia/Ho_Chi_Minh");
  const restored = h.make(A, "Asia/Ho_Chi_Minh"); await restored.recover();
  assert.equal(restored.getSnapshot().draft.recurrence_mode, "weekly");
  assert.equal(restored.getSnapshot().draft.end_date, "2026-12-31");
  await restored.retry(saved.commandId);
  assert.equal(effects.size, 1); assert.equal(h.storage.length, 0);
  assert.equal(h.sent[0].request_json, h.sent[1].request_json); assert.equal(h.sent[0].command_id, h.sent[1].command_id);
  assert.equal(invalidations.length, 1);
});

test("daily and monthly drafts create through recurring RPC; one-off drafts still use v2", async () => {
  for (const cadence of ["daily", "monthly"]) {
    configure((_name, args) => ({ data: recurringScheduleReceipt(args), error: null }));
    const h = setup({ send: createQuest }); const c = h.make(); await fill(c);
    c.updateDraft("recurrence_mode", cadence); c.updateDraft("start_date", recurring.start_date); c.updateDraft("month_day", "31");
    await c.submit(); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(calls[0].name, "create_recurring_quest_v2");
    const request = JSON.parse(h.sent[0].request_json); assert.equal(Object.hasOwn(request, "scheduled_at"), false);
    assert.equal(request.month_day, cadence === "monthly" ? 31 : undefined);
  }
  const h = setup(); const c = h.make(); await fill(c); await c.submit(); assert.equal(c.getSnapshot().operations[0].version, 2);
});

test("recurring receipt mismatch and RPC errors preserve exact pending data", async () => {
  for (const response of [(args) => ({ data: { ...recurringScheduleReceipt(args), anchor_date: "2026-01-01" }, error: null }), () => ({ data: null, error: { code: "42501" } })]) {
    configure((_name, args) => response(args));
    const h = setup({ send: createQuest }); const c = h.make(); await fill(c);
    c.updateDraft("recurrence_mode", "daily"); c.updateDraft("start_date", recurring.start_date);
    await c.submit(); assert.equal(c.getSnapshot().phase, "uncertain"); assert.equal(h.storage.length, 1);
  }
  const id = uuid(); const receipt = recurringReceipt({ command_id: id, request: recurring });
  assert.equal(validateRecurringReceipt(receipt, id, recurring), true);
  for (const patch of [{ replay: "yes" }, { extra: true }, { weekdays: [] }, { command_id: uuid() }, { occurrence_limit: 2 }, { recurrence_changed_event_id: A }]) {
    assert.equal(validateRecurringReceipt({ ...receipt, ...patch }, id, recurring), false);
  }
});

test("recurring creation retains account/timezone preflight checks", async () => {
  configure(() => assert.fail("no RPC"), "Asia/Ho_Chi_Minh");
  assert.equal((await createQuest({}, form({ request: recurring }))).reason, "timezone");
  assert.equal((await createQuest({}, form({ request: recurring, account: B }))).reason, "account");
  assert.equal((await createQuest({}, form({ request: { ...recurring, month_day: 1 } }))).reason, "validation");
});

function pauseSetup(send = async () => unknown, storage = new MemoryStorage()) {
  const lock = locks(); const sent = [];
  const deps = { storage: () => storage, lock: (work) => lock(A, work), uuid,
    send: async (operation) => { sent.push(operation); return send(operation); } };
  return { storage, sent, deps, make: () => new RecurrencePauseLifecycle(A, B, deps) };
}
function pauseReceipt(operation) { return { command_id: operation.commandId, quest_id: operation.questId, recurrence_rule_id: A,
  recurrence_mode: "daily", paused: operation.paused, stopped_at: operation.paused ? "2026-09-29T12:00:00Z" : null, state_event_id: B, replay: false }; }

test("pause/resume action checks account and shape before RPC; errors and bad receipts are uncertain", async () => {
  const operation = { userId: A, questId: B, commandId: uuid(), paused: true };
  configure(() => assert.fail("no RPC"));
  assert.equal((await changeRecurrencePause({ ...operation, userId: B })).outcome, "rejected");
  assert.equal((await changeRecurrencePause({ ...operation, paused: "true" })).outcome, "rejected");
  for (const response of [{ data: null, error: { code: "42501" } }, { data: { ...pauseReceipt(operation), paused: false }, error: null }]) {
    configure(() => response); assert.equal((await changeRecurrencePause(operation)).outcome, "unknown");
  }
  configure((name, args) => { assert.equal(name, "set_quest_recurrence_pause"); assert.deepEqual(args, { command_id: operation.commandId, quest_id: B, paused: true, origin: "web_ui" }); return { data: pauseReceipt(operation), error: null }; });
  assert.equal((await changeRecurrencePause(operation)).outcome, "success"); assert.equal(invalidations.length, 1);
});

test("pause double submit is gated and reload replays immutable operation before allowing resume", async () => {
  const pending = deferred(); const h = pauseSetup(() => pending.promise); const c = h.make(); await c.recover();
  const task = c.submit(true); await tick(); await c.submit(true); assert.equal(h.sent.length, 1); assert.equal(h.storage.length, 1);
  pending.resolve(unknown); await task;
  const restored = h.make(); await restored.recover(); assert.equal(restored.getSnapshot().phase, "uncertain");
  await restored.submit(false); assert.equal(h.sent.length, 1);
  h.deps.send = async (op) => { assert.deepEqual(op, h.sent[0]); return { outcome: "success" }; };
  await restored.retry(); assert.equal(h.storage.length, 0); assert.equal(restored.getSnapshot().phase, "ready");
});

test("pause recovery retains retry rejection, detects tampering and suppresses stale account responses", async () => {
  const h = pauseSetup(async () => ({ outcome: "unknown" })); const c = h.make(); await c.recover(); await c.submit(true);
  h.deps.send = async () => ({ outcome: "rejected" }); await c.retry(); assert.equal(h.storage.length, 1);
  const raw = h.storage.getItem(PAUSE_PREFIX + A + ":" + B);
  h.storage.setItem(PAUSE_PREFIX + A + ":" + B, raw.replace('"paused":true', '"paused":false'));
  await c.recover(); assert.equal(c.getSnapshot().phase, "blocked");
  const pending = deferred(); const other = pauseSetup(() => pending.promise); const active = other.make(); await active.recover();
  const task = active.submit(false); await tick(); active.deactivate(); pending.resolve({ outcome: "success" }); await task;
  assert.equal(other.storage.length, 1); assert.equal(active.getSnapshot().phase, "blocked");
});

test("pause storage failure blocks dispatch; lost transport restores same command for retry", async () => {
  const h = pauseSetup(async () => { throw Error("lost"); }); const c = h.make(); await c.recover();
  h.storage.failure = "write"; await c.submit(true); assert.equal(h.sent.length, 0);
  h.storage.failure = undefined; await c.recover(); await c.submit(true);
  assert.equal(c.getSnapshot().phase, "uncertain"); const id = h.sent[0].commandId;
  h.storage.values.clear(); await c.recover(); await c.retry(); assert.equal(h.sent[1].commandId, id);
});

test("recurring list validates complete server projection without generating slots", () => {
  const row = { quest_id: A, title: recurring.title, recurrence_mode: "daily", recurrence_type: "daily", paused: false,
    anchor_date: recurring.start_date, end_date: null, weekdays: null, month_day: null, occurrence_limit: null,
    default_reward_exp: 37, materialized_occurrence_count: 1, last_slot_date: recurring.start_date };
  assert.deepEqual(parseRecurringQuests([row]), [row]); assert.deepEqual(parseRecurringQuests([]), []);
  for (const input of [null, [row, row], [{ ...row, weekdays: [1] }], [{ ...row, paused: "false" }], [{ ...row, default_reward_exp: undefined }], [{ ...row, last_slot_date: "bad" }]]) assert.equal(parseRecurringQuests(input), null);
});
