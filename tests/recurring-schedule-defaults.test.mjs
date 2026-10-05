import "./helpers/ui-loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Recurring Schedule Defaults V1 frontend: closed request/receipt parsers, the
// Quest-ID series read, the schedule command lifecycle with its own durable
// namespace, the server action's stale/rejection mapping, and the nonfatal
// materialization warnings surfaced by the Daily loader.
const owner = "00000000-0000-0000-0000-000000000001";
const quest = "00000000-0000-0000-0000-000000000003";
const rule = "00000000-0000-0000-0000-000000000005";
const command = "00000000-0000-0000-0000-000000000004";
const eventId = "00000000-0000-0000-0000-000000000006";

const authMock = `data:text/javascript,${encodeURIComponent(`
  export function requireUser() { return Promise.resolve(globalThis.__authUser); }
  export function getAuthenticatedUser() { return Promise.resolve(globalThis.__authUser); }
`)}`;
const cacheMock = `data:text/javascript,${encodeURIComponent(`
  export function revalidatePath(...args) { (globalThis.__revalidated ??= []).push(args); }
`)}`;
// series-actions reads its transport through ./recurring-data; this suite swaps
// only that boundary so the certified rejection mapping is observable.
const dataMock = `data:text/javascript,${encodeURIComponent(`
  export class ScheduleCommandError extends Error {
    constructor(code, message) { super(message); this.name = "ScheduleCommandError"; this.code = code; }
  }
  globalThis.__ScheduleCommandError = ScheduleCommandError;
  export function getRecurringSeriesDetail() { return Promise.resolve(globalThis.__seriesRead); }
  export function setRecurringScheduleDefaults(...args) {
    (globalThis.__scheduleCalls ??= []).push(args);
    if (globalThis.__scheduleThrows) throw globalThis.__scheduleThrows;
    return Promise.resolve(globalThis.__scheduleReceipt);
  }
