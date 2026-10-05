import "./helpers/ui-loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import ts from "typescript";

// Recurring Series Management UI V1: one shared dialog trigger on recurring
// occurrence cards, one shared pause controller per quest, and unchanged
// one-off overflow / retirement namespaces. Only Auth/transport is replaced.
const sourceRoot = new URL("../src/", import.meta.url);
const mocksUrl = `data:text/javascript,${encodeURIComponent(`
  export async function requireUser() { return { id: "00000000-0000-0000-0000-000000000001" }; }
  export async function getAuthenticatedUser() { return { id: "00000000-0000-0000-0000-000000000001" }; }
  export function createServerSupabaseClient() { throw new Error("no transport in this suite"); }
  export function createSupabaseClient() {
    return {
      auth: {
        onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } } };
        }
      }
    };
  }
  export function revalidatePath() {}
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (["next/headers", "next/cache", "@/features/auth/session", "@/lib/supabase/server"].includes(specifier)) {
        return { url: mocksUrl, shortCircuit: true };
      }
      if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
      if (specifier.startsWith("@/") || specifier.startsWith("./")) {
        const base = specifier.startsWith("@/")
          ? new URL(specifier.slice(2), sourceRoot) : new URL(specifier, context.parentURL);
        for (const extension of [".ts", ".tsx"]) {
          const url = new URL(base.href + extension);
          if (existsSync(url)) return { url: url.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot.href) && url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { DailyQuestList } = await import("../src/features/quests/components.tsx");
const { RecurringSeriesManager, SeriesModalContent } = await import("../src/features/quests/recurring-series-manager.tsx");
const { RecurringRetirementProvider } = await import("../src/features/quests/recurring-retirement-provider.tsx");
const { QuestManagementProvider } = await import("../src/features/quests/management-provider.tsx");
const { RecurrencePauseProvider, RecurrencePauseRegistry } = await import("../src/features/quests/recurrence-pause-provider.tsx");
const { ScheduleDefaultsProvider, ScheduleDefaultsRegistry } = await import("../src/features/quests/schedule-provider.tsx");
const { SCHEDULE_PREFIX, SCHEDULE_LOCK } = await import("../src/features/quests/schedule-pending.ts");
const { PAUSE_PREFIX, PAUSE_LOCK, getPauseServerSnapshot } = await import("../src/features/quests/recurrence-pending.ts");
const { RECURRING_RETIREMENT_PREFIX, RECURRING_RETIREMENT_LOCK } = await import("../src/features/quests/recurring-retirement-model.ts");
const { MANAGEMENT_PREFIX, MANAGEMENT_LOCK, QuestManagementLifecycle } = await import("../src/features/quests/management-lifecycle.ts");
const { isFreshSeriesArchive } = await import("../src/features/quests/recurring-series-state.ts");
const { en, vi } = await import("../src/lib/localization/dictionaries.ts");
hooks.deregister();

const owner = "00000000-0000-0000-0000-000000000001";
const occurrence = "00000000-0000-0000-0000-000000000002";
const quest = "00000000-0000-0000-0000-000000000003";
const command = "00000000-0000-0000-0000-000000000004";
const otherQuest = "00000000-0000-0000-0000-000000000007";
const title = "Brush teeth";

const base = {
  occurrence_id: occurrence, quest_id: quest, quest_title: title,
  status: "draft", scheduled_at: null, deadline_at: null,
  source_slot_date: null, execution_cycle: 1, reward_exp_snapshot: 37,
  progression_ready: true, completable: false, already_completed_cycle: null,
};
const router = (element) => h(AppRouterContext.Provider, { value: { refresh() {} } }, element);
const wrap = (element) => router(
  h(RecurrencePauseProvider, { userId: owner },
    h(ScheduleDefaultsProvider, { userId: owner, locale: "en" },
      h(RecurringRetirementProvider, { userId: owner, locale: "en" }, element))));
const renderList = (quests, withOwner = true) => renderToStaticMarkup(router(
  h(QuestManagementProvider, { userId: owner, locale: "en" },
    h(DailyQuestList, { result: { status: "ok", quests }, timezone: "UTC", selectedDate: "2026-10-04", userId: withOwner ? owner : undefined, locale: "en" }))));
const detail = (paused = false, mode = "daily") => ({
  version: 1, quest_id: quest, title, recurrence_mode: mode,
  recurrence_rule_id: "00000000-0000-0000-0000-000000000005",
  paused, materialized_occurrence_count: 4, timezone: "UTC",
  rule: mode === "weekly"
    ? { recurrence_type: "selected_weekdays", weekdays: [1, 3], month_day: null, interval_count: null, anchor_date: "2026-10-01", end_date: "2026-12-31", occurrence_limit: null, revision: 3, stopped_at: paused ? "2026-10-02T00:00:00Z" : null, local_start_time: "08:30", local_end_time: "09:00", planned_end_day_offset: 0 }
    : { recurrence_type: "daily", weekdays: null, month_day: null, interval_count: null, anchor_date: "2026-10-01", end_date: null, occurrence_limit: null, revision: 1, stopped_at: paused ? "2026-10-02T00:00:00Z" : null, local_start_time: null, local_end_time: null, planned_end_day_offset: null },
});

test("recurring Daily card renders the Manage series disclosure; one-off overflow is untouched", () => {
  const recurring = renderList([{ ...base, source_slot_date: "2026-10-04" }]);
  assert.match(recurring, new RegExp(`aria-label="Manage series: ${title}"`));
  assert.match(recurring, />Manage series</);
  assert.doesNotMatch(recurring, /Quest actions/);
  // The entry point never exposes series-level actions directly on the card.
  assert.doesNotMatch(recurring, /Delete permanently/);
  assert.doesNotMatch(recurring, />Archive</);
  assert.match(recurring, /Recurring occurrence/);

  const oneOff = renderList([base]);
  assert.doesNotMatch(oneOff, /Manage series/);
  assert.match(oneOff, new RegExp(`aria-label="Quest actions: ${title}"`));
  assert.match(oneOff, />Archive</);
  assert.match(oneOff, />Delete permanently</);

  assert.doesNotMatch(renderList([{ ...base, source_slot_date: "2026-10-04" }], false), /Manage series/);
});

test("active series modal content carries the whole-series warning and no permanent delete", () => {
  const enHtml = renderContent(h(SeriesModalContent, contentProps()));
  assert.match(enHtml, /This affects the entire recurring series\./);
  assert.match(enHtml, />Daily</);
  assert.match(enHtml, />Running</);
  assert.match(enHtml, />Pause series</);
  assert.match(enHtml, />Archive series</);
  assert.doesNotMatch(enHtml, /Delete permanently/);
  assert.doesNotMatch(enHtml, />Restore</);

  const paused = renderContent(h(SeriesModalContent, contentProps({ detail: detail(true) })));
  assert.match(paused, />Paused</);
  assert.match(paused, />Resume series</);

  const weekly = renderContent(h(SeriesModalContent, contentProps({ detail: detail(false, "weekly") })));
  assert.match(weekly, />Weekly</);
  assert.match(weekly, /Series end/);
  assert.match(weekly, /Mon, Wed/);

  const viHtml = renderContent(h(SeriesModalContent, contentProps({ locale: "vi" })));
  assert.match(viHtml, /Thao tác này ảnh hưởng đến toàn bộ chuỗi lặp lại\./);
  assert.match(viHtml, />Tạm dừng chuỗi</);
  assert.doesNotMatch(viHtml, /Xóa vĩnh viễn/);

  const loading = renderContent(h(SeriesModalContent, contentProps({ detail: null, loading: true })));
  assert.match(loading, /Loading series management/);
  const failed = renderContent(h(SeriesModalContent, contentProps({ detail: null, loading: false })));
  assert.match(failed, /Series management data could not be loaded/);
});

test("EN/VI series localization parity holds and the manager exposes no delete path", () => {
  const leaves = (object, prefix = "") => Object.entries(object).flatMap(([key, value]) => typeof value === "string"
    ? [prefix + key] : leaves(value, `${prefix}${key}.`));
  for (const prefix of ["seriesManage.", "scheduleDefaults.", "materialization."]) {
    assert.deepEqual(leaves(vi).filter((key) => key.startsWith(prefix)),
      leaves(en).filter((key) => key.startsWith(prefix)), prefix);
  }
  for (const key of ["manage", "title", "affects", "running", "paused", "pause", "resume", "archive", "cadence", "state"]) {
    assert(en.seriesManage[key].trim().length > 0, `en seriesManage.${key}`);
    assert(vi.seriesManage[key].trim().length > 0, `vi seriesManage.${key}`);
  }
  assert.equal(en.seriesManage.manage, "Manage series");
  assert.equal(vi.seriesManage.manage, "Quản lý chuỗi");
  const manager = readFileSync(new URL("../src/features/quests/recurring-series-manager.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(manager, /Delete permanently|delete_recurring_quest|set_recurring_quest_archived/);
});

const renderContent = (element) => renderToStaticMarkup(wrap(element));
const scheduleView = (overrides = {}) => ({ phase: "ready", version: 0, ...overrides });
const contentProps = (overrides = {}) => ({ locale: "en", questId: quest, title, detail: detail(false), detailVersion: 0, loading: false, onRetry() {}, onReload() {},
  schedule: scheduleView(), async onScheduleSave() { return { saved: false }; }, async onScheduleRetry() { return false; }, ...overrides });

test("exactly one pause controller per quest; pause and retirement namespaces unchanged", async () => {
  assert.equal(PAUSE_PREFIX, "system.quest-recurrence.pending.v1:");
  assert.equal(PAUSE_LOCK, "system.quest-recurrence");
  assert.equal(RECURRING_RETIREMENT_PREFIX, "system.recurring-retirement.pending.v1:");
  assert.equal(RECURRING_RETIREMENT_LOCK, "system.recurring-retirement");
  assert.equal(MANAGEMENT_PREFIX, "system.quest-management.pending.v1:");
  assert.equal(MANAGEMENT_LOCK, "system.quest-management");

  const store = new Map();
  const sends = [];
  let release;
  const gated = new Promise((resolve) => { release = resolve; });
  const dependencies = {
    storage: () => ({
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    }),
    lock: async (work) => work(),
    uuid: () => command,
    send: async (operation) => {
      sends.push({ operation, keys: [...store.keys()] });
      await gated;
      return { outcome: "success" };
    },
  };
  const registry = new RecurrencePauseRegistry(owner, () => dependencies);
  const controller = registry.get(quest);
  assert.equal(registry.get(quest), controller, "one controller instance per questId");
  assert.notEqual(registry.get(otherQuest), controller);

  await controller.recover();
  assert.equal(controller.getSnapshot().phase, "ready");
  const key = `${PAUSE_PREFIX}${owner}:${quest}`;
  const run = controller.submit(true);
  while (!sends.length) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sends[0].keys, [key], "pending pause uses the existing per-quest key only");
  assert.equal(sends[0].operation.commandId, command);
  assert.equal(sends[0].operation.paused, true);
  release();
  assert.equal(await run, true);
  assert.equal(store.has(key), false, "accepted pause removes its pending key");

  // Unknown response keeps the exact command for retry through the SAME registry controller.
  let attempts = 0;
  const retryCommands = [];
  const retryStore = new Map();
  const retryRegistry = new RecurrencePauseRegistry(owner, () => ({
    storage: () => ({
      getItem: (key) => retryStore.has(key) ? retryStore.get(key) : null,
      setItem: (key, value) => retryStore.set(key, value),
      removeItem: (key) => retryStore.delete(key),
    }),
    lock: async (work) => work(),
    uuid: () => command,
    send: async ({ commandId }) => {
      attempts++;
      retryCommands.push(commandId);
      return attempts === 1
        ? { outcome: "unknown", error: "Connection lost." }
        : { outcome: "success" };
    },
  }));
  const retryController = retryRegistry.get(otherQuest);
  assert.equal(retryRegistry.get(otherQuest), retryController);
  await retryController.recover();
  assert.equal(await retryController.submit(false), false, "unknown response never claims success");
  assert.equal(retryController.getSnapshot().phase, "uncertain");
  assert.equal(await retryController.retry(), true, "exact retry reuses the saved command identity");
  assert.deepEqual(retryCommands, [command, command]);
  assert.equal(attempts, 2);
  assert.equal(retryStore.has(`${PAUSE_PREFIX}${owner}:${otherQuest}`), false);

  // Account-change semantics stay intact for every registered controller.
  registry.deactivate();
  assert.equal(controller.getSnapshot().phase, "blocked");
  assert.match(controller.getSnapshot().error, /Session changed/);
});

test("the manager submits draft.baseRevision and gates Save behind the conflict state", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const manager = read("../src/features/quests/recurring-series-manager.tsx");
  assert.match(manager, /persistSchedule\(defaults, draft\.baseRevision\)|persistSchedule\(defaults, effectiveDraft\.baseRevision\)/,
    "Save must send the revision the draft was loaded from");
  assert.doesNotMatch(manager, /persistSchedule\(defaults, rule\.revision\)/,
    "the newest authoritative revision must never be substituted at submit time");
  assert.match(manager, /schedule\.phase !== "ready" \|\| scheduleConflicted/, "a conflict disables Save");
  assert.match(manager, /id="series-schedule-conflict" role="alert"/, "the conflict is announced");
  assert.match(manager, /onClick=\{reloadAuthoritativeDraft\}/, "explicit reload recovery is offered");
  assert.doesNotMatch(manager, /persistSchedule\(defaults\)\)/, "every command carries an explicit revision");
  // Exact accepted-command recovery still replays the original pending operation.
  const pending = read("../src/features/quests/schedule-pending.ts");
  assert.match(pending, /const operation: ScheduleOperation = stored \?\? \{/);
  assert.match(pending, /if \(retry && !stored\) throw new Error\("Missing operation"\)/,
    "retry refuses to run without the stored operation, so it can never mint a new expected revision");
  assert.match(pending, /async retry\(\) \{ return this\.execute\(\); \}/,
    "retry replays the original pending command unchanged");
});

// Release blocker 3: a recurring definition row opens the SAME shared Quest-ID manager,
// so a series with zero materialized occurrences can still manage schedule defaults.
test("recurring definition rows expose the shared manager without a second implementation", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const controls = read("../src/features/quests/recurring-controls.tsx");
  assert.match(controls, /<RecurringSeriesManageButton questId=\{quest\.quest_id\} title=\{quest\.title\}/,
    "every active recurring definition row offers Manage series");
  assert.match(controls, /usePauseController\(quest\.quest_id\)/, "the existing shared pause controller is unchanged");
  assert.match(controls, /<RecurringRetirementControl questId=\{quest\.quest_id\}/, "direct archive control remains");
  assert.doesNotMatch(controls, /new RecurrencePauseLifecycle|new QuestManagementLifecycle|new ScheduleDefaultsLifecycle/,
    "definition rows never construct a second controller");
  assert.doesNotMatch(controls, /<dialog|SeriesModalContent/,
    "there is no second modal implementation in the definition row");

  const trigger = read("../src/features/quests/recurring-series-trigger.tsx");
  assert.match(trigger, /open\(\{ occurrenceId: null, questId, title \}, event\.currentTarget\)/,
    "the definition trigger passes questId, title and the opening focus target into the shared manager");
  assert.match(trigger, /useSeriesSelection\(\)/, "it consumes the same shared selection context");
  assert.equal((trigger.match(/<dialog/g) ?? []).length, 0, "no second dialog in the trigger module");
  assert.equal((trigger.match(/new ScheduleDefaultsLifecycle|new RecurrencePauseLifecycle|new QuestManagementLifecycle/g) ?? []).length, 0,
    "no second pause/retirement/schedule controller in the trigger module");
});

test("shared wiring: cards and modal consume one registry; one manager and one provider per Dashboard", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const controls = read("../src/features/quests/recurring-controls.tsx");
  assert.match(controls, /usePauseController\(quest\.quest_id\)/);
  assert.doesNotMatch(controls, /new RecurrencePauseLifecycle/);
  const content = read("../src/features/quests/recurring-series-manager.tsx");
  assert.match(content, /usePauseController\(questId\)/);
  assert.doesNotMatch(content, /new RecurrencePauseLifecycle/);
  const provider = read("../src/features/quests/recurrence-pause-provider.tsx");
  assert.match(provider, /PAUSE_LOCK/);
  assert.match(provider, /PAUSE_PREFIX\}\$\{userId\}:/);
  const page = read("../src/app/dashboard/page.tsx");
  assert.equal((page.match(/<RecurrencePauseProvider/g) ?? []).length, 1, "exactly one pause provider");
  assert.equal((page.match(/<RecurringSeriesManager/g) ?? []).length, 1, "exactly one series manager");
  const components = read("../src/features/quests/components.tsx");
  assert.match(components, /quest\.source_slot_date !== null && userId/);
  assert.match(components, /quest\.source_slot_date === null && userId/);
  const archived = read("../src/features/quests/archived-recurring-panel.tsx");
  assert.match(archived, /id="archived-recurring-quests"/);
  assert.match(archived, /tabIndex=\{-1\}/);
});

