import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../src/", import.meta.url);
const mockUrl = `data:text/javascript,${encodeURIComponent(`
  export let response = {data: null, error: null}, calls = [], timezone = 'UTC', allowed = true;
  export function configure(next, zone = 'UTC', auth = true) { response = next; timezone = zone; allowed = auth; calls = []; }
  export async function getProfileContext() { if (!allowed) throw new Error('auth-gate'); return {user: {id: '11111111-1111-4111-8111-111111111111'}, profile: {timezone}}; }
  export function isOnboardingComplete(p) { return !!p?.timezone; }
  export async function requireUser() { if (!allowed) throw new Error('auth-gate'); }
  export async function createServerSupabaseClient() { return {rpc: async (...args) => { calls.push(args); if (response instanceof Error) throw response; return response; }}; }
  export function revalidatePath() {}
  export function unstable_rethrow() {}
`)}`;
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(root.href)) {
    if (["@/features/profile/session", "@/features/auth/session", "@/lib/supabase/server", "next/cache", "next/navigation"].includes(specifier)) return { url: mockUrl, shortCircuit: true };
    if (specifier.startsWith("@/") || specifier.startsWith("./")) {
      const url = new URL((specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, context.parentURL)).href + ".ts");
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
  }
  return next(specifier, context);
} });
const { eventArguments, parseCalendar, entriesForDay, entryDraft, calendarWeek } = await import("../src/features/calendar/model.ts");
const { saveScheduleEvent } = await import("../src/features/calendar/actions.ts");
const { getCalendar } = await import("../src/features/calendar/data.ts");
const { calendarMonth, calendarView, weekdayLabel, shiftPeriod, viewWindow, daySummaries, monthCells, profileDayMinutes, timelineSpan, timelineLanes, TIMELINE_HEIGHT } = await import("../src/features/calendar/view.ts");
const mocks = await import(mockUrl);
const id = "11111111-1111-4111-8111-111111111111";
const draft = { title: " Appointment ", start: "2026-09-20T00:30", end: "2026-09-20T01:30", allDay: false, category: " class ", notes: "note" };
const entry = { source: "schedule_event", entry_id: id, quest_id: null, title: "Appointment", status: null, start_at: "2026-09-19T15:30:00Z", end_at: "2026-09-19T16:30:00Z", all_day: false, start_date: null, end_date: null, category: null, notes: null, source_slot_date: null, occurrence_id: null, execution_cycle: null, reward_exp_snapshot: null, deadline_at: null };

test("Month navigation uses adjacent months, clamps dates and respects calendar limits", () => {
  for (const [day, amount, expected] of [
    ["2026-01-31", 1, "2026-02-28"],
    ["2024-03-31", -1, "2024-02-29"],
    ["2026-12-31", 1, "2027-01-31"],
    ["2026-01-15", -1, "2025-12-15"],
    ["0004-01-31", 1, "0004-02-29"],
    ["0001-01-01", -1, null],
    ["9999-12-31", 1, null],
  ]) assert.equal(shiftPeriod("month", day, amount), expected);
  const grid = calendarMonth("2026-09-19");
  assert.equal(grid.days[0], "2026-08-31");
  assert.equal(grid.days.at(-1), "2026-10-04");
  assert.deepEqual(viewWindow("month", "2026-09-19"), { from: "2026-08-31", to: "2026-10-04" });
  assert.ok(calendarMonth("0004-02-15").days.includes("0004-02-29"));
});

