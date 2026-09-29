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
const mocks = await import(mockUrl);
const id = "11111111-1111-4111-8111-111111111111";
const draft = { title: " Appointment ", start: "2026-09-20T00:30", end: "2026-09-20T01:30", allDay: false, category: " class ", notes: "note" };
const entry = { source: "schedule_event", entry_id: id, quest_id: null, title: "Appointment", status: null, start_at: "2026-09-19T15:30:00Z", end_at: "2026-09-19T16:30:00Z", all_day: false, start_date: null, end_date: null, category: null, notes: null, source_slot_date: null };

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
  assert.deepEqual(mocks.calls.map(([name]) => name), ["get_calendar_events"]);
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