test("the manager renders children once and creates no dialog until a series is selected", () => {
  const html = renderToStaticMarkup(wrap(
    h(RecurringSeriesManager, { userId: owner, locale: "en" }, h("p", null, "daily-slot"))));
  assert.match(html, /daily-slot/);
  assert.doesNotMatch(html, /<dialog/, "no dialog exists until a recurring card selects a series");
});

function pauseHarness() {
  const store = new Map(), activity = [];
  const deps = {
    storage: () => {
      activity.push("storage");
      return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
    },
    lock: async (work) => { activity.push("lock"); return work(); },
    uuid: () => command,
    send: async () => { activity.push("send"); return { outcome: "success" }; },
  };
  return { store, activity, deps, registry: new RecurrencePauseRegistry(owner, () => deps) };
}

test("deactivated registry blocks unseen controllers, including saved-command recovery and retry", async () => {
  const h = pauseHarness();
  const bytes = JSON.stringify({ version: 1, userId: owner, questId: quest, commandId: command, paused: true });
  h.store.set(`${PAUSE_PREFIX}${owner}:${quest}`, bytes);
  h.registry.deactivate();
  const late = h.registry.get(quest);
  await late.recover();
  assert.equal(await late.submit(false), false);
  assert.equal(await late.retry(), false);
  await h.registry.recover();
  assert.deepEqual(h.activity, [], "not even storage or locking may run after account deactivation");
  assert.equal(late.getSnapshot().phase, "blocked");
  assert.equal(h.store.get(`${PAUSE_PREFIX}${owner}:${quest}`), bytes);
});

