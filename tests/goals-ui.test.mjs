import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../src/", import.meta.url);
const mockUrl = `data:text/javascript,${encodeURIComponent(`
  export let response = {data: null, error: null}, calls = [], invalidations = [], allowed = true, cacheFails = false;
  export function configure(next, auth = true, fail = false) { response = next; allowed = auth; cacheFails = fail; calls = []; invalidations = []; }
  export async function getProfileContext() { if (!allowed) throw new Error('auth-gate'); return {user: {id: '11111111-1111-4111-8111-111111111111'}, profile: {timezone: 'UTC'}}; }
  export function isOnboardingComplete(p) { return !!p?.timezone; }
  export async function requireUser() { if (!allowed) throw new Error('auth-gate'); }
  export async function createServerSupabaseClient() { return {rpc: async (...args) => { calls.push(args); if (response instanceof Error) throw response; return response; }}; }
  export function revalidatePath(path) { invalidations.push(path); if (cacheFails) throw new Error('cache'); }
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
const model = await import("../src/features/goals/model.ts");
const { mutateGoal } = await import("../src/features/goals/actions.ts");
const { getGoals, getGoal } = await import("../src/features/goals/data.ts");
const mock = await import(mockUrl);
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const instant = "2026-09-30T12:00:00+00:00";
const goal = { id, title: "Outcome", description: null, archived_at: null, created_at: instant, updated_at: instant, revision: "9007199254740993", total_subquests: "0", completed_subquests: "0", is_complete: false, display_state: "active" };
const request = { userId: id, commandId: other, goalId: id, kind: "update_metadata", revision: goal.revision, title: " New title ", description: " " };
const receipt = { version: 1, command_id: other, goal_id: id, command_type: request.kind, revision_before: request.revision, revision_after: "9007199254740994", changed: true, replay: false, recorded_at: instant, link_id: null };
const sub = { link_id: id, quest_id: id, occurrence_id: id, position: 1, attached_at: instant, title: "Sub", quest_archived_at: null, status: "completed", execution_cycle: 1, scheduled_at: null, deadline_at: null, reward_exp_snapshot: 0 };

test("Goal reads validate exact bigint counts, empty state and derived completion", () => {
  assert(model.isGoal(goal)); assert.equal(model.progressPercent(goal), 0);
  assert(!model.isGoal({ ...goal, is_complete: true }));
  assert(!model.isGoal({ ...goal, revision: 9007199254740993 }));
  assert(!model.isGoal({ ...goal, completed_subquests: "1" }));
  assert(!model.isGoal({ ...goal, total_subquests: "01" }));
  const partial = { ...goal, total_subquests: "3", completed_subquests: "1" };
  assert(model.isGoal(partial)); assert.equal(model.progressPercent(partial), 33.3);
  assert(model.isGoal({ ...partial, completed_subquests: "3", is_complete: true, display_state: "completed" }));
  assert(model.isGoal({ ...partial, archived_at: instant, display_state: "archived" }));
  const almost = { ...goal, total_subquests: "9223372036854775807", completed_subquests: "9223372036854775806" };
  assert.equal(model.progressPercent(almost), 99.9); assert.equal(almost.is_complete, false);
});

test("Detail preserves attach order and rejects missing, duplicated or inconsistent members", () => {
  const value = { version: 1, goal: { ...goal, total_subquests: "1", completed_subquests: "1", is_complete: true, display_state: "completed" }, subquests: [sub] };
  assert.deepEqual(model.parseGoalDetail(value), value);
  assert.equal(model.parseGoalDetail({ ...value, subquests: [] }), null);
  assert.equal(model.parseGoalDetail({ ...value, subquests: [sub, sub] }), null);
  assert.equal(model.parseGoalDetail({ ...value, subquests: [{ ...sub, status: "draft" }] }), null);
  assert.equal(model.parseGoalDetail({ ...value, subquests: [{ ...sub, execution_cycle: 0 }] }), null);
  const pair = { version: 1, goal: { ...goal, total_subquests: "2", completed_subquests: "2", is_complete: true, display_state: "completed" }, subquests: [sub, { ...sub, link_id: other, quest_id: other, occurrence_id: other, position: 4 }] };
  assert(model.parseGoalDetail(pair)); assert.equal(model.parseGoalDetail({ ...pair, subquests: pair.subquests.toReversed() }), null);
  assert.equal(model.parseGoalPage({ version: 1, goals: [goal], next_after_id: other }), null);
});

test("Only compatible, unattached one-off candidates are offered, including archived Goal memberships", () => {
  const occurrence = Object.fromEntries(["recurrence_rule_id", "recurrence_revision", "source_slot_date", "source_timezone", "direct_goal_id_snapshot", "project_id_snapshot"].map((k) => [k, null]));
  const candidate = { id, title: "Candidate", recurrence_mode: "one_off", archived_at: null, direct_goal_id: null, project_id: null, rules: [], links: [], occurrences: [occurrence] };
  assert(model.eligibleCandidate(candidate));
  for (const patch of [{ recurrence_mode: "daily" }, { rules: [{ id }] }, { links: [{ detached_at: null }] }, { archived_at: instant }, { direct_goal_id: id }, { occurrences: [] }, { occurrences: [occurrence, occurrence] }, { occurrences: [{ ...occurrence, source_timezone: "UTC" }] }]) assert(!model.eligibleCandidate({ ...candidate, ...patch }));
  assert(model.eligibleCandidate({ ...candidate, links: [{ detached_at: instant }] }));
});

