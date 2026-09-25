import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { Writable } from "node:stream";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup, renderToPipeableStream } from "react-dom/server";
import { redirect } from "next/navigation.js";
import { AuthInvalidJwtError, AuthSessionMissingError } from "@supabase/supabase-js";
import { parseDayQuests } from "../src/features/quests/model.ts";
import { addCalendarDays, isCalendarDate, resolveSelectedDate, todayInTimezone } from "../src/features/quests/dates.ts";

// Contract: approved UI Read/Query V1 §3.3 and the actual 20260922000000 migration.
// Exercise real adapters, pages and server-rendered panels. Only Auth/transport,
// cache invalidation and unrelated forms are replaced; no database writes.
const sourceRoot = new URL("../src/", import.meta.url);
const mocksUrl = `data:text/javascript,${encodeURIComponent(`
  export let getAuthenticatedUser;
  export let createServerSupabaseClient;
  export async function requireUser() {
    const user = await getAuthenticatedUser();
    if (!user) throw new Error("test-auth-gate");
    return user;
  }
  export function configure(auth, client) {
    getAuthenticatedUser = auth;
    createServerSupabaseClient = client;
  }
  export const invalidations = [];
  export function revalidatePath(...args) { invalidations.push(args); }
  export function LogoutForm() { return null; }
  export function RewardsPanel() { return null; }
  export function RewardsLoading() { return null; }
  export function QuestCreationForm() { return null; }
  export function QuestCompletionRecovery() { return null; }
  export function OnboardingForm({ displayName }) { return "Existing profile form: " + displayName; }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (["@/features/auth/session", "@/lib/supabase/server", "next/cache",
        "@/features/auth/logout-form", "@/features/profile/onboarding-form",
        "@/features/rewards/panel", "@/features/rewards/components", "@/features/quests/create-form",
        "@/features/quests/completion-recovery-ui"].includes(specifier)) {
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
const { getDayQuests } = await import("../src/features/quests/data.ts");
const { DailyQuestList, DailyQuestLoading } = await import("../src/features/quests/components.tsx");
const { DailyQuestsPanel } = await import("../src/features/quests/panel.tsx");
const { QuestCompletionProvider } = await import("../src/features/quests/completion-provider.tsx");
const { default: DashboardPage } = await import("../src/app/dashboard/page.tsx");
const { default: OnboardingPage } = await import("../src/app/onboarding/page.tsx");
const { saveProfile } = await import("../src/features/profile/actions.ts");
const { configure, invalidations } = await import(mocksUrl);
hooks.deregister();

const owner = { id: "00000000-0000-0000-0000-000000000001", email: "synthetic@example.invalid" };
const base = {
  occurrence_id: "00000000-0000-0000-0000-000000000002",
  quest_id: "00000000-0000-0000-0000-000000000003",
  quest_title: "Read the next chapter",
  status: "active",
  scheduled_at: "2026-09-23T08:30:00.123456+00:00",
  deadline_at: "2026-09-23T10:30:00+00:00",
  source_slot_date: null,
  execution_cycle: 1,
  reward_exp_snapshot: 50,
  progression_ready: true,
  completable: true,
  already_completed_cycle: null,
};
const render = (result, timezone = "Asia/Ho_Chi_Minh", selectedDate = "2026-09-23") =>
  renderToStaticMarkup(createElement(DailyQuestList, { result, timezone, selectedDate }));

function mockRead(read, getUser = async () => assert.fail("unexpected fresh Auth check"), selectedDate = "2026-09-23") {
  configure(async () => owner, async (readOnly) => {
    assert.equal(readOnly, true);
    return { auth: { getUser }, rpc: async (...args) => {
      assert.deepEqual(args, ["list_day_quest_occurrences", { p_day: selectedDate }]);
      return read();
    } };
  });
}

function streamMarkup(element, onChunk = () => {}) {
  return new Promise((resolve, reject) => {
    let html = "";
    const destination = new Writable({ write(chunk, _encoding, callback) {
      html += chunk.toString();
      onChunk(html);
      callback();
    } });
    destination.on("finish", () => resolve(html));
    destination.on("error", reject);
    const stream = renderToPipeableStream(element, {
      onShellReady() { stream.pipe(destination); }, onError: reject,
    });
  });
}

test("complete SQL payload preserves all twelve fields and accepts only [] as an empty day", () => {
  assert.deepEqual(parseDayQuests([base]), { status: "ok", quests: [base] });
  assert.deepEqual(parseDayQuests([]), { status: "ok", quests: [] });
  for (const data of [null, undefined, {}, base, false, "[]", [base, {}], [base, base], new Array(1)]) {
    assert.deepEqual(parseDayQuests(data), { status: "invalid" });
  }
});

test("every field must be present, own, correctly typed and within SQL bounds", () => {
  for (const key of Object.keys(base)) {
    const missing = { ...base };
    delete missing[key];
    for (const row of [missing, { ...base, [key]: undefined }, Object.assign(Object.create({ [key]: base[key] }), missing)]) {
      assert.deepEqual(parseDayQuests([row]), { status: "invalid" }, key);
    }
  }
  const malformed = {
    occurrence_id: [null, 1, "bad-uuid"], quest_id: [null, ""],
    quest_title: [null, "", "  ", "X".repeat(121)], status: [null, "overdue", "ACTIVE"],
    scheduled_at: [0, "today", "2026-09-23", "2026-09-23T08:00:00", "2026-02-30T08:00:00Z", "2026-09-23T24:00:00Z"],
    deadline_at: [false, "infinity", "2026-13-01T08:00:00Z"],
    source_slot_date: [1, "2026-02-29", "2026-09-23T00:00:00Z"],
    execution_cycle: [null, 0, -1, 1.1, "1", 2147483648],
    reward_exp_snapshot: [-1, 1.5, "50", 2147483648, NaN, Infinity],
    progression_ready: [null, 0, "false"], completable: [null, 1, "true"],
    already_completed_cycle: [0, -1, 1.5, "1", 2147483648],
  };
  for (const [key, values] of Object.entries(malformed)) {
    for (const value of values) assert.deepEqual(parseDayQuests([{ ...base, [key]: value }]), { status: "invalid" }, key);
  }
  assert.deepEqual(parseDayQuests([{ ...base, extra: 1 }]), { status: "invalid" });
  assert.equal(parseDayQuests([{ ...base, quest_title: "🌱".repeat(120), execution_cycle: 2147483647,
    reward_exp_snapshot: 2147483647, already_completed_cycle: 2147483647 }]).status, "ok");
});

test("nullable timestamps, slot date, reward and completion cycle stay null; zero EXP stays zero", () => {
  const untimed = { ...base, scheduled_at: null, deadline_at: null, source_slot_date: "2026-09-23",
    reward_exp_snapshot: null, already_completed_cycle: null, completable: false };
  const result = parseDayQuests([untimed]);
  assert.deepEqual(result, { status: "ok", quests: [untimed] });
  const html = render(result);
  assert.match(html, /Not set/);
  assert.doesNotMatch(html, /<time|0 EXP|<dt>Scheduled|<dt>Deadline/);
  assert.match(render(parseDayQuests([{ ...untimed, reward_exp_snapshot: 0 }])), /0 EXP/);
});

test("server membership, order, status and readiness are never recomputed", () => {
  // Deliberately contradictory advisory flags and dates prove the UI does not
  // replace them with status/reward/current-clock logic or sort by timestamps.
  const first = { ...base, quest_title: "First from server", status: "completed", completable: true,
    progression_ready: false, reward_exp_snapshot: null, scheduled_at: "2099-01-01T00:00:00Z" };
  const second = { ...base, occurrence_id: owner.id, quest_title: "Second from server",
    completable: false, scheduled_at: "2001-01-01T00:00:00Z" };
  const result = parseDayQuests([first, second]);
  assert.deepEqual(result, { status: "ok", quests: [first, second] });
  const html = render(result);
  assert.ok(html.indexOf("First from server") < html.indexOf("Second from server"));
  assert.match(html, /Status: Completed/);
  assert.match(html, /Ready to complete/);
  assert.match(html, /Not ready to complete/);
  assert.match(html, /Level system setup required/);
  assert.match(html, /2099/);
  assert.match(html, /2001/);
  assert.doesNotMatch(html, /complete_quest|reopen_quest/);
});

test("read adapter distinguishes empty, malformed, timezone and generic RPC errors", async () => {
  for (const data of [[], [base], null, {}, [base, {}]]) {
    mockRead(() => ({ data, error: null }));
    assert.deepEqual(await getDayQuests("2026-09-23"), parseDayQuests(data));
  }
  for (const [error, status] of [[{ code: "PZ001" }, "timezone-required"],
    [{ code: "XX000", message: "private diagnostic" }, "unavailable"], [new Error("fetch failed"), "unavailable"]]) {
    mockRead(() => ({ data: [], error }));
    assert.deepEqual(await getDayQuests("2026-09-23"), { status });
    mockRead(() => { throw error; });
    assert.deepEqual(await getDayQuests("2026-09-23"), { status });
  }
});

test("read adapter sends the selected calendar date to the SQL contract", async () => {
  const selectedDate = "2027-02-28";
  mockRead(() => ({ data: [], error: null }), async () => owner, selectedDate);
  assert.deepEqual(await getDayQuests(selectedDate), { status: "ok", quests: [] });
});

test("valid session plus returned or thrown 42501/token errors stays a panel error without redirect", async () => {
  for (const error of [{ code: "42501" }, { code: "PGRST301" }, { code: "PGRST302" },
    { code: "PGRST303" }, { code: "session_expired" }, new AuthSessionMissingError(), new AuthInvalidJwtError("expired")]) {
    let checks = 0;
    const getUser = async () => { checks++; return { data: { user: owner }, error: null }; };
    mockRead(() => ({ data: [], error }), getUser);
    assert.deepEqual(await getDayQuests("2026-09-23"), { status: "unavailable" });
    mockRead(() => { throw error; }, getUser);
    assert.deepEqual(await getDayQuests("2026-09-23"), { status: "unavailable" });
    assert.equal(checks, 2);
  }
});

test("confirmed expired sessions render inline sign-in recovery, never automatic redirect", async () => {
  for (const error of [null, new AuthSessionMissingError(), { code: "session_expired" }, new AuthInvalidJwtError("expired")]) {
    mockRead(() => ({ data: null, error: { code: "42501" } }), async () => ({ data: { user: null }, error }));
    const result = await getDayQuests("2026-09-23");
    assert.deepEqual(result, { status: "session-expired" });
    assert.match(render(result), /href="\/login"/);
    if (error) {
      mockRead(() => ({ data: null, error: { code: "42501" } }), async () => { throw error; });
      assert.deepEqual(await getDayQuests("2026-09-23"), result);
    }
  }
  configure(async () => null, async () => assert.fail("no RPC when unauthenticated"));
  assert.deepEqual(await getDayQuests("2026-09-23"), { status: "session-expired" });
});

test("inconclusive Auth checks and transport failures remain generic and preserve framework control flow", async () => {
  for (const error of [new Error("private network details"), { code: "42501" }, { status: 429 }, { status: 503 }]) {
    mockRead(() => ({ data: null, error: { code: "42501" } }), async () => ({ data: { user: null }, error }));
    assert.deepEqual(await getDayQuests("2026-09-23"), { status: "unavailable" });
    mockRead(() => ({ data: null, error: { code: "42501" } }), async () => { throw error; });
    assert.deepEqual(await getDayQuests("2026-09-23"), { status: "unavailable" });
  }
  configure(async () => { throw new Error("auth network failure"); }, async () => assert.fail("no client"));
  assert.deepEqual(await getDayQuests("2026-09-23"), { status: "unavailable" });
  configure(async () => owner, async () => { throw new Error("client unavailable"); });
  assert.deepEqual(await getDayQuests("2026-09-23"), { status: "unavailable" });
  for (const read of [() => redirect("/login"), () => ({ data: null, error: { code: "42501" } })]) {
    mockRead(read, async () => redirect("/login"));
    await assert.rejects(getDayQuests("2026-09-23"), (error) => error.digest === "NEXT_REDIRECT;replace;/login;307;");
  }
});

test("accessible distinct loading, empty, invalid, retry, timezone and time displays", () => {
  const loading = renderToStaticMarkup(createElement(DailyQuestLoading, { timezone: "UTC", selectedDate: "2026-09-23" }));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /role="status"/);
  assert.match(render({ status: "ok", quests: [] }), /No Quests for this day/);
  for (const status of ["invalid", "unavailable", "timezone-required", "session-expired"]) {
    const html = render({ status });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /No Quests for this day|private diagnostic/);
  }
  assert.match(render({ status: "invalid" }), /could not be read safely/);
  assert.match(render({ status: "unavailable" }), /href="\/dashboard\?date=2026-09-23"[^>]*>Retry Daily Quests/);
  assert.match(render({ status: "timezone-required" }), /href="\/onboarding\?repair=timezone"/);
  const html = render(parseDayQuests([{ ...base, quest_title: "X".repeat(120) }]));
  assert.match(html, /Selected day: September 23, 2026/);
  assert.match(html, /Profile timezone: Asia\/Ho_Chi_Minh/);
  assert.match(html, /03:30:00 PM/);
  assert.match(html, /dateTime="2026-09-23T08:30:00.123456\+00:00"/);
  assert.match(html, /Reward EXP snapshot/);
  assert.match(html, /Completion readiness \(server\)/);
  assert.ok(html.includes("X".repeat(120)));
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /sm:grid-cols-2/);
});