test("auth mismatch gates a delayed old-account controller until an explicit activation", async () => {
  const h = pauseHarness();
  assert.equal(h.registry.accountChanged(owner), false);
  h.registry.activate();
  assert.equal(h.registry.accountChanged(otherQuest), true);
  // The old account's streamed row arrives while router.refresh is still pending.
  const delayedRow = h.registry.get(otherQuest);
  await delayedRow.recover();
  await delayedRow.submit(true);
  await delayedRow.retry();
  assert.deepEqual(h.activity, []);
  assert.equal(h.registry.accountChanged(owner), false, "a callback never implicitly reactivates old controllers");
  await delayedRow.recover();
  assert.deepEqual(h.activity, []);
  h.registry.activate();
  await delayedRow.recover();
  assert.equal(delayedRow.getSnapshot().phase, "ready");
  const newRow = h.registry.get(quest);
  await newRow.recover();
  assert.equal(await newRow.submit(true), true);
  assert.equal(h.registry.accountChanged(undefined), true);
});

test("shared pause hydration snapshot stays initial while both consumers observe live recovery", async () => {
  const h = pauseHarness(), first = h.registry.get(quest), initial = getPauseServerSnapshot();
  h.store.set(`${PAUSE_PREFIX}${owner}:${quest}`, JSON.stringify({ version: 1, userId: owner, questId: quest, commandId: command, paused: true }));
  await first.recover();
  const second = h.registry.get(quest);
  assert.equal(first, second);
  assert.equal(getPauseServerSnapshot(), initial);
  assert.equal(initial.phase, "recovering");
  assert.equal(initial.version, 0);
  assert.equal(second.getSnapshot().phase, "uncertain");
  assert(second.getSnapshot().version > initial.version);
  let notifications = 0;
  const unsubscribe = second.subscribe(() => notifications++);
  await first.retry();
  assert.equal(second.getSnapshot().phase, "ready");
  assert(notifications > 0);
  unsubscribe();
  const before = notifications;
  await first.recover();
  assert.equal(notifications, before);
  assert.equal(getPauseServerSnapshot(), initial);
});

