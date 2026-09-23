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
import { parseRewards, REWARD_PROJECTION } from "../src/features/rewards/model.ts";

// Contract: approved UI Read/Query V1 section 3.4 and actual rewards SQL.
// Exercise real adapters, pages and server-rendered panels. Only Auth/transport,
// unrelated forms are replaced; no database writes.
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
  export function LogoutForm() { return null; }
  export function QuestCreationForm() { return null; }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (["@/features/auth/session", "@/lib/supabase/server",
        "@/features/auth/logout-form", "@/features/quests/create-form"].includes(specifier)) {
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
const { getRewards } = await import("../src/features/rewards/data.ts");
const { RewardsPreview, RewardsLoading } = await import("../src/features/rewards/components.tsx");
const { RewardsPanel } = await import("../src/features/rewards/panel.tsx");
const { default: DashboardPage } = await import("../src/app/dashboard/page.tsx");
const { configure } = await import(mocksUrl);
hooks.deregister();

const owner = { id: "00000000-0000-0000-0000-000000000001", email: "synthetic@example.invalid" };
const base = {
  reward_id: "00000000-0000-0000-0000-000000000002", required_level: 0,
  title: "A quiet afternoon", description: null, category: "experience",
  estimated_cost: "12.50", currency_label: "USD", revision: "1",
  archived_at: null, lifecycle: "LOCKED", unlock_id: null, unlocked_at: null,
  redemption_event_id: null, redeemed_at: null,
};
const render = (result) => renderToStaticMarkup(createElement(RewardsPreview, { result }));
function mockRead(read, getUser = async () => assert.fail("unexpected fresh Auth check")) {
  configure(async () => owner, async (readOnly) => {
    assert.equal(readOnly, true);
    return { auth: { getUser }, rpc: (...args) => {
      assert.deepEqual(args, ["list_level_rewards"], "no identity argument or eager history");
      return { select: async (projection) => { assert.equal(projection, REWARD_PROJECTION); return read(); } };
    } };
  });
}
function streamMarkup(element, onChunk = () => {}) {
  return new Promise((resolve, reject) => {
    let html = "";
    const destination = new Writable({ write(chunk, _encoding, callback) {
      html += chunk.toString(); onChunk(html); callback();
    } });
    destination.on("finish", () => resolve(html)); destination.on("error", reject);
    const stream = renderToPipeableStream(element, {
      onShellReady() { stream.pipe(destination); }, onError: reject,
    });
  });
}

test("all fourteen SQL fields, only [] is empty; malformed and duplicate rows fail closed", () => {
  assert.deepEqual(parseRewards([base]), { status: "ok", rewards: [base] });
  assert.deepEqual(parseRewards([]), { status: "ok", rewards: [] });
  for (const value of [null, undefined, {}, base, false, "[]", [base, {}], [base, base], new Array(1)]) {
    assert.deepEqual(parseRewards(value), { status: "invalid" });
  }
  for (const key of Object.keys(base)) {
    const missing = { ...base }; delete missing[key];
    for (const row of [missing, { ...base, [key]: undefined }, Object.assign(Object.create({ [key]: base[key] }), missing)]) {
      assert.deepEqual(parseRewards([row]), { status: "invalid" }, key);
    }
  }
  assert.deepEqual(parseRewards([{ ...base, extra: true }]), { status: "invalid" });
});

test("required/nullable fields, SQL ranges and exact decimal/bigint transport", () => {
  const malformed = {
    reward_id: [null, 1, "bad"], required_level: [null, -1, 1.5, "1", 2147483648, NaN, Infinity],
    title: [null, "", "   ", 5], description: [false, 1], category: [null, "other", "TREAT"],
    estimated_cost: [null, -1, 0, 12.5, Number.MAX_SAFE_INTEGER + 1, "-1", "NaN", "Infinity", "1e3", "", "1.", ".5"],
    currency_label: [null, "", "  ", 1], revision: [null, 1, Number.MAX_SAFE_INTEGER + 1, "0", "-1", "1.5", "9223372036854775808", "01"],
    archived_at: [1, "today", "2026-02-30T00:00:00Z", "2026-09-23", "2026-09-23T24:00:00Z"],
    lifecycle: [null, "locked", "ARCHIVED"], unlock_id: [1, "bad"], unlocked_at: [true, "infinity"],
    redemption_event_id: [0, ""], redeemed_at: ["2026-09-23T12:00:00", "2026-13-01T00:00:00Z"],
  };
  for (const [key, values] of Object.entries(malformed)) for (const value of values) {
    assert.deepEqual(parseRewards([{ ...base, [key]: value }]), { status: "invalid" }, `${key}: ${value}`);
  }
  for (const cost of ["0", "0.00", "9007199254740993.12345678901234567890", "9".repeat(400)]) {
    const row = { ...base, required_level: 2147483647, title: "\u{1F331}".repeat(500), estimated_cost: cost, revision: "9223372036854775807" };
    assert.deepEqual(parseRewards([row]), { status: "ok", rewards: [row] });
  }
  const nullable = { ...base, estimated_cost: null, currency_label: null, description: "" };
  assert.deepEqual(parseRewards([nullable]), { status: "ok", rewards: [nullable] });
  for (const category of ["treat", "purchase", "experience", "custom"]) {
    assert.equal(parseRewards([{ ...base, category }]).status, "ok");
  }
});

test("lifecycle and archive are independent server values; preserve order and preview first five", () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ ...base,
    reward_id: `00000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`,
    title: `Server reward ${index}`, required_level: 7 - index,
    lifecycle: ["LOCKED", "UNLOCKED", "REDEEMED"][index % 3],
    archived_at: "2026-09-23T08:30:00.123456+00:00",
  }));
  // Deliberately absent receipt fields: presentation must not recompute lifecycle.
  const result = parseRewards(rows);
  assert.deepEqual(result, { status: "ok", rewards: rows });
  const html = render(result);
  assert.match(html, /Locked/); assert.match(html, /Unlocked/); assert.match(html, /Redeemed/);
  assert.equal((html.match(/Archived/g) ?? []).length, 5);
  assert.ok(html.indexOf("Server reward 0") < html.indexOf("Server reward 4"));
  assert.doesNotMatch(html, /Server reward [56]/); assert.match(html, /Showing 5 of 7 rewards/);
  assert.equal(parseRewards([...rows, {}]).status, "invalid", "validate beyond prefix");
  const receipts = { ...base, lifecycle: "REDEEMED", unlock_id: owner.id, redemption_event_id: owner.id,
    unlocked_at: "2026-09-23T08:00:00Z", redeemed_at: "2026-09-23T09:00:00Z" };
  assert.equal(parseRewards([receipts]).status, "ok");
});

