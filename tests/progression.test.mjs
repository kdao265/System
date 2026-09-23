import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { redirect } from "next/navigation.js";
import { AuthInvalidJwtError, AuthSessionMissingError } from "@supabase/supabase-js";
import { formatExactInteger, mapExpProgress, mapProgressionOutcome, toExactInteger, toPgLevel } from "../src/features/progression/numbers.ts";

// Dashboard Slice 1 contract: docs/02-architecture/ui-read-query-v1-draft.md §3.2
// and docs/01-requirements/level-rewards.md. Exercise the real data adapter and
// Next redirect with mocked auth/transport only; no database or new dependency.
const adapterMocksUrl = `data:text/javascript,${encodeURIComponent(`
  export let requireUser;
  export let createServerSupabaseClient;
  export function configure(auth, client) {
    requireUser = auth;
    createServerSupabaseClient = client;
  }
`)}`;
const dataUrl = new URL("../src/features/progression/data.ts", import.meta.url).href;
const componentsUrl = new URL("../src/features/progression/components.tsx", import.meta.url).href;
const loginUrl = new URL("../src/app/login/page.tsx", import.meta.url).href;
const dashboardUrl = new URL("../src/app/dashboard/page.tsx", import.meta.url).href;
const authUrl = new URL("../src/features/auth/session.ts", import.meta.url).href;
const profileUrl = new URL("../src/features/profile/session.ts", import.meta.url).href;
const pageDependencies = {
  "@/features/auth/session": authUrl,
  "@/features/profile/session": profileUrl,
  "@/features/progression/data": dataUrl,
  "@/features/progression/components": componentsUrl,
};
const inertFormsUrl = `data:text/javascript,${encodeURIComponent(`
  export function AuthForm() { return "Login form"; }
  export function LogoutForm() { return null; }
  export function ProfileError() { return "Profile error"; }
  export function DailyQuestsPanel() { return null; }
  export function DailyQuestLoading() { return null; }
  export function resolveSelectedDate() { return "2026-09-24"; }
  export function RewardsPanel() { return null; }
  export function RewardsLoading() { return null; }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === dataUrl) {
      if (["@/features/auth/session", "@/lib/supabase/server"].includes(specifier)) {
        return { url: adapterMocksUrl, shortCircuit: true };
      }
      if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
      if (specifier === "./numbers") return nextResolve("./numbers.ts", context);
    }
    if ([loginUrl, dashboardUrl, authUrl, profileUrl].includes(context.parentURL)) {
      if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
      if (specifier === "@/lib/supabase/server") return { url: adapterMocksUrl, shortCircuit: true };
      if (pageDependencies[specifier]) return { url: pageDependencies[specifier], shortCircuit: true };
      if (["@/features/auth/auth-form", "@/features/auth/logout-form", "@/features/profile/profile-error", "@/features/quests/panel", "@/features/quests/components", "@/features/rewards/panel", "@/features/rewards/components"].includes(specifier)) {
        return { url: inertFormsUrl, shortCircuit: true };
      }
      if (specifier === "./timezones") return nextResolve("./timezones.ts", context);
      if (specifier === "@/features/quests/dates") return { url: inertFormsUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if ([componentsUrl, loginUrl, dashboardUrl].includes(url)) {
      return {
        format: "module", shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const { getProgressionStatus } = await import(dataUrl);
const { ExpProgressCard, PlayerSummary } = await import(componentsUrl);
const { configure } = await import(adapterMocksUrl);
const { default: LoginPage } = await import(loginUrl);
const { default: DashboardPage } = await import(dashboardUrl);
hooks.deregister();

const base = {
  available: true,
  current_exp: 400,
  current_level: 3,
  highest_level: 10,
  policy_id: "00000000-0000-0000-0000-000000000001",
  policy_key: "level_policy_v1",
  policy_version: 1,
  current_level_required_exp: 400,
  next_level: 4,
  next_level_required_exp: 900,
};

function withOverrides(overrides) {
  return { ...base, ...overrides };
}

test("toExactInteger accepts safe integers and exact digit strings", () => {
  assert.deepEqual(toExactInteger(0), { ok: true, value: 0n });
  assert.deepEqual(toExactInteger(Number.MAX_SAFE_INTEGER), { ok: true, value: BigInt(Number.MAX_SAFE_INTEGER) });
  assert.deepEqual(toExactInteger("9007199254740993"), { ok: true, value: 9007199254740993n });
});

test("toExactInteger rejects unsafe, rounded, malformed and missing values", () => {
  assert.equal(toExactInteger(Number.MAX_SAFE_INTEGER + 2).ok, false);
  assert.equal(toExactInteger(1.5).ok, false);
  assert.equal(toExactInteger(-0.5).ok, false);
  assert.equal(toExactInteger(Number.NaN).ok, false);
  assert.equal(toExactInteger(Number.POSITIVE_INFINITY).ok, false);
  assert.equal(toExactInteger("00900").ok, false);
  assert.equal(toExactInteger("1e5").ok, false);
  assert.equal(toExactInteger(" 5").ok, false);
  assert.equal(toExactInteger(null).ok, false);
  assert.equal(toExactInteger(undefined).ok, false);
  assert.equal(toExactInteger({}).ok, false);
});

test("formatExactInteger renders full decimal text without abbreviation", () => {
  assert.equal(formatExactInteger(9007199254740993n), "9007199254740993");
  assert.equal(formatExactInteger(0n), "0");
});

test("mapExpProgress computes presentation values exactly at level floor", () => {
  const result = mapExpProgress(base);
  assert.equal(result.state, "available");
  assert.equal(result.currentLevel, 3);
  assert.equal(result.highestLevel, 10);
  assert.equal(result.currentExpText, "400");
  assert.equal(result.nextLevel, 4);
  assert.equal(result.expToNextText, "500");
  assert.equal(result.percentInLevel, 0);
});

test("mapExpProgress computes exact mid-level percent and rejects out-of-interval EXP", () => {
  const mid = mapExpProgress(withOverrides({ current_exp: 650 }));
  assert.equal(mid.percentInLevel, 50);
  assert.equal(mid.expToNextText, "250");
  const top = mapExpProgress(withOverrides({ current_exp: 900 }));
  assert.deepEqual(top, { state: "invalid" });
  const below = mapExpProgress(withOverrides({ current_exp: 300 }));
  assert.deepEqual(below, { state: "invalid" });
});

test("mapExpProgress renders max level when next fields are null", () => {
  const cap = mapExpProgress(withOverrides({ current_exp: 980100, current_level: 100, highest_level: 100, current_level_required_exp: 980100, next_level: null, next_level_required_exp: null }));
  assert.equal(cap.state, "available");
  assert.equal(cap.currentLevel, 100);
  assert.equal(cap.nextLevel, null);
  assert.equal(cap.expToNextText, null);
  assert.equal(cap.percentInLevel, null);
});

const unconfigured = {
  available: false, current_exp: 0, current_level: null, highest_level: null,
  policy_id: null, policy_key: null, policy_version: null,
  current_level_required_exp: null, next_level: null, next_level_required_exp: null,
};

test("mapExpProgress accepts the actual SQL unavailable composite, including EXP and history", () => {
  const result = mapExpProgress(unconfigured);
  assert.deepEqual(result, { state: "unavailable" });
  assert.deepEqual(mapExpProgress({ ...unconfigured, current_exp: "9007199254740993", highest_level: 10 }), { state: "unavailable" });
});

test("mapExpProgress fails closed on unsafe or inconsistent numeric data", () => {
  const rounded = mapExpProgress(withOverrides({ current_exp: 9007199254740993 }));
  assert.deepEqual(rounded, { state: "invalid" });
  const badSpan = mapExpProgress(withOverrides({ next_level_required_exp: 400 }));
  assert.deepEqual(badSpan, { state: "invalid" });
  assert.deepEqual(mapExpProgress(withOverrides({ current_level: null })), { state: "invalid" });
});

test("mapExpProgress tolerates null highest_level while available", () => {
  const result = mapExpProgress(withOverrides({ highest_level: null }));
  assert.equal(result.state, "available");
  assert.equal(result.highestLevel, null);
});

test("all ten SQL composite fields must be own properties, never missing or undefined", () => {
  for (const row of [base, unconfigured, withOverrides({ next_level: null, next_level_required_exp: null })]) {
    for (const key of Object.keys(row)) {
      const missing = { ...row };
      delete missing[key];
      assert.deepEqual(mapExpProgress(missing), { state: "invalid" }, `missing ${key}`);
      assert.deepEqual(mapExpProgress({ ...row, [key]: undefined }), { state: "invalid" }, `undefined ${key}`);
      assert.deepEqual(mapExpProgress(Object.assign(Object.create({ [key]: row[key] }), missing)), { state: "invalid" }, `inherited ${key}`);
    }
  }
});

test("malformed RPC payloads never become unconfigured or maximum-level states", () => {
  for (const data of [null, undefined, [], [base], {}, false, "invalid", { ...base, extra: 1 },
    { ...base, available: "false" }, { ...base, available: null },
    { ...unconfigured, current_exp: null }, { ...unconfigured, current_exp: -1 },
    { ...unconfigured, highest_level: 0 }, { ...unconfigured, current_level: 1 },
    { ...unconfigured, policy_id: base.policy_id }, { ...unconfigured, next_level: 2 }]) {
    assert.deepEqual(mapProgressionOutcome(null, data), { kind: "ok", exp: { state: "invalid" } });
  }
});

test("assigned policy provenance must match the SQL types and constraints", () => {
  for (const [key, values] of Object.entries({
    policy_id: [null, false, 1, "", "invalid-uuid"],
    policy_key: [null, false, 1, "", "   "],
    policy_version: [null, false, 0, -1, 1.5, "2147483648", "9007199254740993"],
  })) {
    for (const value of values) assert.deepEqual(mapExpProgress(withOverrides({ [key]: value })), { state: "invalid" });
  }
});

test("PostgreSQL Level bounds are checked before Number conversion for every field", () => {
  for (const key of ["current_level", "highest_level", "next_level"]) {
    for (const value of [0, -1, "-1", 1.5, false, "1e3", 2147483648, "2147483648", "9007199254740993", "9".repeat(400)]) {
      assert.deepEqual(mapExpProgress(withOverrides({ [key]: value })), { state: "invalid" }, key);
    }
  }
  assert.deepEqual(toPgLevel("2147483647"), { ok: true, value: 2147483647n });
  const boundary = mapExpProgress(withOverrides({
    current_level: "2147483646", next_level: "2147483647", highest_level: "2147483647", policy_version: "2147483647",
  }));
  assert.equal(boundary.state, "available");
  assert.equal(boundary.nextLevel, 2147483647);
  assert.equal(boundary.highestLevel, 2147483647);
  assert.equal(mapExpProgress(withOverrides({ current_level: "2147483647", highest_level: "2147483647", next_level: null, next_level_required_exp: null })).currentLevel, 2147483647);
});

test("negative, malformed, and inconsistent EXP/threshold relationships fail closed", () => {
  for (const key of ["current_exp", "current_level_required_exp", "next_level_required_exp"]) {
    for (const value of [-1, "-1", 1.5, "1.5", NaN, Infinity, false, "01", "1e3", " 400", Number.MAX_SAFE_INTEGER + 1]) {
      assert.deepEqual(mapExpProgress(withOverrides({ [key]: value })), { state: "invalid" }, key);
    }
  }
  for (const overrides of [
    { current_exp: 399 }, { current_exp: 900 }, { current_exp: 901 },
    { next_level_required_exp: 399 }, { next_level_required_exp: 400 },
    { next_level: 3 }, { next_level: 2 }, { next_level: 5 },
    { highest_level: 2 }, { next_level: null }, { next_level_required_exp: null },
    { next_level: null, next_level_required_exp: null, current_exp: 399 },
  ]) assert.deepEqual(mapExpProgress(withOverrides(overrides)), { state: "invalid" });
});

test("large exact EXP and thresholds remain exact without Level extrapolation or clamping", () => {
  const floor = 9007199254740993n;
  const progress = mapExpProgress(withOverrides({
    current_exp: String(floor + 3n), current_level_required_exp: String(floor), next_level_required_exp: String(floor + 7n),
  }));
  assert.equal(progress.state, "available");
  assert.equal(progress.currentLevel, 3);
  assert.equal(progress.currentExpText, "9007199254740996");
  assert.equal(progress.expToNextText, "4");
  assert.equal(progress.percentInLevel, 42);
  const max = mapExpProgress(withOverrides({ current_exp: "9".repeat(400), next_level: null, next_level_required_exp: null }));
  assert.equal(max.state, "available");
  assert.equal(max.currentLevel, 3);
  assert.equal(max.currentExpText, "9".repeat(400));
  assert.equal(max.percentInLevel, null);
  assert.equal(mapExpProgress(withOverrides({ current_exp: 899 })).percentInLevel, 99);
  assert.equal(mapExpProgress(withOverrides({ current_exp: 0, current_level: 1, current_level_required_exp: 0, next_level: 2, next_level_required_exp: 100 })).percentInLevel, 0);
});

const authCodes = ["42501", "PGRST301", "PGRST302", "PGRST303", "bad_jwt", "invalid_jwt", "session_not_found", "session_expired", "refresh_token_not_found", "refresh_token_already_used"];
const isLoginRedirect = (error) => error.digest === "NEXT_REDIRECT;replace;/login;307;";

test("valid Auth session plus RPC permission denial ends on Dashboard with a panel error", async () => {
  const user = { id: "synthetic-owner", email: "synthetic@example.invalid" };
  for (const thrown of [false, true]) {
    configure(async () => user, async () => ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { display_name: null, timezone: "UTC" }, error: null,
      }) }) }) }),
      rpc: async () => {
        const error = { code: "42501", message: "Synthetic RPC permission denied" };
        if (thrown) throw error;
        return { data: null, error };
      },
    }));
    // Exercise both real redirect gates: previously Dashboard redirected back
    // to login here, while LoginPage kept accepting the same valid session.
    await assert.rejects(LoginPage(), (error) => error.digest === "NEXT_REDIRECT;replace;/dashboard;307;");
    const html = renderToStaticMarkup(await DashboardPage());
    assert.match(html, /synthetic@example.invalid/);
    assert.match(html, /Progression status is unavailable right now/);
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Synthetic RPC permission denied|Level system not configured/);
  }
});