test("pause reconciliation invalidates details before the lock and publishes one settled version", async () => {
  const h = pauseHarness(), c = h.registry.get(quest);
  await c.recover();
  const oldVersion = c.getSnapshot().version;
  let release;
  h.deps.lock = (work) => new Promise((resolve) => { release = () => resolve(work()); });
  const work = c.recover();
  assert.equal(c.getSnapshot().phase, "recovering");
  assert(c.getSnapshot().version > oldVersion);
  const inFlightVersion = c.getSnapshot().version;
  await c.recover();
  assert.equal(c.getSnapshot().version, inFlightVersion, "duplicate recovery does not cause reload loops");
  release(); await work;
  assert.equal(c.getSnapshot().phase, "ready");
  assert(c.getSnapshot().version > inFlightVersion);
});

const archiveResult = { outcome: "success", operation: "archive", replay: false };
for (const [name, result, target, id, atOpen, closes] of [
  ["fresh selected archive", archiveResult, quest, command, undefined, true],
  ["previous success", archiveResult, quest, command, command, false],
  ["recreated previous success", { ...archiveResult }, quest, command, command, false],
  ["archive replay", { ...archiveResult, replay: true }, quest, command, undefined, false],
  ["restore success", { ...archiveResult, operation: "restore" }, quest, command, undefined, false],
  ["delete success", { ...archiveResult, operation: "delete" }, quest, command, undefined, false],
  ["unknown", { outcome: "unknown", operation: "archive" }, quest, command, undefined, false],
  ["rejected", { outcome: "rejected", operation: "archive", reason: "stale" }, quest, command, undefined, false],
  ["another quest", archiveResult, otherQuest, command, undefined, false],
  ["no command identity", archiveResult, quest, undefined, undefined, false],
]) test(`archive auto-close: ${name}`, () => {
  assert.equal(isFreshSeriesArchive({ phase: "ready", questId: target, result, resultCommandId: id }, quest, atOpen), closes);
});