test("Month windows cover complete Monday-first weeks across short, leap and six-row months", () => {
  for (const [day, first, last, rows] of [
    ["2021-02-14", "2021-02-01", "2021-02-28", 4],
    ["2024-02-29", "2024-01-29", "2024-03-03", 5],
    ["2026-03-15", "2026-02-23", "2026-04-05", 6],
    ["2026-12-31", "2026-11-30", "2027-01-03", 5],
  ]) {
    const grid = calendarMonth(day);
    assert.equal(grid.days[0], first);
    assert.equal(grid.days.at(-1), last);
    assert.equal(grid.weeks.length, rows);
    assert.equal(new Set(grid.days).size, rows * 7);
    assert.deepEqual(viewWindow("month", day), { from: first, to: last });
    for (const week of grid.weeks) {
      assert.deepEqual(week.map(weekdayLabel), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
      assert.deepEqual(calendarWeek(week[6]), week);
      assert.deepEqual(calendarWeek(week[0]), week);
    }
  }
  assert.equal(viewWindow("month", "0001-01-01").from, "0001-01-01");
  assert.equal(viewWindow("month", "9999-12-31").to, "9999-12-31");
  assert.deepEqual(viewWindow("day", "2026-09-20"), { from: "2026-09-20", to: "2026-09-20" });
  assert.deepEqual(viewWindow("week", "2026-09-20"), { from: "2026-09-14", to: "2026-09-20" });
  for (const value of [undefined, "unknown", ["month"]]) assert.equal(calendarView(value), "week");
  for (const value of ["day", "week", "month"]) assert.equal(calendarView(value), value);
});

test("Month shifts preserve each day when possible in both directions, without fixed-day jumps", () => {
  for (const day of ["01", "15", "28"]) {
    assert.equal(shiftPeriod("month", `2026-03-${day}`, -1), `2026-02-${day}`);
    assert.equal(shiftPeriod("month", `2026-03-${day}`, 1), `2026-04-${day}`);
  }
  assert.equal(shiftPeriod("month", "2026-05-31", -1), "2026-04-30");
  assert.equal(shiftPeriod("month", "2026-05-31", 1), "2026-06-30");
  assert.equal(shiftPeriod("month", "1900-01-31", 1), "1900-02-28");
  assert.equal(shiftPeriod("month", "2000-01-31", 1), "2000-02-29");
  assert.equal(shiftPeriod("week", "2026-03-01", -1), "2026-02-22");
  assert.equal(shiftPeriod("day", "2026-03-01", -1), "2026-02-28");
});

test("Month chip budgets retain hidden counts and the full selected-day agenda", () => {
  const grid = calendarMonth("2026-09-19");
  const entries = Array.from({ length: 10 }, (_, index) => ({ ...entry, entry_id: `${index}` }));
  const summaries = daySummaries(entries, grid.days, "UTC");
  const cell = monthCells(grid, summaries).flat().find((cell) => cell.day === "2026-09-19");
  assert.equal(cell.chips.length, 3);
  assert.equal(cell.more, 7);
  assert.equal(cell.dots.length, 4);
  assert.equal(cell.dotMore, 6);
  assert.equal(summaries[cell.day].items.length, 10);
  assert.equal(entriesForDay(entries, "2026-09-20", "UTC").length, 0);
});

test("timeline clock parsing shares Profile timezone and padded calendar dates", () => {
  assert.deepEqual(profileDayMinutes("2026-09-19T18:30:00Z", "Asia/Ho_Chi_Minh"), { day: "2026-09-20", minutes: 90 });
  assert.deepEqual(profileDayMinutes("0004-02-29T09:15:00Z", "UTC"), { day: "0004-02-29", minutes: 555 });
  assert.deepEqual(profileDayMinutes("2026-11-01T05:30:00Z", "America/New_York"), { day: "2026-11-01", minutes: 90 });
  assert.deepEqual(profileDayMinutes("2026-11-01T06:30:00Z", "America/New_York"), { day: "2026-11-01", minutes: 90 });
});

test("Month cells budget busy rows without losing order, identities or overflow counts", () => {
  const grid = calendarMonth("2026-09-19");
  const busyWeek = grid.weeks[2];
  const entries = busyWeek.flatMap((day) => Array.from({ length: 6 }, (_, index) => ({
    ...entry, entry_id: `${day}:${index}`, start_at: `${day}T${String(8 + index).padStart(2, "0")}:00:00Z`, end_at: null,
  })));
  const cells = monthCells(grid, daySummaries(entries, grid.days, "UTC"));
  assert.equal(cells[2].reduce((sum, cell) => sum + cell.chips.length, 0), 7);
  for (const cell of cells[2]) {
    assert.equal(cell.chips.length, 1);
    assert.equal(cell.more, 5);
    assert.equal(cell.dots.length, 4);
    assert.equal(cell.dotMore, 2);
    assert.equal(cell.chips[0].entry_id, `${cell.day}:0`);
    assert.deepEqual(cell.dots.map((item) => item.entry_id), [0, 1, 2, 3].map((index) => `${cell.day}:${index}`));
  }
  const empty = cells.flat().find((cell) => cell.day === "2026-08-31");
  assert.deepEqual(empty, { day: "2026-08-31", outside: true, chips: [], more: 0, dots: [], dotMore: 0 });
  assert.equal(cells.flat().find((cell) => cell.day === "2026-09-01").outside, false);
  assert.equal(entries.length, 42);
});

test("timeline spans place timed events and Quests in Profile-local columns", () => {
  const days = ["2026-09-19", "2026-09-20"];
  const timed = { ...entry, start_at: "2026-09-20T02:00:00Z", end_at: "2026-09-20T03:30:00Z" };
  assert.deepEqual(timelineSpan(timed, days, "Asia/Ho_Chi_Minh"), { column: 1, top: 396, height: 66, starts: true });
  assert.deepEqual(timelineSpan({ ...timed, source: "quest_occurrence" }, days, "Asia/Ho_Chi_Minh"), { column: 1, top: 396, height: 66, starts: true });
  assert.equal(timelineSpan({ ...timed, all_day: true }, days, "UTC"), null);
  assert.equal(timelineSpan({ ...timed, start_at: null, source_slot_date: days[0] }, days, "UTC"), null);
  assert.equal(timelineSpan(timed, ["2026-09-21"], "UTC"), null);
  assert.deepEqual(timelineSpan({ ...timed, start_at: "2026-09-20T09:00:00Z", end_at: null }, days, "UTC"), { column: 1, top: 396, height: 0, starts: true });
});

test("timeline spans clip at working hours and midnight and retain timed continuations", () => {
  const span = (start, end, day = "2026-09-20") => timelineSpan({ ...entry, start_at: start, end_at: end }, [day], "UTC");
  assert.deepEqual(span("2026-09-20T01:00:00Z", "2026-09-20T02:00:00Z"), { column: 0, top: 44, height: 44, starts: true });
  assert.deepEqual(span("2026-09-20T05:30:00Z", "2026-09-20T07:00:00Z"), { column: 0, top: 242, height: 66, starts: true });
  const late = span("2026-09-20T23:55:00Z", "2026-09-21T01:00:00Z");
  assert.equal(late.top + late.height, TIMELINE_HEIGHT);
  assert.deepEqual(span("2026-09-19T23:30:00Z", "2026-09-20T09:00:00Z"), { column: 0, top: 0, height: 396, starts: false });
  assert.equal(span("2026-09-19T23:30:00Z", "2026-09-20T00:00:00Z"), null);
  assert.deepEqual(timelineSpan({ ...entry, source: "quest_occurrence", start_at: "2026-09-19T23:30:00Z", end_at: "2026-09-20T09:00:00Z" }, ["2026-09-20"], "UTC"), { column: 0, top: 0, height: 396, starts: false });
});

test("timeline lanes reuse touching intervals and separate overlapping clusters", () => {
  assert.deepEqual(timelineLanes([]), { lanes: [], count: 1 });
  assert.deepEqual(timelineLanes([{ top: 0, height: 44 }, { top: 44, height: 44 }]), { lanes: [0, 0], count: 1 });
  const spans = [{ top: 0, height: 100 }, { top: 0, height: 20 }, { top: 10, height: 30 }, { top: 20, height: 10 }, { top: 100, height: 44 }];
  const result = timelineLanes(spans);
  assert.deepEqual(result, { lanes: [0, 1, 2, 1, 0], count: 3 });
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    if (spans[i].top + spans[i].height > spans[j].top) assert.notEqual(result.lanes[i], result.lanes[j]);
  }
});