test("invalid Auth session follows Dashboard recovery and remains on Login", async () => {
  configure(async () => redirect("/login"), async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: new AuthSessionMissingError() }) },
    rpc: () => assert.fail("unauthenticated requests must not read progression"),
  }));
  await assert.rejects(DashboardPage(), isLoginRedirect);
  assert.match(renderToStaticMarkup(await LoginPage()), /Login form/);
});

function mockRead(read, requireUser = async () => ({ id: "synthetic-owner" }), getUser = async () => assert.fail("ordinary RPC results must not recheck Auth")) {
  configure(requireUser, async (readOnly) => {
    assert.equal(readOnly, true);
    return { auth: { getUser }, rpc: async (...args) => {
      assert.deepEqual(args, ["get_progression_status"]);
      return read();
    } };
  });
}

test("real adapter routes returned and thrown confirmed auth failures to existing login recovery", async () => {
  const invalidSession = async () => ({ data: { user: null }, error: new AuthSessionMissingError() });
  for (const error of [...authCodes.map((code) => ({ code })), new AuthSessionMissingError(), new AuthInvalidJwtError("Invalid synthetic JWT")]) {
    mockRead(() => ({ data: base, error }), undefined, invalidSession);
    await assert.rejects(getProgressionStatus(), isLoginRedirect);
    mockRead(() => { throw error; }, undefined, invalidSession);
    await assert.rejects(getProgressionStatus(), isLoginRedirect);
  }
  configure(async () => ({}), async () => { throw new AuthSessionMissingError(); });
  await assert.rejects(getProgressionStatus(), isLoginRedirect);
});