test("retirement result retains the submitted command identity across recovery and copied results", async () => {
  const h = pauseHarness();
  const c = new QuestManagementLifecycle(owner, { ...h.deps, send: async () => ({ ...archiveResult }) }, RECURRING_RETIREMENT_PREFIX);
  await c.recover();
  await c.submit(quest, "archive", title);
  const result = c.getSnapshot();
  assert.equal(result.pending, undefined);
  assert.equal(result.resultCommandId, command);
  await c.recover();
  assert.equal(c.getSnapshot().resultCommandId, command);
  assert.equal(isFreshSeriesArchive({ ...c.getSnapshot(), result: { ...result.result } }, quest, command), false);
});

function scheduleRegistryHarness() {
  const store = new Map();
  const activity = [];
  const sends = [];

  const storage = {
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };

  const deps = {
    storage: () => {
      activity.push("storage");
      return storage;
    },
    lock: async (work) => {
      activity.push("lock");
      return work();
    },
    uuid: () => command,
    send: async (operation) => {
      sends.push(operation);
      return { outcome: "success" };
    },
  };

  return {
    store,
    activity,
    sends,
    registry: new ScheduleDefaultsRegistry(owner, () => deps),
  };
}

function savedScheduleOperation(questId = quest) {
  return {
    version: 1,
    userId: owner,
    questId,
    commandId: command,
    expectedRevision: 3,
    defaults: {
      local_start_time: "08:00",
      local_end_time: "09:30",
      planned_end_day_offset: 0,
    },
  };
}

