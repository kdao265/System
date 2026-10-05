import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const root = new URL("../src/", import.meta.url);
const mocksUrl = `data:text/javascript,${encodeURIComponent(`
  export const jar = new Map();
  export let user, authError, revokeFails, log = [];
  export function configure(nextUser, error = null, failRevoke = false) {
    user = nextUser; authError = error; revokeFails = failRevoke;
    log = []; jar.clear();
  }
  export async function cookies() {
    return { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name, value, options) => options.maxAge === 0 ? jar.delete(name) : jar.set(name, value) };
  }
  export function getSupabaseConfig() { return { url: "http://127.0.0.1:54321", anonKey: "test-public-key" }; }
  export function revalidatePath() {}
  export function createServerClient(url, key, { cookies }) {
    return { auth: {
      getUser: async () => { log.push("getUser"); return { data: { user }, error: authError }; },
      signInWithPassword: async () => {
        log.push("password");
        if (!authError) cookies.setAll([{ name: "sb-127-auth-token", value: "buffered-test-session", options: { path: "/" } }]);
        return { data: { user, session: authError ? null : {} }, error: authError };
      },
      signOut: async () => { log.push("signOut"); if (revokeFails) throw new Error("unavailable"); return { error: null }; },
    }, from: () => { throw new Error("Protected data reached"); } };
  }
  export function createRecurringQuest() { throw new Error("Protected RPC reached"); }
  export function createRecurringQuestV2() { throw new Error("Protected RPC reached"); }
  export function setRecurrencePause() { throw new Error("Protected RPC reached"); }
  export function getRecurringSeriesDetail() { throw new Error("Protected RPC reached"); }
  export function setRecurringScheduleDefaults() { throw new Error("Protected RPC reached"); }
  export class ScheduleCommandError extends Error {}
  export function createOneOffQuest() { throw new Error("Protected RPC reached"); }
  export function completeQuestOccurrence() { throw new Error("Protected RPC reached"); }
  export function reopenQuestOccurrence() { throw new Error("Protected RPC reached"); }
  export function getQuestCompletionResolution() { throw new Error("Protected RPC reached"); }
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root.href)) {
      if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
      if (["next/headers", "next/cache", "@supabase/ssr", "./config"].includes(specifier) ||
          /\/\w+(?:-resolution)?-data$/.test(specifier)) return { url: mocksUrl, shortCircuit: true };
      if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
      if (specifier.startsWith("@/") || specifier.startsWith("./")) {
        const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, context.parentURL);
        const url = new URL(base.href + ".ts");
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
const { configuredOwnerId, isSystemOwner } = await import("../src/features/auth/owner.ts");
const { getAuthenticatedUser, requireUser } = await import("../src/features/auth/session.ts");
const { login, signup } = await import("../src/features/auth/actions.ts");
const { saveProfile } = await import("../src/features/profile/actions.ts");
const { changeRecurrencePause } = await import("../src/features/quests/recurrence-action.ts");
const { saveScheduleEvent } = await import("../src/features/calendar/actions.ts");
const { createQuest } = await import("../src/features/quests/create-action.ts");
const { completeQuest } = await import("../src/features/quests/completion-action.ts");
const { reopenQuest } = await import("../src/features/quests/reopen-action.ts");
const { resolveQuestCompletion } = await import("../src/features/quests/completion-resolution-action.ts");
const mocks = await import(mocksUrl);
hooks.deregister();

const redirectTo = (path) => (error) => error.digest?.includes(`;${path};`);
function form() {
  const data = new FormData();
  data.set("email", "synthetic@example.invalid"); data.set("password", "synthetic-only");
  data.set("expected_account", owner);
  return data;
}

test("owner configuration is server-only UUID authorization and fails closed", async () => {
  for (const value of [undefined, "", " ", "invalid", "00000000-0000-0000-0000-000000000000", `${owner} `]) {
    if (value === undefined) delete process.env.SYSTEM_OWNER_USER_ID;
    else process.env.SYSTEM_OWNER_USER_ID = value;
    mocks.configure({ id: owner });
    assert.equal(configuredOwnerId(), null);
    assert.equal(isSystemOwner(owner), false);
    assert.equal(await getAuthenticatedUser(), null);
    assert.deepEqual(mocks.log, []);
    await assert.rejects(requireUser(), redirectTo("/login"));
  }
  process.env.SYSTEM_OWNER_USER_ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  assert(isSystemOwner("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
});

test("verified identity must match owner; metadata, email and unverified sessions do not authorize", async () => {
  process.env.SYSTEM_OWNER_USER_ID = owner;
  mocks.configure({ id: owner });
  assert.equal((await requireUser()).id, owner);
  for (const user of [null, { id: other, user_metadata: { owner: true, user_id: owner } }]) {
    mocks.configure(user);
    assert.equal(await getAuthenticatedUser(), null);
    await assert.rejects(requireUser(), redirectTo("/login"));
  }
  mocks.configure({ id: owner }, { message: "invalid auth" });
  assert.equal(await getAuthenticatedUser(), null);
});

test("every protected action denies anonymous/non-owner and misconfiguration before data access", async () => {
  for (const action of [saveProfile, createQuest, completeQuest, reopenQuest, resolveQuestCompletion, changeRecurrencePause, saveScheduleEvent]) {
    for (const [setting, user] of [[owner, null], [owner, { id: other }], ["", { id: owner }], ["invalid", { id: owner }]]) {
      process.env.SYSTEM_OWNER_USER_ID = setting;
      mocks.configure(user);
      await assert.rejects(action({}, form()), redirectTo("/login"));
      assert(mocks.log.every((call) => call === "getUser"));
    }
  }
});

test("signup direct invocation is inert, regardless of configuration or input", async () => {
  mocks.configure({ id: owner });
  assert.deepEqual(await signup({}, form()), { error: "Registration is unavailable." });
  assert.deepEqual(mocks.log, []);
});

test("login commits only owner cookies; rejection never commits tokens even on revocation failure", async () => {
  process.env.SYSTEM_OWNER_USER_ID = owner;
  mocks.configure({ id: other });
  mocks.jar.set("sb-127-auth-token", "old-session");
  assert.equal((await login({}, new FormData())).error, "Enter your email and password.");
  assert.equal(mocks.jar.size, 0);
  assert.deepEqual(mocks.log, []);
  for (const fails of [false, true]) {
    mocks.configure({ id: other }, null, fails);
    mocks.jar.set("sb-127-auth-token.0", "old-session");
    mocks.jar.set("unrelated", "preserved");
    const result = await login({}, form());
    assert.equal(result.error, "Unable to sign in. Check your details and try again.");
    assert.deepEqual([...mocks.jar], [["unrelated", "preserved"]]);
    assert.deepEqual(mocks.log, ["password", "signOut"]);
  }
  mocks.configure(null, { message: "bad credentials" });
  assert.equal((await login({}, form())).error, "Unable to sign in. Check your details and try again.");
  assert.equal(mocks.jar.size, 0);
  mocks.configure({ id: owner });
  await assert.rejects(login({}, form()), redirectTo("/dashboard"));
  assert.equal(mocks.jar.get("sb-127-auth-token"), "buffered-test-session");
  for (const setting of ["", "invalid"]) {
    process.env.SYSTEM_OWNER_USER_ID = setting;
    mocks.configure({ id: owner });
    assert((await login({}, form())).error);
    assert.deepEqual(mocks.log, []);
    assert.equal(mocks.jar.size, 0);
  }
});