test("RPC auth-like errors cannot redirect when fresh Auth verification accepts the user", async () => {
  for (const error of [...authCodes.map((code) => ({ code })), new AuthSessionMissingError()]) {
    let checks = 0;
    const validSession = async () => {
      checks++;
      return { data: { user: { id: "synthetic-owner" } }, error: null };
    };
    mockRead(() => ({ data: null, error }), undefined, validSession);
    assert.deepEqual(await getProgressionStatus(), { status: "unavailable" });
    mockRead(() => { throw error; }, undefined, validSession);
    assert.deepEqual(await getProgressionStatus(), { status: "unavailable" });
    assert.equal(checks, 2);
  }
});

test("fresh Auth verification confirms missing or expired sessions before recovery", async () => {
  for (const error of [null, new AuthSessionMissingError(), { code: "session_expired" }, new AuthInvalidJwtError("Synthetic JWT expired")]) {
    mockRead(() => ({ data: null, error: { code: "42501" } }), undefined,
      async () => ({ data: { user: null }, error }));
    await assert.rejects(getProgressionStatus(), isLoginRedirect);
    if (error) {
      mockRead(() => ({ data: null, error: { code: "42501" } }), undefined, async () => { throw error; });
      await assert.rejects(getProgressionStatus(), isLoginRedirect);
    }
  }
});