test("schedule registry discovers durable recovery before the modal opens", async () => {
  assert.equal(SCHEDULE_PREFIX, "system.quest-schedule.pending.v1:");
  assert.equal(SCHEDULE_LOCK, "system.quest-schedule");

  const h = scheduleRegistryHarness();
  const key = `${SCHEDULE_PREFIX}${owner}:${quest}`;
  const operation = savedScheduleOperation();

  // No modal/row has asked for a controller yet.
  h.store.set(key, JSON.stringify(operation));
  assert.equal(h.registry.recoveryEntries().length, 0);

  await h.registry.recover();

  const entries = h.registry.recoveryEntries();
  assert.equal(entries.length, 1, "account recovery discovers the saved quest");
  assert.equal(entries[0].questId, quest);
  assert.equal(entries[0].view.phase, "uncertain");
  assert.deepEqual(entries[0].view.operation, operation);
  assert.equal(h.sends.length, 0, "discovery never dispatches the uncertain command");

  // Opening the modal later consumes exactly the already-owned controller.
  assert.equal(
    h.registry.get(quest),
    entries[0].controller,
    "one account-scoped schedule controller exists per questId",
  );
  assert.notEqual(h.registry.get(otherQuest), entries[0].controller);

  // Recovery remains actionable without needing the originating modal.
  assert.equal(
    await entries[0].controller.retry(),
    true,
    "the global recovery entry can replay the exact durable command",
  );
  assert.equal(h.sends.length, 1);
  assert.deepEqual(h.sends[0], operation);
  assert.equal(h.store.has(key), false, "settled recovery removes the durable command");
});