const progression = {
  available: true, current_exp: 50, current_level: 1, highest_level: 1,
  policy_id: owner.id, policy_key: "level_policy_v1", policy_version: 1,
  current_level_required_exp: 0, next_level: 2, next_level_required_exp: 100,
};
function pageClient(rpc, profile = { display_name: "Operator", timezone: "UTC" }) {
  return {
    auth: { getUser: async () => ({ data: { user: owner }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }),
    rpc,
  };
}

test("Dashboard preserves successful Player/EXP for every Quest error and supports retry by navigation", async () => {
  for (const error of [{ code: "XX000" }, { code: "PZ001" }, { code: "42501" }]) {
    let questCalls = 0;
    configure(async () => owner, async () => pageClient(async (name) => {
      if (name === "get_progression_status") return { data: progression, error: null };
      assert.equal(name, "list_day_quest_occurrences");
      questCalls++;
      return questCalls === 1 ? { data: null, error } : { data: [base], error: null };
    }));
    const html = await streamMarkup(await DashboardPage());
    assert.match(html, /synthetic@example.invalid/);
    assert.match(html, /50 EXP/);
    assert.match(html, /role="alert"/);
    const retry = await streamMarkup(await DashboardPage());
    assert.match(retry, /Read the next chapter/);
    assert.equal(questCalls, 2);
  }
});

test("Dashboard streams Quest loading while Player/EXP are visible, then renders returned data", async () => {
  let finishRead;
  const pending = new Promise((resolve) => { finishRead = resolve; });
  configure(async () => owner, async () => pageClient(async (name) => name === "get_progression_status"
    ? { data: progression, error: null } : pending));
  let sawLoading = false;
  const html = await streamMarkup(await DashboardPage(), (chunk) => {
    if (!sawLoading && chunk.includes("Loading Daily Quests")) {
      sawLoading = true;
      assert.match(chunk, /synthetic@example.invalid/);
      assert.match(chunk, /50 EXP/);
      finishRead({ data: [base], error: null });
    }
  });
  assert.equal(sawLoading, true);
  assert.match(html, /Read the next chapter/);
});

test("Quest session expiry after Profile gate preserves already successful panels", async () => {
  let authCalls = 0;
  configure(async () => ++authCalls <= 2 ? owner : null,
    async () => pageClient(async () => ({ data: progression, error: null })));
  const html = await streamMarkup(await DashboardPage());
  assert.match(html, /50 EXP/);
  assert.match(html, /synthetic@example.invalid/);
  assert.match(html, /Your session has expired/);
});

test("timezone repair bypasses only completed onboarding redirect and uses existing Profile form", async () => {
  configure(async () => owner, async () => pageClient(() => assert.fail("no RPC")));
  const page = (repair) => OnboardingPage({ searchParams: Promise.resolve({ repair }) });
  for (const value of [undefined, "other", ["timezone"]]) {
    await assert.rejects(page(value), (error) => error.digest === "NEXT_REDIRECT;replace;/dashboard;307;");
  }
  assert.match(renderToStaticMarkup(await page("timezone")), /Repair timezone/);
  assert.match(renderToStaticMarkup(await page("timezone")), /Existing profile form: Operator/);
  configure(async () => owner, async () => pageClient(() => {}, { display_name: null, timezone: null }));
  assert.match(renderToStaticMarkup(await page(undefined)), /Profile Setup/);
  configure(async () => owner, async () => pageClient(() => {}, null));
  assert.doesNotMatch(renderToStaticMarkup(await page("timezone")), /Existing profile form/);
  configure(async () => null, async () => assert.fail("repair cannot bypass auth"));
  await assert.rejects(page("timezone"), /test-auth-gate/);
});

test("repair saves through the existing owner-scoped Profile action and returns to Dashboard", async () => {
  const calls = [];
  configure(async () => owner, async (readOnly) => {
    assert.equal(readOnly, undefined, "save uses existing writable SSR client");
    return { from(table) {
      calls.push(table);
      return { update(values) {
        calls.push(values);
        return { eq(key, value) {
          calls.push([key, value]);
          return { select: () => ({ maybeSingle: async () => ({ data: { timezone: "UTC" }, error: null }) }) };
        } };
      } };
    } };
  });
  const form = new FormData();
  form.set("display_name", "Operator"); form.set("timezone", "UTC"); form.set("user_id", "untrusted-owner");
  await assert.rejects(saveProfile({}, form), (error) => error.digest === "NEXT_REDIRECT;replace;/dashboard;307;");
  assert.deepEqual(calls, ["profiles", { display_name: "Operator", timezone: "UTC" }, ["user_id", owner.id]]);
  assert.deepEqual(invalidations.at(-1), ["/", "layout"]);
  form.set("timezone", "Not/AZone");
  assert.match((await saveProfile({}, form)).error, /valid IANA timezone/);
  assert.equal(calls.length, 3, "invalid repair does not write");
});

test("server panel consumes the feature adapter directly", async () => {
  mockRead(() => ({ data: [], error: null }));
  const panel = await DailyQuestsPanel({ timezone: "UTC", selectedDate: "2026-09-23", userId: owner.id });
  assert.match(renderToStaticMarkup(createElement(QuestCompletionProvider, { userId: owner.id }, panel)), /No Quests for this day/);
});

test("calendar navigation handles boundaries, leap years, DST and strict query dates", () => {
  assert.equal(isCalendarDate("2026-09-23"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2026-2-03"), false);
  assert.equal(addCalendarDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addCalendarDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addCalendarDays("2026-11-01", -1), "2026-10-31");
  const instant = new Date("2026-09-23T23:30:00Z");
  assert.equal(todayInTimezone("Asia/Ho_Chi_Minh", instant), "2026-09-24");
  assert.equal(todayInTimezone("America/Los_Angeles", instant), "2026-09-23");
  assert.equal(resolveSelectedDate("2026-02-29", "UTC"), todayInTimezone("UTC"));
  assert.equal(resolveSelectedDate(["2026-09-23"], "UTC"), todayInTimezone("UTC"));
  assert.equal(resolveSelectedDate("2026-09-23", "UTC"), "2026-09-23");
});

test("selected calendar labels never shift in negative-offset zones", () => {
  const selectedDate = "2026-11-01";
  for (const timezone of ["America/Los_Angeles", "America/New_York"]) {
    const html = render({ status: "ok", quests: [] }, timezone, selectedDate);
    assert.match(html, /Selected day: November 1, 2026/);
    assert.match(html, /id="quest-date"[^>]*min="0001-01-01"[^>]*max="9999-12-31"[^>]*value="2026-11-01"/);
    assert.match(html, /href="\/dashboard\?date=2026-10-31"[^>]*>Previous day/);
    assert.match(html, /href="\/dashboard\?date=2026-11-02"[^>]*>Next day/);
  }
});

test("supported date endpoints disable navigation and reject expanded dates", () => {
  assert.equal(isCalendarDate("0001-01-01"), true);
  assert.equal(isCalendarDate("9999-12-31"), true);
  assert.equal(isCalendarDate("0000-12-31"), false);
  assert.equal(isCalendarDate("10000-01-01"), false);
  assert.throws(() => addCalendarDays("0001-01-01", -1));
  assert.throws(() => addCalendarDays("9999-12-31", 1));
  const minimum = render({ status: "ok", quests: [] }, "UTC", "0001-01-01");
  assert.match(minimum, /aria-label="Previous day unavailable"/);
  assert.doesNotMatch(minimum, /href="\/dashboard\?date=0000-12-31"/);
  const maximum = render({ status: "ok", quests: [] }, "UTC", "9999-12-31");
  assert.match(maximum, /aria-label="Next day unavailable"/);
  assert.doesNotMatch(maximum, /href="\/dashboard\?date=10000-01-01"/);
});

test("non-today read failure and both retry links preserve the selected date", async () => {
  const selectedDate = "2026-11-01";
  const rpcDates = [];
  let questAttempt = 0;
  configure(async () => owner, async () => pageClient(async (name, args) => {
    if (name === "get_progression_status") return { data: progression, error: null };
    rpcDates.push(args?.p_day);
    questAttempt++;
    return questAttempt === 1 ? { data: null, error: { code: "XX000" } } : { data: [], error: null };
  }));
  const first = await streamMarkup(await DashboardPage({ searchParams: Promise.resolve({ date: selectedDate }) }));
  assert.match(first, new RegExp(`Retry Daily Quests`));
  assert.match(first, new RegExp(`href="/dashboard\\?date=${selectedDate}"[^>]*>Retry Daily Quests`));
  const retry = await streamMarkup(await DashboardPage({ searchParams: Promise.resolve({ date: selectedDate }) }));
  assert.match(retry, /No Quests for this day/);
  assert.deepEqual(rpcDates, [selectedDate, selectedDate]);

  let progressionAttempts = 0;
  configure(async () => owner, async () => pageClient(async (name, args) => {
    if (name === "get_progression_status") {
      progressionAttempts++;
      return progressionAttempts === 1
        ? { data: null, error: { code: "XX000" } }
        : { data: progression, error: null };
    }
    assert.equal(args.p_day, selectedDate);
    return { data: [], error: null };
  }));
  const progressionFailure = await streamMarkup(await DashboardPage({ searchParams: Promise.resolve({ date: selectedDate }) }));
  assert.match(progressionFailure, new RegExp(`href="/dashboard\\?date=${selectedDate}"[^>]*>Retry`));
  const progressionRetry = await streamMarkup(await DashboardPage({ searchParams: Promise.resolve({ date: selectedDate }) }));
  assert.match(progressionRetry, /No Quests for this day/);
});