test("inconclusive Auth checks keep the progression error on Dashboard", async () => {
  for (const error of [new Error("Synthetic network failure"), { code: "unexpected_failure", status: 503 }, { status: 429 }, { code: "42501" }]) {
    mockRead(() => ({ data: null, error: { code: "42501" } }), undefined,
      async () => ({ data: { user: null }, error }));
    assert.deepEqual(await getProgressionStatus(), { status: "unavailable" });
    mockRead(() => ({ data: null, error: { code: "42501" } }), undefined, async () => { throw error; });
    assert.deepEqual(await getProgressionStatus(), { status: "unavailable" });
  }
});

test("real adapter preserves Next redirect control flow from auth, client creation and RPC", async () => {
  let original;
  try { redirect("/login"); } catch (error) { original = error; }
  configure(async () => { throw original; }, async () => assert.fail("client must not run before authentication"));
  await assert.rejects(getProgressionStatus(), (error) => error === original);
  configure(async () => ({}), async () => { throw original; });
  await assert.rejects(getProgressionStatus(), (error) => error === original);
  mockRead(() => { throw original; });
  await assert.rejects(getProgressionStatus(), (error) => error === original);
  mockRead(() => ({ data: null, error: { code: "42501" } }), undefined, async () => { throw original; });
  await assert.rejects(getProgressionStatus(), (error) => error === original);
});