test("schedule registry account mismatch blocks discovery and delayed controllers", async () => {
  const h = scheduleRegistryHarness();
  const key = `${SCHEDULE_PREFIX}${owner}:${quest}`;
  const bytes = JSON.stringify(savedScheduleOperation());

  h.store.set(key, bytes);

  assert.equal(h.registry.accountChanged(owner), false);
  assert.equal(h.registry.accountChanged(otherQuest), true);

  await h.registry.recover();

  assert.deepEqual(
    h.activity,
    [],
    "an inactive old-account registry must not scan storage, acquire locks or dispatch",
  );
  assert.equal(h.store.get(key), bytes);

  const late = h.registry.get(quest);
  assert.equal(late.getSnapshot().phase, "blocked");

  await late.recover();
  assert.equal(await late.retry(), false);

  assert.deepEqual(
    h.activity,
    [],
    "controllers created after account mismatch remain inactive",
  );
  assert.equal(h.store.get(key), bytes, "old-account recovery bytes are preserved");

  h.registry.activate();
  await h.registry.recover();

  assert.equal(
    h.registry.get(quest).getSnapshot().phase,
    "uncertain",
    "only explicit activation permits recovery again",
  );
});

test("schedule recovery wiring is account-scoped and Dashboard-owned", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

  const manager = read("../src/features/quests/recurring-series-manager.tsx");
  assert.match(manager, /useScheduleController\(questId\)/);
  assert.doesNotMatch(
    manager,
    /new ScheduleDefaultsLifecycle/,
    "the modal must not own a private schedule lifecycle",
  );

  const provider = read("../src/features/quests/schedule-provider.tsx");
  assert.match(provider, /SCHEDULE_PREFIX/);
  assert.match(provider, /SCHEDULE_LOCK/);
  assert.match(provider, /discoverStoredQuestIds/);
  assert.match(provider, /recoveryEntries/);

  const page = read("../src/app/dashboard/page.tsx");

  assert.equal(
    (page.match(/<ScheduleDefaultsProvider/g) ?? []).length,
    1,
    "exactly one account-scoped schedule provider is mounted",
  );

  assert.equal(
    (page.match(/<RecurringSeriesManager/g) ?? []).length,
    1,
    "the shared series manager remains singular",
  );
});

test("recovered schedule settlement keeps exact command identity", async () => {
  const h = scheduleRegistryHarness();
  const key = `${SCHEDULE_PREFIX}${owner}:${quest}`;
  const operation = savedScheduleOperation();

  h.store.set(key, JSON.stringify(operation));

  await h.registry.recover();

  const controller = h.registry.get(quest);

  assert.equal(controller.getSnapshot().phase, "uncertain");
  assert.equal(controller.getSnapshot().settlement, undefined);

  assert.equal(await controller.retry(), true);

  assert.deepEqual(
    controller.getSnapshot().settlement,
    {
      commandId: command,
      outcome: "success",
    },
    "a recovered success identifies the exact durable command it settled",
  );

  assert.equal(h.store.has(key), false);

  // A later account-level reconciliation must not erase the ephemeral proof
  // before an open modal has had a chance to settle its local draft.
  await controller.recover();

  assert.deepEqual(controller.getSnapshot().settlement, {
    commandId: command,
    outcome: "success",
  });
});

test("modal draft settlement is bound to the exact recovered command", () => {
  const manager = readFileSync(
    new URL("../src/features/quests/recurring-series-manager.tsx", import.meta.url),
    "utf8",
  );

  assert.match(manager, /pendingScheduleCommandId/);

  assert.match(
    manager,
    /snapshot\.operation\?\.commandId \?\? snapshot\.settlement\?\.commandId/,
    "submit reports either the unresolved command or the exact settled command",
  );

  assert.match(
    manager,
    /scheduleSettlement\.commandId !== pendingScheduleCommandId/,
    "an unrelated settlement must never discard the local draft",
  );

  assert.match(
    manager,
    /scheduleSettlement\.outcome === "success"/,
    "the matching recovered success settles the draft",
  );

  assert.match(
    manager,
    /setPendingScheduleCommandId\(outcome\.commandId\)/,
    "an unknown save binds its draft to the durable command identity",
  );
});