test("adapter reads empty/valid/malformed and returned/thrown generic RPC failures", async () => {
  for (const data of [[], [base], null, {}, [base, {}]]) {
    mockRead(() => ({ data, error: null })); assert.deepEqual(await getRewards(), parseRewards(data));
  }
  for (const error of [{ code: "XX000", message: "private diagnostic" }, { code: "PGRST202" }, new Error("network")]) {
    mockRead(() => ({ data: [], error })); assert.deepEqual(await getRewards(), { status: "unavailable" });
    mockRead(() => { throw error; }); assert.deepEqual(await getRewards(), { status: "unavailable" });
  }
  configure(async () => { throw new Error("auth network"); }, async () => assert.fail("no client"));
  assert.deepEqual(await getRewards(), { status: "unavailable" });
  configure(async () => owner, async () => { throw new Error("client unavailable"); });
  assert.deepEqual(await getRewards(), { status: "unavailable" });
});

test("valid session plus permission/token errors never redirects or reports expiry", async () => {
  for (const error of [{ code: "42501" }, { code: "PGRST301" }, { code: "PGRST302" },
    { code: "PGRST303" }, { code: "session_expired" }, new AuthSessionMissingError(), new AuthInvalidJwtError("expired")]) {
    let checks = 0;
    const auth = async () => { checks++; return { data: { user: owner }, error: null }; };
    mockRead(() => ({ data: null, error }), auth); assert.deepEqual(await getRewards(), { status: "unavailable" });
    mockRead(() => { throw error; }, auth); assert.deepEqual(await getRewards(), { status: "unavailable" });
    assert.equal(checks, 2);
  }
});

test("confirmed expiry has inline sign-in recovery; inconclusive Auth remains unavailable", async () => {
  for (const error of [null, new AuthSessionMissingError(), { code: "session_expired" }, new AuthInvalidJwtError("expired")]) {
    mockRead(() => ({ data: null, error: { code: "42501" } }), async () => ({ data: { user: null }, error }));
    assert.deepEqual(await getRewards(), { status: "session-expired" });
    if (error) {
      mockRead(() => ({ data: null, error: { code: "42501" } }), async () => { throw error; });
      assert.deepEqual(await getRewards(), { status: "session-expired" });
    }
  }
  for (const error of [new Error("network"), { code: "42501" }, { status: 503 }]) {
    mockRead(() => ({ error: { code: "42501" } }), async () => ({ data: { user: null }, error }));
    assert.deepEqual(await getRewards(), { status: "unavailable" });
    mockRead(() => ({ error: { code: "42501" } }), async () => { throw error; });
    assert.deepEqual(await getRewards(), { status: "unavailable" });
  }
  for (const [error, status] of [[null, "session-expired"], [new Error("network"), "unavailable"]]) {
    configure(async () => null, async () => ({
      auth: { getUser: async () => ({ data: { user: null }, error }) },
      rpc: () => assert.fail("no RPC unauthenticated"),
    }));
    assert.deepEqual(await getRewards(), { status });
  }
  mockRead(() => redirect("/login"));
  await assert.rejects(getRewards(), (error) => error.digest === "NEXT_REDIRECT;replace;/login;307;");
});