test("non-auth RPC/network failures remain unavailable and never expose error details", async () => {
  let authChecks = 0;
  const checkAuth = async () => {
    authChecks++;
    return { data: { user: null }, error: new AuthSessionMissingError() };
  };
  for (const error of [{ code: "XX000" }, { code: "PGRST000" }, { code: "unexpected_failure", status: 500 }, new Error("network failure")]) {
    mockRead(() => ({ data: base, error }), undefined, checkAuth);
    assert.deepEqual(await getProgressionStatus(), { status: "unavailable" });
    mockRead(() => { throw error; }, undefined, checkAuth);
    assert.deepEqual(await getProgressionStatus(), { status: "unavailable" });
  }
  assert.equal(authChecks, 0);
});

test("real adapter validates successful RPC responses instead of inventing states", async () => {
  for (const data of [base, unconfigured, null, [], { available: false }, { ...base, next_level: undefined }]) {
    mockRead(() => ({ data, error: null }));
    assert.deepEqual(await getProgressionStatus(), { status: "ok", exp: mapExpProgress(data) });
  }
});

test("RPC diagnostics are development-only and expose only safe allowlisted fields", async (t) => {
  const originalEnvironment = process.env.NODE_ENV;
  t.after(() => {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  });
  const logs = [];
  t.mock.method(console, "warn", (line) => logs.push(JSON.parse(line)));
  const rpcError = {
    code: "42501", message: "permission denied for schema system_internal",
    hint: "password=synthetic-secret; cookie=synthetic-cookie; synthetic@example.invalid",
    details: "Bearer synthetic-jwt; apikey=synthetic-key",
  };
  const validSession = async () => ({ data: { user: { id: "synthetic-owner" } }, error: null });
  for (const environment of ["production", "test", "development"]) {
    process.env.NODE_ENV = environment;
    mockRead(() => ({ data: null, error: rpcError, status: 403 }), undefined, validSession);
    assert.deepEqual(await getProgressionStatus(), { status: "unavailable" });
    assert.equal(logs.length, environment === "development" ? 1 : 0);
  }
  assert.deepEqual(logs[0], {
    rpc: "get_progression_status", code: "42501",
    message: "permission denied for schema system_internal", status: 403,
    hint: "[redacted: unrecognized diagnostic text]",
  });
  mockRead(() => ({ data: null, error: {
    ...rpcError, code: "XX000", message: "JWT=synthetic-jwt; password=synthetic-secret; synthetic@example.invalid", hint: "",
  } }));
  await getProgressionStatus();
  assert.deepEqual(logs[1], {
    rpc: "get_progression_status", code: "XX000", message: "[redacted: unrecognized diagnostic text]",
  });
  mockRead(() => ({ data: base, error: null, status: 200 }));
  await getProgressionStatus();
  assert.equal(logs.length, 2);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic|details|Bearer|password|cookie|apikey|@/);
});