test("All five mutation adapters preserve identity, exact revision and detach interval", () => {
  assert(model.validRequest(request));
  assert.deepEqual(model.goalCommand(request), { name: "update_goal_v1", args: { p_command_id: other, p_goal_id: id, p_expected_revision: goal.revision, p_title: "New title", p_description: null } });
  for (const [patch, name, field, expected] of [
    [{ kind: "create" }, "create_goal_v1", "p_title", "New title"],
    [{ kind: "set_archived", archived: false }, "set_goal_archived_v1", "p_archived", false],
    [{ kind: "attach", questId: other }, "attach_goal_quest_v1", "p_quest_id", other],
    [{ kind: "detach", linkId: other }, "detach_goal_quest_v1", "p_link_id", other],
  ]) { const call = model.goalCommand({ ...request, ...patch }); assert.equal(call.name, name); assert.equal(call.args[field], expected); }
  for (const patch of [{ revision: 4 }, { revision: "9223372036854775808" }, { title: " " }, { title: "x".repeat(121) }, { kind: "reorder" }, { commandId: "invalid" }]) assert(!model.validRequest({ ...request, ...patch }));
  assert(model.validReceipt(receipt, request));
  assert(!model.validReceipt({ ...receipt, revision_after: "9007199254740993" }, request));
  assert(!model.validReceipt({ ...receipt, command_id: id }, request));
  const creation = { ...request, kind: "create" };
  const created = { ...receipt, command_type: "create", revision_before: "0", revision_after: "1" };
  assert(model.validReceipt(created, creation));
  assert(!model.validReceipt({ ...created, revision_before: null }, creation));
});

test("Owner action guards, unknown transport, same-intent retry and cache failure", async () => {
  mock.configure({ data: receipt, error: null }, false);
  await assert.rejects(mutateGoal(request), /auth-gate/); assert.equal(mock.calls.length, 0);
  mock.configure({ data: receipt, error: null });
  assert.equal((await mutateGoal({ ...request, userId: other })).outcome, "rejected"); assert.equal(mock.calls.length, 0);
  mock.configure(new Error("network"));
  assert.equal((await mutateGoal(request)).outcome, "unknown"); const first = mock.calls[0];
  mock.configure({ data: { ...receipt, replay: true }, error: null });
  assert.equal((await mutateGoal(request)).outcome, "success"); assert.deepEqual(mock.calls[0], first); assert.deepEqual(mock.invalidations, ["/goals"]);
  mock.configure({ data: receipt, error: null }, true, true);
  assert.equal((await mutateGoal(request)).outcome, "success");
  mock.configure({ data: { ...receipt, goal_id: other }, error: null });
  assert.equal((await mutateGoal(request)).outcome, "unknown");
});

test("Known server rejections are recoverable; unknown constraints remain uncertain", async () => {
  for (const [code, message, feedback] of [["23514", "Stale Goal revision", /Refresh/], ["23514", "Archived Goal cannot be edited", /restore/], ["23505", "Quest already belongs to a Goal", /another Main Quest/], ["23514", "Quest is not eligible for Goal membership", /Recurring/]]) {
    mock.configure({ data: null, error: { code, message } });
    const result = await mutateGoal(request); assert.equal(result.outcome, "rejected"); assert.match(result.message, feedback);
  }
  assert.equal(model.goalError({ code: "23514", message: "unrecognized" }).outcome, "unknown");
});

test("Read failure hides progress instead of presenting a cached success", async () => {
  mock.configure({ data: { version: 1, goals: [goal], next_after_id: null }, error: null });
  assert.equal((await getGoals("unarchived", null)).goals[0].revision, goal.revision);
  assert.deepEqual(mock.calls[0], ["list_goals_v1", { p_scope: "unarchived", p_after_id: null, p_limit: 50 }]);
  mock.configure(new Error("network")); assert.equal(await getGoals("archived", null), null); assert.equal(await getGoal(id), null);
  mock.configure({ data: null, error: null }, false); await assert.rejects(getGoals("unarchived", null), /auth-gate/);
});

test("Goals reuse Quest controls and refresh paths without Goal lifecycle RPCs", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const page = read("src/app/goals/page.tsx");
  for (const marker of ["getProfileContext", "isOnboardingComplete", "QuestCompletionProvider", "QuestCompletionControl", "QuestReopenControl", "QuestReopenRead"]) assert(page.includes(marker));
  assert(read("src/proxy.ts").includes('"/goals/:path*"'));
  for (const name of ["completion-action", "reopen-action", "completion-resolution-action"]) assert(read(`src/features/quests/${name}.ts`).includes('revalidatePath("/goals")'));
  assert(!read("src/features/goals/actions.ts").includes("service_role"));
});