test("Calendar uses Profile timezone, validates time ordering and rejects DST gaps/folds", () => {
  const result = eventArguments(draft, "Asia/Tokyo", id);
  assert.equal(result.args.p_start_at, "2026-09-19T15:30:00.000Z");
  assert.equal(result.args.p_title, "Appointment");
  assert.equal(result.args.p_category, "class");
  for (const value of ["2026-03-08T02:30", "2026-11-01T01:30", "2026-02-30T12:00"]) {
    assert.ok(eventArguments({ ...draft, start: value, end: "" }, "America/New_York", id).error);
  }
  assert.ok(eventArguments({ ...draft, end: draft.start }, "UTC", id).error);
  assert.ok(eventArguments({ ...draft, title: " " }, "UTC", id).error);
  assert.ok(eventArguments({ ...draft, start: "2026-01-01T12:00", end: "2027-01-02T12:00" }, "UTC", id).args);
  assert.ok(eventArguments({ ...draft, start: "2026-01-01T12:00", end: "2027-01-03T12:00" }, "UTC", id).error);
});
test("all-day forms retain dates, inclusive last day, and no fabricated times", () => {
  const allDay = { ...entry, all_day: true, start_at: null, end_at: null, start_date: "2026-09-20", end_date: "2026-09-22" };
  assert.ok(parseCalendar([allDay]));
  for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
    assert.equal(entriesForDay([allDay], "2026-09-20", zone).length, 1);
    assert.equal(entriesForDay([allDay], "2026-09-22", zone).length, 0);
    assert.equal(entryDraft(allDay, zone).start, "2026-09-20");
    assert.equal(entryDraft(allDay, zone).end, "2026-09-21");
  }
  assert.ok(eventArguments({ ...draft, allDay: true, start: "2026-09-20", end: "2026-09-20" }, "UTC", id).args);
  assert.ok(eventArguments({ ...draft, allDay: true, start: "2026-09-20", end: "2026-09-19" }, "UTC", id).error);
  assert.ok(eventArguments({ ...draft, allDay: true, start: "2026-03-08", end: "2027-03-08" }, "America/New_York", id).args);
});
test("day slicing respects exclusive ends, no-end events and untimed recurring slots", () => {
  assert.equal(entriesForDay([entry], "2026-09-20", "Asia/Tokyo").length, 1);
  assert.equal(entriesForDay([{ ...entry, end_at: null }], "2026-09-21", "Asia/Tokyo").length, 0);
  const spanning = { ...entry, start_at: "2026-09-20T23:30:00Z", end_at: "2026-09-22T00:00:00Z" };
  assert.equal(entriesForDay([spanning], "2026-09-21", "UTC").length, 1);
  assert.equal(entriesForDay([spanning], "2026-09-22", "UTC").length, 0);
  const recurring = { ...entry, source: "quest_occurrence", source_slot_date: "2026-09-20", start_at: null, end_at: null };
  assert.ok(parseCalendar([recurring]));
  assert.equal(entriesForDay([recurring], "2026-09-20", "America/New_York").length, 1);
  assert.equal(parseCalendar([{ ...entry, start_at: "invalid" }]), null);
  assert.deepEqual(calendarWeek("2026-09-20"), ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
  assert.ok(calendarWeek("0001-01-01").length);
  assert.ok(calendarWeek("9999-12-31").length);
});
test("read adapter calls only the projection and fails closed on malformed data", async () => {
  mocks.configure({ data: [entry], error: null });
  assert.deepEqual(await getCalendar("2026-09-20", "2026-09-20"), [entry]);
  assert.deepEqual(mocks.calls.map(([name]) => name), ["get_calendar_events_v2"]);
  mocks.configure({ data: [{}], error: null }); assert.equal(await getCalendar("2026-09-20", "2026-09-20"), null);
  mocks.configure(new Error("private database diagnostic")); assert.equal(await getCalendar("2026-09-20", "2026-09-20"), null);
});
test("mutation boundary checks identity/timezone and sanitizes recoverable failures", async () => {
  const request = { userId: id, eventId: id, mode: "create", timezone: "UTC", draft };
  mocks.configure({ data: { event_id: id }, error: null });
  assert.equal((await saveScheduleEvent(request)).outcome, "success");
  assert.equal(mocks.calls[0][0], "create_schedule_event");
  mocks.configure({ data: null, error: { code: "22023", message: "secret SQL" } });
  const rejected = await saveScheduleEvent(request); assert.equal(rejected.outcome, "rejected"); assert.doesNotMatch(rejected.message, /secret SQL/);
  mocks.configure(new Error("secret SQL")); assert.equal((await saveScheduleEvent(request)).outcome, "unknown");
  mocks.configure({ data: false, error: null }); assert.equal((await saveScheduleEvent({ ...request, mode: "remove" })).outcome, "success");
  mocks.configure({ data: null, error: null }, "Asia/Tokyo"); assert.equal((await saveScheduleEvent(request)).outcome, "rejected"); assert.equal(mocks.calls.length, 0);
  mocks.configure({ data: null, error: null }); assert.equal((await saveScheduleEvent({ ...request, userId: "other" })).outcome, "rejected"); assert.equal(mocks.calls.length, 0);
  mocks.configure({}, "UTC", false); await assert.rejects(saveScheduleEvent(request), /auth-gate/); assert.equal(mocks.calls.length, 0);
});
test("Calendar migration stays additive with no Quest writes and preserves checkpoints", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260929120000_create_schedule_events.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE|(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:quests|quest_occurrences|quest_events|exp_ledger)/i);
  assert.equal((sql.match(/PERFORM system_private.require_owner\(\)/g) ?? []).length, 4);
  assert.match(sql, /SECURITY INVOKER/); assert.match(sql, /NOBYPASSRLS/);
  const harness = readFileSync(new URL("helpers/auth-environment.mjs", import.meta.url), "utf8");
  assert.match(harness, /"20260929120000": \["calendar-schedule-catalog", "calendar-schedule"\]/);
  assert.match(harness, /"20260928181000": \["recurring-quests-catalog", "recurring-quests"\]/);
});
