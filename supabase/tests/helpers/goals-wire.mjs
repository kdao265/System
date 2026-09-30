import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Invoked only with resources/clients constructed by startAuthEnvironment.
// Returns exact calls so the parent ADR-015 suite can repeat denial after unbootstrap.
export async function exerciseGoalsWire(env, owner, outsider, anon) {
  const calls = [];
  async function ok(name, args = {}) {
    const result = await owner.rpc(name, args);
    assert(!result.error, `${name}: ${result.error?.code} ${result.error?.message}`);
    calls.push([name, args]);
    return result.data;
  }
  async function engineSnapshot() {
    return env.sql(`SELECT jsonb_build_object(
      'quests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.quests t),
      'occurrences',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.quest_occurrences t),
      'events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.quest_events t),
      'exp',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.exp_ledger t),
      'rules',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.quest_recurrence_rules t),
      'aliases',(SELECT jsonb_agg(to_jsonb(t) ORDER BY command_id) FROM system_internal.quest_completion_aliases t));`);
  }
  async function quest() {
    const result = await owner.rpc("create_one_off_quest", { command_id: randomUUID(), origin: "web_ui",
      request: { title: "Goal wire fixture", scheduled_at: "2031-01-01T10:00:00Z", default_reward_exp: 0 } });
    assert(!result.error, `Quest fixture failed: ${result.error?.code}`);
    return result.data;
  }
  const q = await quest();
  const baseline = await engineSnapshot();
  const goal = randomUUID();
  const create = { p_command_id: randomUUID(), p_goal_id: goal, p_title: "Wire Main Quest", p_description: null };
  const made = await ok("create_goal_v1", create);
  assert.equal(made.revision_after, "1");
  assert.deepEqual(await ok("create_goal_v1", create), { ...made, replay: true });
  const attach = { p_command_id: randomUUID(), p_goal_id: goal, p_expected_revision: "1", p_quest_id: q.quest_id };
  const attached = await ok("attach_goal_quest_v1", attach);
  const detach = { p_command_id: randomUUID(), p_goal_id: goal, p_expected_revision: "2", p_link_id: attached.link_id };
  const detached = await ok("detach_goal_quest_v1", detach);
  assert.deepEqual(await ok("attach_goal_quest_v1", attach), { ...attached, replay: true });
  assert.equal((await ok("get_goal_v1", { p_goal_id: goal })).goal.total_subquests, "0");
  const reattached = await ok("attach_goal_quest_v1", { ...attach, p_command_id: randomUUID(), p_expected_revision: "3" });
  assert.notEqual(reattached.link_id, attached.link_id);
  assert.deepEqual(await ok("detach_goal_quest_v1", detach), { ...detached, replay: true });
  const read = await ok("get_goal_v1", { p_goal_id: goal });
  assert.equal(read.goal.total_subquests, "1");
  assert.equal(read.goal.completed_subquests, "0");
  assert.equal(read.goal.is_complete, false);
  assert.equal(read.subquests[0].link_id, reattached.link_id);
  const metadata = { p_command_id: randomUUID(), p_goal_id: goal, p_expected_revision: "4", p_title: "Updated", p_description: "Details" };
  const updated = await ok("update_goal_v1", metadata);
  const archive = { p_command_id: randomUUID(), p_goal_id: goal, p_expected_revision: "5", p_archived: true };
  const archived = await ok("set_goal_archived_v1", archive);
  assert.deepEqual(await ok("update_goal_v1", metadata), { ...updated, replay: true });
  for (const [name, args] of [
    ["update_goal_v1", { ...metadata, p_command_id: randomUUID(), p_expected_revision: "6" }],
    ["attach_goal_quest_v1", { ...attach, p_command_id: randomUUID(), p_expected_revision: "6" }],
    ["detach_goal_quest_v1", { ...detach, p_command_id: randomUUID(), p_expected_revision: "6" }],
  ]) assert.equal((await owner.rpc(name, args)).error?.code, "23514", "Archived content command accepted");
  assert.equal((await ok("get_goal_v1", { p_goal_id: goal })).goal.display_state, "archived");
  const listed = await ok("list_goals_v1", { p_scope: "archived", p_limit: 100 });
  assert(listed.goals.some((g) => g.id === goal));
  await ok("set_goal_archived_v1", { p_command_id: randomUUID(), p_goal_id: goal, p_expected_revision: "6", p_archived: false });
  assert.deepEqual(await ok("set_goal_archived_v1", archive), { ...archived, replay: true });
  assert.equal((await ok("get_goal_v1", { p_goal_id: goal })).goal.display_state, "active");
  assert.equal(await engineSnapshot(), baseline, "Goal-only operations changed Quest/EXP state");

  for (const client of [outsider, anon]) {
    for (const [name, args] of calls) {
      assert.equal((await client.rpc(name, args)).error?.code, "42501", `${name} failed to guard non-owner/anonymous entry`);
    }
  }
  for (const table of ["goals", "goal_quest_links"]) {
    const owned = await owner.from(table).select("*");
    assert(!owned.error && owned.data.length > 0 && owned.data.every((r) => r.user_id === env.owner.id));
    const foreign = await outsider.from(table).select("*");
    assert(!foreign.error && foreign.data.length === 0);
    assert((await anon.from(table).select("*")).error);
    for (const client of [owner, outsider, anon]) {
      assert((await client.from(table).insert({})).error);
      assert((await client.from(table).update({ id: randomUUID() }).not("id", "is", null)).error);
      assert((await client.from(table).delete().not("id", "is", null)).error);
      assert((await client.schema("system_internal").from("goal_commands").select("*")).error);
    }
  }
  assert.equal(new Set(calls.map(([name]) => name)).size, 7, "All seven RPCs exercised");

  // Concurrent PostgREST requests, separate database transactions: structural
  // uniqueness and revision checks must still hold after the advisory lock wait.
  const concurrentQuest = await quest();
  const ga = randomUUID(); const gb = randomUUID();
  for (const id of [ga, gb]) await ok("create_goal_v1", { ...create, p_command_id: randomUUID(), p_goal_id: id });
  const contenders = [ga, gb].map((id) => ({ ...attach, p_command_id: randomUUID(), p_goal_id: id, p_quest_id: concurrentQuest.quest_id }));
  const outcomes = await Promise.all(contenders.map((args) => owner.rpc("attach_goal_quest_v1", args)));
  assert.equal(outcomes.filter((r) => !r.error).length, 1, "One current attachment wins");
  assert.equal(outcomes.find((r) => r.error).error.code, "23505");
  const winner = outcomes.find((r) => !r.error).data;
  const duplicate = { ...metadata, p_command_id: randomUUID(), p_goal_id: winner.goal_id, p_expected_revision: "2" };
  const replays = await Promise.all([owner.rpc("update_goal_v1", duplicate), owner.rpc("update_goal_v1", duplicate)]);
  assert(replays.every((r) => !r.error));
  assert.deepEqual(replays.map((r) => r.data.replay).sort(), [false, true]);
  assert.equal(replays[0].data.revision_after, "3");
  const conflicting = await Promise.all(["First", "Second"].map((title) => owner.rpc("update_goal_v1",
    { ...duplicate, p_command_id: randomUUID(), p_expected_revision: "3", p_title: title })));
  assert.equal(conflicting.filter((r) => !r.error).length, 1);
  assert.equal(conflicting.find((r) => r.error).error.code, "23514");
  return calls;
}