`)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/cache") return { url: cacheMock, shortCircuit: true };
    if (specifier === "@/features/auth/session") return { url: authMock, shortCircuit: true };
    if (specifier === "./recurring-data" && context.parentURL?.endsWith("/series-actions.ts")) {
      return { url: dataMock, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { validScheduleDefaults, partialScheduleDefaults, scheduleDefaultsFromDraft, NO_SCHEDULE_DEFAULTS, isClockTime } =
  await import("../src/features/quests/schedule-model.ts");
const { beginScheduleDraft, editScheduleDraft, markScheduleDraftConflicted, reconcileScheduleDraft,
  reloadScheduleDraft, sameScheduleValues, scheduleValuesFromRule } =
  await import("../src/features/quests/schedule-draft.ts");
const { validateRecurringRequest, validateRecurringRequestV3, validateRecurringRequestV4, isScheduledRecurringRequest } =
  await import("../src/features/quests/recurring-model.ts");
const { validateRecurringScheduleReceipt } = await import("../src/features/quests/recurring-receipt.ts");
const { parseSeriesDetail, parseScheduleDefaultsReceipt } = await import("../src/features/quests/series-detail-model.ts");
const { parseMaterializeDay, issueClock, MATERIALIZATION_ISSUE_REASONS } = await import("../src/features/quests/materialization-model.ts");
const { pendingStorageKey, persistPending, readPendingCreations } = await import("../src/features/quests/create-pending.ts");
const { ScheduleDefaultsLifecycle, SCHEDULE_PREFIX, SCHEDULE_LOCK, isScheduleOperation, getScheduleServerSnapshot } =
  await import("../src/features/quests/schedule-pending.ts");
const { saveScheduleDefaults, readRecurringSeriesDetail } = await import("../src/features/quests/series-actions.ts");
const { en, vi } = await import("../src/lib/localization/dictionaries.ts");

const v4 = { title: "Daily reading", description: null, importance: "side", priority: null, default_reward_exp: 37,
  recurrence_mode: "daily", start_date: "2026-09-29", end_date: null,
  local_start_time: "08:00", local_end_time: "09:30", planned_end_day_offset: 0 };
const untimed = { ...v4, local_start_time: null, local_end_time: null, planned_end_day_offset: null };
const snapshot = (patch = {}) => ({ recurrence_type: "daily", interval_count: null, weekdays: null, month_day: null,
  anchor_date: "2026-10-01", end_date: null, occurrence_limit: null, revision: 1, stopped_at: null,
  local_start_time: null, local_end_time: null, planned_end_day_offset: null, ...patch });
const detail = (patch = {}, rulePatch = {}) => ({ version: 1, quest_id: quest, title: "Daily reading",
  recurrence_mode: "daily", recurrence_rule_id: rule, rule: snapshot(rulePatch),
  paused: rulePatch.stopped_at != null, materialized_occurrence_count: 4, timezone: "Asia/Ho_Chi_Minh", ...patch });
const scheduleReceipt = (patch = {}) => ({ version: 1, command_id: command, quest_id: quest,
  recurrence_rule_id: rule, event_id: eventId, before: snapshot(), after: snapshot({ revision: 2 }),
  changed: true, effective_at: "2026-10-04T12:00:00Z", replay: false, ...patch });


test("schedule tuples are all-or-nothing and ordered exactly like the certified SQL rule", () => {
  assert.equal(validScheduleDefaults(null, null, null), true, "untimed series");
  assert.equal(validScheduleDefaults("08:00", "09:00", 0), true);
  assert.equal(validScheduleDefaults("08:00", "08:00", 1), true, "equal clock on next day is 24 hours");
  assert.equal(validScheduleDefaults("08:00", "08:00", 0), false, "same day needs a later end");
  assert.equal(validScheduleDefaults("08:00", "07:00", 1), true);
  assert.equal(validScheduleDefaults("08:00", null, 0), false, "partial pair");
  assert.equal(validScheduleDefaults(null, null, 1), false, "offset without times");
  assert.equal(validScheduleDefaults("8:00", "09:00", 0), false, "unpadded clock");
  assert.equal(validScheduleDefaults("24:00", "25:00", 1), false, "the day ends at 24:00 exclusive");
  assert.equal(validScheduleDefaults("08:00:15", "09:00:15", 0), false, "whole minutes only");
  assert.equal(validScheduleDefaults("08:00", "10:00", 2), false, "offset is 0 or 1");
  assert.equal(partialScheduleDefaults("08:00", "  "), true);
  assert.equal(partialScheduleDefaults("", ""), false);
  assert.deepEqual(scheduleDefaultsFromDraft("", "", false), { ...NO_SCHEDULE_DEFAULTS });
  assert.equal(scheduleDefaultsFromDraft("08:00", "  ", false), null, "partial pair is never submittable");
  assert.deepEqual(scheduleDefaultsFromDraft("08:00", "07:00", true),
    { local_start_time: "08:00", local_end_time: "07:00", planned_end_day_offset: 1 });
  assert.equal(scheduleDefaultsFromDraft("08:00", "22:00", true), null,
    "a later end does not belong to the following day");
  assert.equal(isClockTime(undefined), false);
});

test("the v4 recurring request keeps the closed v3 boundary plus exactly the schedule tuple", () => {
  const v3 = { title: v4.title, description: null, importance: "side", priority: null, default_reward_exp: 37,
    recurrence_mode: "daily", start_date: "2026-09-29", end_date: null };
  assert.equal(validateRecurringRequestV4(v4), true);
  assert.equal(validateRecurringRequestV4(untimed), true, "all-null tuple is a valid untimed series");
  assert.equal(validateRecurringRequestV3(v4), false, "v3 never carries schedule keys");
  assert.equal(validateRecurringRequestV4({ ...v4, local_end_time: null }), false, "partial tuple");
  assert.equal(validateRecurringRequestV4({ ...v4, local_start_time: "25:00" }), false, "impossible clock");

test("the creation receipt is a closed 19-key boundary bound to the exact request", () => {
  const request = v4;
  const receipt = { version: 2, command_id: command, quest_id: quest, recurrence_rule_id: rule,
    definition_created_event_id: eventId, recurrence_changed_event_id: "00000000-0000-0000-0000-000000000007",
    recurrence_mode: "daily", recurrence_type: "daily", anchor_date: request.start_date, end_date: request.end_date,
    weekdays: null, month_day: null, occurrence_limit: null, default_reward_exp: request.default_reward_exp,
    revision: 1, local_start_time: "08:00", local_end_time: "09:30", planned_end_day_offset: 0, replay: false };
  assert.equal(validateRecurringScheduleReceipt(receipt, command, request), true);
  for (const patch of [{ version: 1 }, { revision: 2 }, { local_start_time: "08:01" }, { local_start_time: null },
    { planned_end_day_offset: null }, { planned_end_day_offset: 1 }, { replay: "yes" }, { extra: true },
    { command_id: quest }, { recurrence_mode: "weekly" }, { anchor_date: "2026-10-01" }]) {
    assert.equal(validateRecurringScheduleReceipt({ ...receipt, ...patch }, command, request), false, JSON.stringify(patch));
  }
  assert.equal(validateRecurringScheduleReceipt(receipt, quest, request), false, "wrong command id");
});

test("the Quest-ID series read rejects any row outside the certified detail contract", () => {
  assert.deepEqual(parseSeriesDetail(detail(), quest), detail());
  assert.equal(parseSeriesDetail(detail(), "11111111-1111-4111-8111-111111111111"), null, "wrong quest id");
  assert.equal(parseSeriesDetail({ ...detail(), extra: true }, quest), null, "extra key");
  assert.equal(parseSeriesDetail({ ...detail(), paused: true }, quest), null, "paused must equal stopped_at");
  assert.equal(parseSeriesDetail(detail({}, { stopped_at: "2026-10-02T00:00:00Z" }), quest).paused, true);
  assert.equal(parseSeriesDetail(detail({}, { stopped_at: "yesterday" }), quest), null, "malformed stopped_at");
  assert.equal(parseSeriesDetail({ ...detail(), recurrence_mode: "weekly" }, quest), null, "cadence/type mapping");
  assert.equal(parseSeriesDetail(detail({}, { local_start_time: "08:00" }), quest), null, "partial tuple in a snapshot");
  assert.equal(parseSeriesDetail(detail({}, { local_start_time: "08:00", local_end_time: "09:00", planned_end_day_offset: 0 }), quest)
    .rule.local_end_time, "09:00");
  assert.equal(parseSeriesDetail({ ...detail(), timezone: "  " }, quest), null);

test("the schedule command receipt proves its revision exactly as the SQL command reports it", () => {
  const receipt = scheduleReceipt();
  assert.deepEqual(parseScheduleDefaultsReceipt(receipt, command, quest), receipt);
  assert.equal(parseScheduleDefaultsReceipt(receipt, "11111111-1111-4111-8111-111111111111", quest), null, "wrong command");
  assert.equal(parseScheduleDefaultsReceipt(receipt, command, "11111111-1111-4111-8111-111111111111"), null, "wrong series");
  assert.equal(parseScheduleDefaultsReceipt({ ...receipt, after: snapshot({ revision: 1 }) }, command, quest), null,
    "a change must bump exactly one revision");
  const unchanged = scheduleReceipt({ changed: false, after: snapshot() });
  assert.deepEqual(parseScheduleDefaultsReceipt(unchanged, command, quest), unchanged,
    "an unchanged command leaves an identical snapshot");
  assert.equal(parseScheduleDefaultsReceipt({ ...unchanged, after: snapshot({ revision: 4 }) }, command, quest), null,
    "unchanged cannot bump the revision");
  assert.equal(parseScheduleDefaultsReceipt({ ...receipt, extra: true }, command, quest), null);
  assert.equal(parseScheduleDefaultsReceipt({ ...receipt, replay: "yes" }, command, quest), null);
});

test("materialization issues are nonfatal but every field stays inside the certified v2 contract", () => {
  const issue = { quest_id: quest, recurrence_rule_id: rule, rule_revision: 3, source_slot_date: "2026-10-04",
    local_start_time: "08:30", local_end_time: "09:30", planned_end_day_offset: 0,
    endpoint: "start", reason: "nonexistent_local_time" };
  const read = { version: 2, day: "2026-10-04", timezone: "Asia/Ho_Chi_Minh", created_count: 2, issues: [issue] };
  assert.deepEqual(parseMaterializeDay(read, "2026-10-04"), { createdCount: 2, issues: [issue] });
  assert.equal(issueClock("08:30"), "08:30");
  assert.equal(issueClock("08:30:00"), "08:30", "raw Postgres time still displays whole minutes");
  assert.equal(issueClock(null), null);
  assert.equal(parseMaterializeDay({ ...read, version: 1 }, "2026-10-04"), null, "wrong contract version");
  assert.equal(parseMaterializeDay(read, "2026-10-05"), null, "wrong selected day");
  assert.equal(parseMaterializeDay({ ...read, created_count: -1 }, "2026-10-04"), null);
  assert.equal(parseMaterializeDay({ ...read, issues: "[]" }, "2026-10-04"), null);
  assert.equal(parseMaterializeDay({ ...read, issues: [{ ...issue, reason: "mystery" }] }, "2026-10-04"), null,
    "only certified reasons reach the UI");
  assert.equal(parseMaterializeDay({ ...read, issues: [{ ...issue, endpoint: "deadline" }] }, "2026-10-04"), null);
  assert.equal(parseMaterializeDay({ ...read, issues: [{ ...issue, extra: true }] }, "2026-10-04"), null,
    "one malformed entry invalidates the whole response");
  assert.equal(parseMaterializeDay({ ...read, issues: [{ ...issue, planned_end_day_offset: 2 }] }, "2026-10-04"), null);
  // The dictionary carries every certified reason in both locales.
  for (const reason of MATERIALIZATION_ISSUE_REASONS) {
    assert.equal(typeof en.materialization.reasons[reason], "string", `en ${reason}`);
    assert.equal(typeof vi.materialization.reasons[reason], "string", `vi ${reason}`);
  }
});

  assert.equal(parseSeriesDetail({ ...detail(), materialized_occurrence_count: -1 }, quest), null);
});

  assert.equal(validateRecurringRequestV4({ ...v4, local_end_time: "07:00" }), false, "same-day end must follow start");
  assert.equal(validateRecurringRequestV4({ ...v4, planned_end_day_offset: 1, local_end_time: "07:00" }), true,
    "next-day end at or before start");
  assert.equal(validateRecurringRequestV4({ ...v4, extra: true }), false, "extra key");
  assert.equal(validateRecurringRequestV4({ ...v4, recurrence_mode: "weekly", weekdays: [1] }), true);
  assert.equal(validateRecurringRequest(v4), true);
  assert.equal(isScheduledRecurringRequest(v4), true);
  assert.equal(validateRecurringRequest(v3), true, "frozen v3 records stay replayable");
});

class Storage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
test("pending v4 records use their own namespace and coexist with the frozen v2/v3 ones", () => {
  const storage = new Storage();
  const access = () => storage;
  const record = (version, request) => ({ version, userId: owner, commandId: command, timezone: "UTC", request });
  const v3 = { title: v4.title, description: null, importance: "side", priority: null, default_reward_exp: 37,
    recurrence_mode: "daily", start_date: "2026-09-29", end_date: null };
  assert.equal(pendingStorageKey(owner, command, 4), `system.quest-creation.pending.v4:${owner}:${command}`);
  const scheduled = record(4, v4);
  persistPending(access, scheduled);
  persistPending(access, { ...record(3, v3), commandId: "00000000-0000-0000-0000-000000000008" });
  assert.equal(storage.getItem(pendingStorageKey(owner, command, 4)), JSON.stringify(scheduled));
  const read = readPendingCreations(access, owner);
  assert.equal(read.status, "valid");
  // Recovery keeps records sorted by command identity, never by contract version.
  assert.deepEqual(read.operations.map((operation) => operation.version), [4, 3]);
  // A v4 record under the frozen v3 key is corruption, never a silent translation.
  storage.setItem(pendingStorageKey(owner, command, 3), JSON.stringify(scheduled));
  assert.equal(readPendingCreations(access, owner).status, "corrupt");
});

test("schedule commands persist under their own namespace before dispatch and clear only on proof", async () => {
  const storage = new Storage();
  const key = `${SCHEDULE_PREFIX}${owner}:${quest}`;
  const defaults = { local_start_time: "08:00", local_end_time: "09:30", planned_end_day_offset: 0 };
  const sent = [];
  const deps = {
    storage: () => storage,
    lock: async (work) => work(),
    uuid: () => command,
    send: async (operation) => {
      // The exact record is already durable when the request leaves the browser.
      assert.equal(storage.getItem(key), JSON.stringify(operation));
      sent.push(structuredClone(operation));
      return { outcome: "success" };
    },
  };
  const lifecycle = new ScheduleDefaultsLifecycle(owner, quest, deps);
  assert.equal(SCHEDULE_LOCK, "system.quest-schedule", "the coordination lock never changes");
  assert.equal(getScheduleServerSnapshot().phase, "recovering");
  await lifecycle.recover();
  assert.equal(lifecycle.getSnapshot().phase, "ready");
  assert.equal(await lifecycle.submit(defaults, 3), true);
  assert.equal(sent[0].expectedRevision, 3);
  assert.deepEqual(sent[0].defaults, defaults);
  assert.equal(storage.getItem(key), null, "a confirmed command leaves no recovery record");
  assert.equal(lifecycle.getSnapshot().phase, "ready");
});

test("an unknown schedule outcome keeps the saved command and replays it exactly on retry", async () => {
  const storage = new Storage();
  const key = `${SCHEDULE_PREFIX}${owner}:${quest}`;
  const sent = [];
  let attempt = 0;
  const lifecycle = new ScheduleDefaultsLifecycle(owner, quest, {
    storage: () => storage, lock: async (work) => work(), uuid: () => command,
    send: async (operation) => {
      sent.push(structuredClone(operation));
      return attempt++ === 0 ? { outcome: "unknown", error: "Connection lost." } : { outcome: "success" };
    },
  });
  await lifecycle.recover();
  const defaults = { local_start_time: null, local_end_time: null, planned_end_day_offset: null };
  assert.equal(await lifecycle.submit(defaults, 7), false);
  assert.equal(lifecycle.getSnapshot().phase, "uncertain");
  assert.equal(JSON.parse(storage.getItem(key)).expectedRevision, 7);
  await lifecycle.recover();
  assert.equal(lifecycle.getSnapshot().phase, "uncertain");
  assert.equal(await lifecycle.retry(), true);
  assert.deepEqual(sent[1], sent[0], "retry replays the exact saved request");
  assert.equal(storage.getItem(key), null);
});
test("a rejected schedule command is discarded on first attempt and on retry alike", async () => {
  const storage = new Storage();
  const key = `${SCHEDULE_PREFIX}${owner}:${quest}`;
  const results = [{ outcome: "rejected", reason: "stale", error: "The recurrence rule changed." },
    { outcome: "rejected", reason: "retired", error: "No longer editable." }];
  const lifecycle = new ScheduleDefaultsLifecycle(owner, quest, {
    storage: () => storage, lock: async (work) => work(), uuid: () => command,
    send: async () => results.shift(),
  });
  await lifecycle.recover();
  assert.equal(await lifecycle.submit({ local_start_time: "08:00", local_end_time: "09:00", planned_end_day_offset: 0 }, 2), false);
  assert.equal(lifecycle.getSnapshot().phase, "ready");
  assert.equal(lifecycle.getSnapshot().error, "The recurrence rule changed.");
  assert.equal(storage.getItem(key), null);
  // A retry the backend rejects proves the command never committed.
  storage.setItem(key, JSON.stringify({ version: 1, userId: owner, questId: quest, commandId: command, expectedRevision: 2,
    defaults: { local_start_time: "08:00", local_end_time: "09:00", planned_end_day_offset: 0 } }));
  await lifecycle.recover();
  assert.equal(lifecycle.getSnapshot().phase, "uncertain");
  assert.equal(await lifecycle.retry(), false);
  assert.equal(lifecycle.getSnapshot().phase, "ready");
  assert.equal(storage.getItem(key), null);
});

test("schedule recovery blocks on unreadable data, and an inactive session never dispatches", async () => {
  const key = `${SCHEDULE_PREFIX}${owner}:${quest}`;
  const storage = new Storage();
  let sends = 0;
  const lifecycle = new ScheduleDefaultsLifecycle(owner, quest, { storage: () => storage, lock: async (work) => work(),
    uuid: () => command, send: async () => { sends++; return { outcome: "success" }; } });
  await lifecycle.recover();
  assert.equal(await lifecycle.submit({ local_start_time: "08:00", local_end_time: null, planned_end_day_offset: null }, 1), false,
    "a partial tuple never reaches the wire");
  assert.equal(sends, 0);
  assert.equal(storage.length, 0);
  storage.setItem(key, "not-json");
  await lifecycle.recover();
  assert.equal(lifecycle.getSnapshot().phase, "blocked");
  lifecycle.activate();
  storage.setItem(key, JSON.stringify({ version: 1, userId: owner, questId: quest, commandId: command, expectedRevision: 0,
    defaults: { ...NO_SCHEDULE_DEFAULTS } }));
  await lifecycle.recover();
  assert.equal(lifecycle.getSnapshot().phase, "blocked", "an impossible revision is not a record");
  lifecycle.deactivate();
  assert.equal(await lifecycle.submit({ ...NO_SCHEDULE_DEFAULTS }, 1), false);
  assert.equal(sends, 0, "a deactivated session sends nothing");
});

test("the schedule operation record is closed and bound to its own series", () => {
  const operation = { version: 1, userId: owner, questId: quest, commandId: command, expectedRevision: 4, defaults: { ...NO_SCHEDULE_DEFAULTS } };
  assert.equal(isScheduleOperation(operation, owner, quest), true);
  assert.equal(isScheduleOperation({ ...operation, version: 2 }, owner, quest), false);
  assert.equal(isScheduleOperation({ ...operation, questId: "11111111-1111-4111-8111-111111111111" }, owner, quest), false);
  assert.equal(isScheduleOperation({ ...operation, expectedRevision: 0 }, owner, quest), false);
  assert.equal(isScheduleOperation({ ...operation, extra: true }, owner, quest), false);
  assert.equal(isScheduleOperation({ ...operation,
    defaults: { local_start_time: "08:00", local_end_time: null, planned_end_day_offset: null } }, owner, quest), false);
});

test("the schedule action validates identity and maps certified rejections without inventing an outcome", async () => {
  globalThis.__authUser = { id: owner };
  globalThis.__revalidated = [];
  globalThis.__scheduleCalls = [];
  globalThis.__scheduleThrows = undefined;
  globalThis.__scheduleReceipt = { version: 1, command_id: command };
  const defaults = { local_start_time: "08:00", local_end_time: "09:30", planned_end_day_offset: 0 };
  const input = { userId: owner, commandId: command, questId: quest, expectedRevision: 5, defaults };
  assert.deepEqual(await saveScheduleDefaults(input), { outcome: "success" });
  assert.deepEqual(globalThis.__revalidated, [["/dashboard"]]);
  assert.deepEqual(globalThis.__scheduleCalls, [[command, quest, 5, defaults]]);

  assert.equal((await saveScheduleDefaults({ ...input, userId: "11111111-1111-4111-8111-111111111111" })).outcome, "rejected");
  assert.equal((await saveScheduleDefaults({ ...input, defaults: { ...defaults, local_end_time: null } })).reason, "invalid",
    "a partial tuple never reaches SQL");
  assert.equal((await saveScheduleDefaults({ ...input, expectedRevision: 0 })).reason, "invalid");
  assert.equal((await saveScheduleDefaults({ ...input, commandId: "nope" })).reason, "invalid");
  assert.equal(globalThis.__scheduleCalls.length, 1, "invalid input sends nothing");

  for (const [code, message, reason] of [
    ["23514", "Stale recurring rule revision", "stale"],
    ["23514", "Recurring Quest is not editable", "retired"],
    ["23514", "Recurring rule not found", "retired"],
    ["P0002", "Recurring Quest not found", "retired"],
    ["22023", "Invalid recurring schedule defaults", "invalid"],
    ["23505", "Conflicting schedule defaults command reuse", "conflict"],
  ]) {
    globalThis.__scheduleThrows = new globalThis.__ScheduleCommandError(code, message);
    const result = await saveScheduleDefaults(input);
    assert.equal(result.outcome, "rejected", message);
    assert.equal(result.reason, reason, message);
    assert.equal(typeof result.error, "string");
  }
  // An unmapped rejection, a plain transport failure and a thrown command stay unknown.
  for (const failure of [new globalThis.__ScheduleCommandError("XX000", "boom"), new Error("network")]) {
    globalThis.__scheduleThrows = failure;
    assert.equal((await saveScheduleDefaults(input)).outcome, "unknown");
  }
  globalThis.__scheduleThrows = undefined;
});

test("the series read is owner-scoped and never returns a partially trusted row", async () => {
  globalThis.__authUser = { id: owner };
  globalThis.__seriesRead = detail();
  assert.deepEqual(await readRecurringSeriesDetail(owner, quest), detail());
  assert.equal(await readRecurringSeriesDetail("11111111-1111-4111-8111-111111111111", quest), null, "account mismatch");
  assert.equal(await readRecurringSeriesDetail(owner, "not-a-quest"), null, "identity check before any read");
});

test("schedule defaults copy is complete in both locales", () => {
  const leaves = (object, prefix = "") => Object.entries(object).flatMap(([key, value]) => typeof value === "string"
    ? [prefix + key] : leaves(value, `${prefix}${key}.`));
  assert.deepEqual(leaves(vi.scheduleDefaults), leaves(en.scheduleDefaults));
  assert.deepEqual(leaves(vi.materialization), leaves(en.materialization));
  for (const key of ["heading", "hint", "start", "end", "nextDay", "none", "edit", "save", "clear", "retry",
    "partial", "ordering", "conflict", "reload"]) {
    assert(en.scheduleDefaults[key].trim().length > 0, `en scheduleDefaults.${key}`);
    assert(vi.scheduleDefaults[key].trim().length > 0, `vi scheduleDefaults.${key}`);
  }
});

// Release blocker 1: a schedule-edit draft owns its BASE REVISION. Submission must use
// draft.baseRevision, never the newest authoritative detail revision at submit time.
const rule1 = { revision: 1, local_start_time: "08:00", local_end_time: "09:00", planned_end_day_offset: 0 };
const rule2 = { revision: 2, local_start_time: "11:00", local_end_time: "12:00", planned_end_day_offset: 0 };
const rule2Untimed = { revision: 2, local_start_time: null, local_end_time: null, planned_end_day_offset: null };

test("a draft is created from the revision it was loaded from", () => {
  assert.deepEqual(beginScheduleDraft(rule1), {
    values: { start: "08:00", end: "09:00", nextDay: false }, baseRevision: 1, dirty: false, conflicted: false,
  });
  assert.deepEqual(beginScheduleDraft(rule2Untimed), {
    values: { start: "", end: "", nextDay: false }, baseRevision: 2, dirty: false, conflicted: false,
  });
  assert.deepEqual(scheduleValuesFromRule({ ...rule1, planned_end_day_offset: 1 }),
    { start: "08:00", end: "09:00", nextDay: true });
  assert(sameScheduleValues({ start: "1", end: "2", nextDay: false }, { start: "1", end: "2", nextDay: false }));
  assert(!sameScheduleValues({ start: "1", end: "2", nextDay: false }, { start: "1", end: "2", nextDay: true }));
});

test("editing a field never advances the draft's base revision", () => {
  const draft = editScheduleDraft(beginScheduleDraft(rule1), { end: "10:00" });
  assert.equal(draft.baseRevision, 1, "the base revision is what the command must still expect");
  assert.equal(draft.dirty, true);
  assert.deepEqual(draft.values, { start: "08:00", end: "10:00", nextDay: false });
  const dirty = editScheduleDraft(draft, { nextDay: true });
  assert.equal(dirty.baseRevision, 1);
  assert.equal(dirty.values.nextDay, true);
  assert.equal(dirty.values.end, "10:00", "a patch never clears untouched fields");
});

test("A PRISTINE draft synchronizes values and base revision when authoritative detail advances", () => {
  const pristine = beginScheduleDraft(rule1);
  assert.equal(reconcileScheduleDraft(pristine, rule1), pristine, "an unchanged revision is the identical object");
  const synced = reconcileScheduleDraft(pristine, rule2);
  assert.deepEqual(synced.values, { start: "11:00", end: "12:00", nextDay: false });
  assert.equal(synced.baseRevision, 2);
  assert.equal(synced.dirty, false);
  assert.equal(synced.conflicted, false, "a pristine form is never a conflict");
  assert.deepEqual(reconcileScheduleDraft(synced, rule2), synced, "synchronization is idempotent");
  assert.deepEqual(reconcileScheduleDraft(synced, { ...rule2Untimed, revision: 3 }).values,
    { start: "", end: "", nextDay: false }, "an authoritative untimed revision synchronizes an empty form");
});

test("B DIRTY draft plus an advanced authoritative revision conflicts without merging or rebasing", () => {
  // The reviewer's exact bug: revision-1 draft, local edits, then the series advances.
  const dirty = editScheduleDraft(beginScheduleDraft(rule1), { start: "07:30" });
  const conflicted = reconcileScheduleDraft(dirty, rule2);
  assert.equal(conflicted.conflicted, true);
  assert.deepEqual(conflicted.values, { start: "07:30", end: "09:00", nextDay: false },
    "the user's local values are preserved verbatim");
  assert.equal(conflicted.baseRevision, 1, "the expected revision must never silently advance");
  assert.equal(conflicted.dirty, true);
  assert.equal(reconcileScheduleDraft(conflicted, rule2).conflicted, true, "no silent recovery on refresh");
  assert.equal(reconcileScheduleDraft(conflicted, { ...rule2, revision: 3 }).baseRevision, 1);
  assert.equal(reconcileScheduleDraft(dirty, rule1).conflicted, false,
    "a refresh at the draft's own revision is not a conflict");
});

test("explicit reload replaces local values with authoritative ones and updates the base revision", () => {
  const conflicted = reconcileScheduleDraft(editScheduleDraft(beginScheduleDraft(rule1), { start: "07:30" }), rule2);
  const reloaded = reloadScheduleDraft(rule2);
  assert.deepEqual(reloaded.values, { start: "11:00", end: "12:00", nextDay: false });
  assert.equal(reloaded.baseRevision, 2);
  assert.equal(reloaded.dirty, false);
  assert.equal(reloaded.conflicted, false);
  assert.equal(reconcileScheduleDraft(reloaded, rule2).conflicted, false, "the reloaded draft is submittable");
  assert.notEqual(conflicted.baseRevision, reloaded.baseRevision);
});

test("a submit that races a newer revision surfaces the conflict and never auto-retries", () => {
  // The backend rejects with a stale revision after the last local check passed.
  const raced = markScheduleDraftConflicted(editScheduleDraft(beginScheduleDraft(rule1), { start: "07:30" }));
  assert.equal(raced.conflicted, true);
  assert.equal(raced.baseRevision, 1, "the rejected command keeps its identity for replay records");
  assert.equal(markScheduleDraftConflicted(raced), raced, "re-marking is the identical object");
  assert.equal(reconcileScheduleDraft(raced, rule2).conflicted, true, "a later read must not clear it");
  assert.equal(reconcileScheduleDraft(raced, rule2).baseRevision, 1);
});