test("cards render accessible progress, exact long values, and distinct error/configuration/cap states", () => {
  const render = (data) => renderToStaticMarkup(createElement(ExpProgressCard, { exp: mapExpProgress(data) }));
  const progress = render(withOverrides({ current_exp: 650 }));
  assert.match(progress, /aria-label="Progression status"/);
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, /aria-valuenow="50"/);
  assert.match(progress, /aria-valuetext="50 percent toward Level 4, 250 EXP remaining"/);
  assert.match(render(unconfigured), /Level system not configured/);
  const invalid = render({ available: false });
  assert.match(invalid, /role="alert"/);
  assert.match(invalid, /href="\/dashboard"/);
  assert.doesNotMatch(invalid, /MAX LEVEL|Level system not configured|role="progressbar"/);
  const max = render(withOverrides({ current_exp: "9".repeat(400), next_level: null, next_level_required_exp: null }));
  assert.match(max, /MAX LEVEL/);
  assert.ok(max.includes("9".repeat(400)));
  assert.doesNotMatch(max, /role="progressbar"/);
  const longRemaining = render(withOverrides({ next_level_required_exp: "1" + "0".repeat(400) }));
  assert.ok(longRemaining.includes(String(BigInt("1" + "0".repeat(400)) - 400n)));
  const player = renderToStaticMarkup(createElement(PlayerSummary, { email: "synthetic@example.invalid", displayName: "X".repeat(400) }));
  assert.ok(player.includes("X".repeat(400)));
});