test("fresh recurring lifecycle actions are gated by unresolved schedule recovery", () => {
  const read = (path) =>
    readFileSync(new URL(path, import.meta.url), "utf8");

  const rows = read("../src/features/quests/recurring-controls.tsx");

  assert.match(
    rows,
    /useScheduleController\(quest\.quest_id\)/,
    "definition rows consume the account-scoped schedule controller",
  );

  assert.match(
    rows,
    /if \(!retry && schedule\.phase !== "ready"\) return;/,
    "fresh row Pause is blocked while schedule recovery is unresolved",
  );

  assert.match(
    rows,
    /retirement\.state\.phase !== "ready" \|\| schedule\.phase !== "ready"/,
    "fresh row Pause is disabled while schedule recovery is unresolved",
  );

  const manager = read("../src/features/quests/recurring-series-manager.tsx");

  assert.match(
    manager,
    /!retry && \(loading \|\| schedule\.phase !== "ready"/,
    "fresh modal Pause is guarded by schedule readiness",
  );

  assert.match(
    manager,
    /retirement\.state\.phase !== "ready" \|\| schedule\.phase !== "ready"/,
    "fresh modal Pause is disabled by unresolved schedule recovery",
  );
});

test("archive restore and delete are gated centrally by schedule recovery", () => {
  const control = readFileSync(
    new URL("../src/features/quests/recurring-retirement-control.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    control,
    /useScheduleController\(questId\)/,
    "retirement control observes the same per-series schedule lifecycle",
  );

  assert.match(
    control,
    /const locked = .*schedule\.phase !== "ready";/,
    "fresh Archive, Restore and Delete stay locked until schedule recovery settles",
  );

  assert.match(
    control,
    /scheduleController\.recover\(\)/,
    "archived rows can hydrate schedule state even without opening the series modal",
  );
});

test("materialization notices use authoritative titles and mark next-day intervals", () => {
  const components = readFileSync(
    new URL("../src/features/quests/components.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    components,
    /quest_id\.slice/,
    "materialization notices never expose shortened Quest IDs",
  );

  assert.ok(
    components.includes("seriesTitles?.[issue.quest_id]"),
    "the notice resolves the recurring title by Quest ID",
  );

  assert.ok(
    components.includes("issue.planned_end_day_offset === 1"),
    "next-day timing participates in notice rendering",
  );

  assert.ok(
    components.includes("sd.nextDay"),
    "notice reuses localized next-day copy",
  );

  assert.ok(
    components.includes("title={title}"),
    "Manage series receives the resolved title",
  );

  const dailyPanel = readFileSync(
    new URL("../src/features/quests/panel.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(
    dailyPanel.includes(
      'result.status === "ok" && result.issues?.length'
    ),
    "title lookup occurs only for successful reads with issues",
  );

  assert.ok(
    dailyPanel.includes("readRecurringQuests(userId)"),
    "Daily notices consume the shared recurring read",
  );

  const recurringPanel = readFileSync(
    new URL("../src/features/quests/recurring-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(
    recurringPanel.includes("readRecurringQuests(userId)"),
    "Recurring panel consumes the same read",
  );

  const sharedRead = readFileSync(
    new URL("../src/features/quests/recurring-read.ts", import.meta.url),
    "utf8",
  );

  assert.ok(sharedRead.includes("cache("));
  assert.ok(sharedRead.includes("list_recurring_quests"));
  assert.ok(sharedRead.includes("parseRecurringQuests(data)"));
});

test("new UI punctuation remains encoding-safe", () => {
  const components = readFileSync(
    new URL("../src/features/quests/components.tsx", import.meta.url),
    "utf8",
  );

  const form = readFileSync(
    new URL("../src/features/quests/create-form.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(
    components.includes("\\u2013"),
    "materialization interval uses an encoding-safe en-dash escape",
  );

  assert.ok(
    components.includes("\\u00b7"),
    "materialization metadata uses an encoding-safe middle-dot escape",
  );

  assert.doesNotMatch(
    components,
    /\$\{start\}\?\$\{end\}/,
    "materialization interval must never degrade to a question mark",
  );

  assert.ok(
    form.includes("\\u00b7"),
    "creation success metadata uses an encoding-safe middle-dot escape",
  );

  assert.ok(
    !form.includes('.join(" ? ")'),
    "creation success separator must never degrade to a question mark",
  );
});
