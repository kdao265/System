import "./helpers/ui-loader.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

const mockUrl = `data:text/javascript,${encodeURIComponent(`
  export let getGoals, getGoal;
  export function configure(list, detail) { getGoals = list; getGoal = detail; }
  export function QuestCompletionControl() { return null; }
  export function QuestReopenControl() { return null; }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/goals/data" || (specifier === "./completion-control" && context.parentURL?.endsWith("/quests/components.tsx"))) return { url: mockUrl, shortCircuit: true };
    return next(specifier, context);
  },
});
const { configure } = await import(mockUrl);
const { getDashboardMainQuest } = await import("../src/features/dashboard/data.ts");
const { MainQuestHero, LevelSnapshot, CalendarSnapshot } = await import("../src/features/dashboard/components.tsx");
const { calendarSnapshot, snapshotEnd } = await import("../src/features/dashboard/model.ts");
const { DailyQuestList } = await import("../src/features/quests/components.tsx");
hooks.deregister();

const goal = { id: "00000000-0000-4000-8000-000000000001", title: "A meaningful direction", description: "One step at a time",
  display_state: "active", total_subquests: "3", completed_subquests: "1" };
const detail = { goal, subquests: [
  { link_id: "a", title: "Read a chapter", status: "completed" },
  { link_id: "b", title: "Practice", status: "scheduled" },
  { link_id: "c", title: "Review", status: "draft" },
] };

test("Main Quest selects first active UUID across pages and uses the current detail read", async () => {
  const calls = [];
  configure(async (scope, after) => {
    calls.push([scope, after]);
    return after ? { goals: [goal, { ...goal, id: "later" }], next_after_id: null }
      : { goals: [{ ...goal, display_state: "completed" }], next_after_id: "cursor" };
  }, async (id) => { assert.equal(id, goal.id); return detail; });
  assert.deepEqual(await getDashboardMainQuest(), { status: "ok", detail });
  assert.deepEqual(calls, [["unarchived", null], ["unarchived", "cursor"]]);
});

test("Main Quest distinguishes empty, failed reads and changes between list and detail", async () => {
  configure(async () => ({ goals: [], next_after_id: null }), () => assert.fail("no detail for empty"));
  assert.deepEqual(await getDashboardMainQuest(), { status: "empty" });
  configure(async () => null);
  assert.deepEqual(await getDashboardMainQuest(), { status: "unavailable" });
  for (const changed of [null, { ...detail, goal: { ...goal, display_state: "archived" } }, { ...detail, goal: { ...goal, display_state: "completed" } }]) {
    configure(async () => ({ goals: [goal], next_after_id: null }), async () => changed);
    assert.deepEqual(await getDashboardMainQuest(), { status: "unavailable" });
  }
});

test("Main Quest presents live counts, domain percentage, linked titles and real navigation in both languages", () => {
  for (const locale of ["vi", "en"]) {
    const html = render(h(MainQuestHero, { result: { status: "ok", detail }, locale }));
    assert.match(html, /1 \/ 3 Sub Quest/);
    assert.match(html, /aria-valuenow="33.3"/);
    assert.match(html, /Read a chapter/);
    assert.match(html, new RegExp(`href="/goals\\?id=${goal.id}"`));
    assert.match(html, locale === "vi" ? /Mở Main Quest/ : /Open Main Quest/);
    const empty = render(h(MainQuestHero, { result: { status: "empty" }, locale }));
    assert.match(empty, /href="\/goals"/);
    assert.doesNotMatch(empty, /role="progressbar"/);
    assert.match(empty, locale === "vi" ? /Định hướng/ : /Give your next chapter/);
    const failed = render(h(MainQuestHero, { result: { status: "unavailable" }, locale }));
    assert.match(failed, /role="alert"/); assert.doesNotMatch(failed, /A meaningful direction/);
  }
});