test("accessible loading, error, empty and long-name markup with functional navigation links", async () => {
  const loading = renderToStaticMarkup(createElement(RewardsLoading));
  assert.match(loading, /aria-busy="true"/); assert.match(loading, /role="status"/);
  assert.match(render(parseRewards([])), /No rewards configured yet/);
  for (const status of ["invalid", "unavailable", "session-expired"]) {
    const html = render({ status }); assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /No rewards configured|private diagnostic/);
  }
  assert.match(render({ status: "invalid" }), /could not be read safely/);
  assert.match(render({ status: "unavailable" }), /href="\/dashboard"[^>]*>Retry Rewards/);
  assert.match(render({ status: "session-expired" }), /href="\/login"/);
  const title = "X".repeat(1000) + "<script>";
  const html = render(parseRewards([{ ...base, title }]));
  assert.match(html, /aria-label="Rewards Preview"/); assert.match(html, /<h2/);
  assert.match(html, /<ul aria-label="Rewards"/); assert.match(html, /<h3/);
  assert.match(html, /<dt[^>]*>Required Level/); assert.match(html, /<dd[^>]*>0<\/dd>/);
  assert.ok(html.includes("X".repeat(1000))); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /overflow-wrap:anywhere/); assert.match(html, /sm:grid-cols-2/);
  assert.doesNotMatch(html, /<button|<script|Archived/);
  mockRead(() => ({ data: [], error: null }));
  assert.match(renderToStaticMarkup(await RewardsPanel()), /No rewards configured yet/);
});

const progression = {
  available: true, current_exp: 50, current_level: 1, highest_level: 1,
  policy_id: owner.id, policy_key: "level_policy_v1", policy_version: 1,
  current_level_required_exp: 0, next_level: 2, next_level_required_exp: 100,
};
function pageClient(read, auth = async () => ({ data: { user: owner }, error: null })) {
  return {
    auth: { getUser: auth },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: "Operator", timezone: "UTC" }, error: null }) }) }) }),
    rpc(name, ...args) {
      assert.equal(args.length, 0);
      if (name === "get_progression_status") return Promise.resolve({ data: progression, error: null });
      if (name === "list_day_quest_occurrences") return Promise.resolve({ data: [], error: null });
      assert.equal(name, "list_level_rewards", "history and writes must never be called");
      return { select(projection) { assert.equal(projection, REWARD_PROJECTION); return read(); } };
    },
  };
}

test("Rewards failures/expiry preserve Player, EXP and Daily Quests; retry reruns read", async () => {
  for (const first of [{ data: null, error: { code: "XX000" } }, { data: null, error: { code: "42501" } }, { data: [{}], error: null }]) {
    let calls = 0;
    configure(async () => owner, async () => pageClient(async () => ++calls === 1 ? first : { data: [base], error: null }));
    const html = await streamMarkup(await DashboardPage());
    assert.match(html, /synthetic@example.invalid/); assert.match(html, /50 EXP/); assert.match(html, /No Quests for this day/);
    assert.match(html, /Retry Rewards/);
    const retry = await streamMarkup(await DashboardPage()); assert.match(retry, /A quiet afternoon/); assert.equal(calls, 2);
  }
  configure(async () => owner, async () => pageClient(async () => ({ error: { code: "42501" } }),
    async () => ({ data: { user: null }, error: new AuthSessionMissingError() })));
  const html = await streamMarkup(await DashboardPage());
  assert.match(html, /Your session has expired/); assert.match(html, /50 EXP/); assert.match(html, /No Quests for this day/);
});

test("Rewards pending streams independently of Player, EXP and Daily Quests", async () => {
  let finishRead;
  const pending = new Promise((resolve) => { finishRead = resolve; });
  configure(async () => owner, async () => pageClient(() => pending));
  let sawLoading = false;
  const html = await streamMarkup(await DashboardPage(), (chunk) => {
    if (!sawLoading && chunk.includes("Loading Rewards") && chunk.includes("No Quests for this day")) {
      sawLoading = true; assert.match(chunk, /synthetic@example.invalid/); assert.match(chunk, /50 EXP/);
      finishRead({ data: [base], error: null });
    }
  });
  assert.equal(sawLoading, true); assert.match(html, /A quiet afternoon/);
});

test("real Supabase request projects numeric text without owner, ordering override, history or writes", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const requests = [];
  const client = createClient("https://synthetic.invalid", "synthetic-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests.push({ url: new URL(input), init });
      return new Response(JSON.stringify([base]), { headers: { "Content-Type": "application/json" } });
    } },
  });
  configure(async () => owner, async (readOnly) => { assert.equal(readOnly, true); return client; });
  assert.deepEqual(await getRewards(), { status: "ok", rewards: [base] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/rest/v1/rpc/list_level_rewards");
  assert.deepEqual([...requests[0].url.searchParams], [["select", REWARD_PROJECTION]]);
  assert.equal(requests[0].init.body, "{}");
});