test("Level preserves exact EXP, existing percentage, zero, unavailable and published cap", () => {
  const exp = { state: "available", currentLevel: 9, currentExpText: "90071992547409930001", highestLevel: 12,
    nextLevel: 10, expToNextText: "500", percentInLevel: 42 };
  for (const locale of ["vi", "en"]) {
    const html = render(h(LevelSnapshot, { result: { status: "ok", exp }, selectedDate: "2026-10-01", locale }));
    assert.match(html, /90071992547409930001 EXP/); assert.match(html, /aria-valuenow="42"/);
    assert.match(html, /500/); assert.match(html, /12/);
    assert.match(html, locale === "vi" ? /EXP hiện tại/ : /Current EXP/);
  }
  const maximum = render(h(LevelSnapshot, { result: { status: "ok", exp: { ...exp, nextLevel: null, expToNextText: null, percentInLevel: null } }, locale: "en", selectedDate: "2026-10-01" }));
  assert.match(maximum, /MAX LEVEL/); assert.doesNotMatch(maximum, /EXP to Level/);
  for (const state of ["unavailable", "invalid"]) {
    const html = render(h(LevelSnapshot, { result: { status: "ok", exp: { state } }, locale: "vi", selectedDate: "2026-10-01" }));
    assert.doesNotMatch(html, /role="progressbar"|dashboard-level-ring/);
  }
  const failed = render(h(LevelSnapshot, { result: { status: "unavailable" }, locale: "en", selectedDate: "2026-10-01" }));
  assert.match(failed, /href="\/dashboard\?date=2026-10-01"/);
  const zero = render(h(LevelSnapshot, { result: { status: "ok", exp: { ...exp, currentExpText: "0", percentInLevel: 0 } }, locale: "en", selectedDate: "2026-10-01" }));
  assert.match(zero, /0 EXP/); assert.match(zero, /aria-valuenow="0"/);
});

const event = { source: "schedule_event", entry_id: "event", title: "Planning session", all_day: false,
  start_at: "2026-10-01T18:00:00Z", end_at: "2026-10-01T19:00:00Z", start_date: null, end_date: null, source_slot_date: null };

test("Calendar snapshot reuses timezone membership, deduplicates spanning events and limits the preview", () => {
  const allDay = { ...event, entry_id: "all", all_day: true, start_at: null, end_at: null, start_date: "2026-09-30", end_date: "2026-10-04" };
  const entries = [allDay, event, ...[2, 3, 4].map((n) => ({ ...event, entry_id: String(n) }))];
  const items = calendarSnapshot(entries, "2026-10-01", "Asia/Ho_Chi_Minh");
  assert.equal(items.length, 3);
  assert.equal(items[0].day, "2026-10-01");
  assert.equal(items[1].day, "2026-10-02");
  assert.equal(items.filter(({ entry }) => entry.entry_id === "all").length, 1);
  assert.equal(snapshotEnd("9999-12-30"), "9999-12-31");
  assert.deepEqual(calendarSnapshot([event], "2026-10-03", "UTC"), []);
});

test("Calendar renders real day navigation, all-day/untimed labels and distinct empty/error states", () => {
  const untimed = { ...event, source: "quest_occurrence", start_at: null, end_at: null, source_slot_date: "2026-10-01" };
  for (const locale of ["vi", "en"]) {
    const props = { day: "2026-10-01", timezone: "UTC", locale };
    const html = render(h(CalendarSnapshot, { ...props, entries: [untimed] }));
    assert.match(html, /Planning session/);
    assert.match(html, /href="\/calendar\?view=day&amp;date=2026-10-01"/);
    assert.match(html, locale === "vi" ? /Chưa đặt giờ/ : /No set time/);
    assert.doesNotMatch(render(h(CalendarSnapshot, { ...props, entries: [] })), /role="alert"/);
    assert.match(render(h(CalendarSnapshot, { ...props, entries: null })), /role="alert"/);
  }
});

test("Daily Quest presentation localizes status, counts, reward and empty state without inferring readiness", () => {
  const quests = ["completed", "scheduled", "failed"].map((status, i) => ({
    occurrence_id: String(i), quest_title: "Real Quest " + i, status, source_slot_date: null,
    scheduled_at: null, deadline_at: null, reward_exp_snapshot: i === 0 ? 0 : null,
    progression_ready: false, completable: false,
  }));
  for (const locale of ["vi", "en"]) {
    const props = { timezone: "UTC", selectedDate: "2026-10-01", locale };
    const html = render(h(DailyQuestList, { ...props, result: { status: "ok", quests } }));
    assert.match(html, /0 EXP/); assert.match(html, /data-completed="true"/);
    assert.match(html, locale === "vi" ? /Đã hoàn thành: 1/ : /Completed: 1/);
    assert.match(html, locale === "vi" ? /Chưa hoàn thành: 2/ : /Not completed: 2/);
    assert.match(html, locale === "vi" ? /Chưa đặt/ : /Not set/);
    assert.match(render(h(DailyQuestList, { ...props, result: { status: "ok", quests: [] } })), locale === "vi" ? /Không có Quest/ : /No Quests/);
  }
});
