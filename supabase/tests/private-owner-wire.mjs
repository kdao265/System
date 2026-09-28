// ADR-015 real Auth/PostgREST/PostgreSQL tests. Own disposable resources only.
// Run: node supabase/tests/private-owner-wire.mjs (no env-file or external target).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { startAuthEnvironment } from "../../tests/helpers/auth-environment.mjs";

const env = await startAuthEnvironment({ buildApp: false, activateOwner: false, testMigrationHistory: true });
// ADR-015 stage two is applied here from the promoted migration file: the harness
// defers it out of its filename-ordered loop until owner configuration exists.
const activation = readFileSync(new URL("../migrations/20260928100000_activate_private_owner.sql", import.meta.url), "utf8");
const tables = ["profiles", "quests", "quest_recurrence_rules", "quest_occurrences", "quest_events", "exp_ledger",
  "level_policies", "level_thresholds", "progression_policy_assignments", "level_milestones",
  "level_reward_definitions", "level_reward_unlocks", "level_reward_events"];
const rpcNames = ["get_current_exp", "get_progression_status", "list_level_rewards", "get_reward_history", "list_day_quest_occurrences",
  "assign_level_policy", "configure_level_reward", "update_level_reward", "cancel_level_reward", "redeem_level_reward",
  "create_one_off_quest", "complete_quest_occurrence", "reopen_quest_occurrence_v2", "get_quest_completion_resolution_v1"].sort();
const clients = [];
let checks = 0;
function pass(label) { checks++; console.log(`PASS: ${label}`); }
async function login(account) {
  const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(client);
  if (account) assert(!(await client.auth.signInWithPassword({ email: account.email, password: account.password })).error, "Fixture login failed");
  return client;
}
async function ok(client, name, args = {}) {
  const result = await client.rpc(name, args);
  assert(!result.error, `${name} owner call failed (${result.error?.code ?? "unknown"}): ${result.error?.message ?? "no message"}`);
  return result.data;
}
async function denied(client, name, args) {
  const { error } = await client.rpc(name, args);
  assert.equal(error?.code, "42501", `${name} must reject before business processing`);
}
async function catalog() {
  return JSON.parse(await env.sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid), '[]'::jsonb)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (${rpcNames.map((x) => `'${x}'`).join(",")});`));
}
async function policySnapshot() {
  return await env.sql("SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p;");
}
const basicGuard = "    PERFORM system_private.require_owner();\n";
const targetGuard = "    IF target_user_id IS DISTINCT FROM system_internal.request_user_id() THEN\n"
  + "        RAISE EXCEPTION 'SYSTEM owner target required' USING ERRCODE = '42501';\n    END IF;\n";

async function exercise(client, account) {
  const calls = new Map();
  async function call(name, args = {}) { calls.set(name, args); return ok(client, name, args); }
  const profile = await client.from("profiles").update({ timezone: "UTC", display_name: "Synthetic owner" }).eq("user_id", account.id).select();
  assert(!profile.error && profile.data?.length === 1, "Owner Profile update failed");
  const policies = await client.from("level_policies").select("id").eq("policy_key", "level_policy_v1").single();
  assert(!policies.error, "Published policy fixture missing");
  const policy = policies.data.id;
  const assigned = await call("assign_level_policy", { target_user_id: account.id, policy_id: policy, command_id: randomUUID(), origin: "internal" });
  // parse_fields(allow_partial => false) requires the complete six-field configure
  // envelope; description/estimated_cost/currency_label may be null but must be present.
  const configured = await call("configure_level_reward", { command_id: randomUUID(), origin: "web_ui", request: {
    operation: "configureLevelReward", fields: { required_level: 1, title: "Fixture treat", description: null,
      category: "treat", estimated_cost: null, currency_label: null },
  } });
  assert(configured.unlock_id, "Level-one reward did not unlock");
  const redeemed = await call("redeem_level_reward", { command_id: randomUUID(), origin: "web_ui", request: {
    operation: "redeemLevelReward", reward_unlock_id: configured.unlock_id,
  } });
  assert.equal(redeemed.event_type, "redeemed");
  const future = await call("configure_level_reward", { command_id: randomUUID(), origin: "web_ui", request: {
    operation: "configureLevelReward", fields: { required_level: 10, title: "Future treat", description: "Disposable",
      category: "treat", estimated_cost: 12.5, currency_label: "VND" },
  } });
  const updated = await call("update_level_reward", { command_id: randomUUID(), origin: "web_ui", request: {
    operation: "updateLevelReward", reward_definition_id: future.reward_id, expected_revision: 1, changes: { title: "Updated fixture" },
  } });
  assert.equal(updated.definition_revision, 2);
  const archived = await call("cancel_level_reward", { command_id: randomUUID(), origin: "web_ui", request: {
    operation: "cancelLevelReward", reward_definition_id: future.reward_id, expected_revision: 2,
  } });
  assert.equal(archived.event_type, "archived");
  const createArgs = { command_id: randomUUID(), origin: "web_ui", request: {
    title: "Disposable private Quest", scheduled_at: "2026-09-28T08:00:00Z", default_reward_exp: 100,
  } };
  const created = await call("create_one_off_quest", createArgs);
  const creationReplay = await ok(client, "create_one_off_quest", createArgs);
  assert.equal(creationReplay.quest_id, created.quest_id);
  assert.equal(creationReplay.replay, true);
  const completeArgs = { command_id: randomUUID(), occurrence_id: created.occurrence_id, expected_execution_cycle: 1,
    reported_completed_at: null, origin: "web_ui" };
  const completed = await call("complete_quest_occurrence", completeArgs);
  assert.equal(Number(completed.exp_amount), 100);
  const aliasArgs = { ...completeArgs, command_id: randomUUID() };
  const alias = await call("complete_quest_occurrence", aliasArgs);
  assert.equal(alias.replay, true);
  assert.equal(alias.exp_entry_id, completed.exp_entry_id);
  const resolutionArgs = { command_id: aliasArgs.command_id, occurrence_id: created.occurrence_id, expected_execution_cycle: 1 };
  assert.equal((await call("get_quest_completion_resolution_v1", resolutionArgs)).outcome, "recorded");
  assert.equal(Number(await call("get_current_exp")), 100);
  const progression = await call("get_progression_status");
  assert.equal(progression.current_level, 2);
  const undo = await call("reopen_quest_occurrence_v2", { command_id: randomUUID(), occurrence_id: created.occurrence_id,
    expected_execution_cycle: 1, origin: "web_ui" });
  // Reopen V2 reports the signed reversal amount, exactly as quest-reopen-v2.sql
  // asserts (check_bigint(u1.reversed_amount, -50) for a +50 credit).
  assert.equal(Number(undo.reversed_amount), -100);
  assert.equal(Number(await call("get_current_exp")), 0);
  const reverted = await call("get_progression_status");
  assert.equal(reverted.current_level, 1);
  assert.equal(reverted.highest_level, 2, "Permanent milestones must survive EXP reversal");
  const rewards = await call("list_level_rewards");
  assert(rewards.some((r) => r.reward_id === configured.reward_id && r.lifecycle === "REDEEMED"), "Unlock/redemption did not survive reversal");
  assert((await call("get_reward_history")).length >= 5);
  assert((await call("list_day_quest_occurrences", { p_day: "2026-09-28" })).some((q) => q.occurrence_id === created.occurrence_id));
  assert.deepEqual([...calls.keys()].sort(), rpcNames, "Exercise must reach every authenticated RPC");
  return { calls, policy, created, completeArgs, aliasArgs, resolutionArgs, assigned, alias };
}

try {
  // Original multi-user suites already ran at their migration checkpoints in the
  // harness. Retired V1 APIs are not temporarily re-granted to make them pass.
  const owner = await login(env.owner);
  const outsider = await login(env.other);
  const anon = await login();
  const baseline = await catalog();
  assert.equal(baseline.length, 14);
  const beforePolicies = await policySnapshot();
  const beforeRoles = await env.sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid, member, grantor) FROM pg_auth_members m;");
  await assert.rejects(env.sql(activation), /activation requires verified owner/);
  assert.equal(await policySnapshot(), beforePolicies, "Missing configuration activation partially changed policies");
  assert.deepEqual(await catalog(), baseline, "Missing configuration activation partially changed routines");
  assert.equal(await env.sql("SELECT count(*) FROM system_private.owner_configuration;"), "0");
  pass("migrations through stage one leave stage 2 inactive; missing bootstrap aborts activation without partial changes");
  await env.sql(`INSERT INTO system_internal.operator_grants(user_id, capability)
    VALUES ('${env.owner.id}', 'level_policy_assign'), ('${env.other.id}', 'level_policy_assign');`);
  const oldOwner = await exercise(owner, env.owner);
  const oldOther = await exercise(outsider, env.other);
  // Seed a recurrence rule for each owner; all other histories were generated by
  // the real public commands rather than hand-written business records. Quest
  // recurrence_mode is constrained to one_off/daily/weekly/monthly/custom, so the
  // rule-bearing fixture quest is 'daily' to match its daily rule type.
  await env.sql(`INSERT INTO public.quests(user_id,title,recurrence_mode)
    VALUES ('${env.owner.id}','Fixture recurrence','daily'), ('${env.other.id}','Fixture recurrence','daily');
    INSERT INTO public.quest_recurrence_rules(quest_id,user_id,recurrence_type,anchor_date)
    SELECT id,user_id,'daily','2026-09-28' FROM public.quests WHERE title='Fixture recurrence';`);
  await env.sql(`INSERT INTO system_private.owner_configuration(user_id) VALUES ('${env.owner.id}');`);
  // An unfamiliar RPC body must abort the entire activation, including policies
  // already staged in its transaction. Restore only this disposable test change.
  const originalExp = await env.sql("SELECT pg_get_functiondef('public.get_current_exp()'::regprocedure);");
  await env.sql(originalExp.replace("BEGIN", "BEGIN\n    -- deliberate disposable drift"));
  await assert.rejects(env.sql(activation), /RPC preflight failed/);
  assert.equal(await policySnapshot(), beforePolicies, "Drift failure left restrictive policies active");
  await env.sql(originalExp);
  await env.sql(activation);
  assert.equal(await env.sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid, member, grantor) FROM pg_auth_members m;"), beforeRoles, "Activation changed lasting role memberships");
  const active = await catalog();
  for (const previous of baseline) {
    const next = active.find((row) => row.oid === previous.oid);
    assert(next, "Activation changed a public RPC OID");
    const expectedGuard = basicGuard + (previous.proname === "assign_level_policy" ? targetGuard : "");
    assert(next.prosrc.includes(expectedGuard), `${previous.proname} entry guard absent`);
    assert.equal(next.prosrc.replace(expectedGuard, ""), previous.prosrc, `${previous.proname} business body changed`);
    assert.deepEqual({ ...next, prosrc: previous.prosrc }, previous, `${previous.proname} signature/ACL/attributes changed`);
  }
  pass("activation is atomic on source drift and preserves RPC OIDs, full business bodies, ACLs, attributes and memberships");

  await env.sql(readFileSync(new URL("private-owner-catalog.sql", import.meta.url), "utf8"));
  pass("catalogue and SQL role matrix: restrictive policies, private singleton, RLS-bound roles, no privilege widening");

  const approved = await exercise(owner, env.owner);
  pass("owner succeeds on all 14 real RPCs; creation/completion aliases/reopen, EXP reversal, milestones and reward lifecycle preserved");
  for (const client of [outsider, anon]) {
    for (const [name, args] of oldOther.calls) await denied(client, name, args);
    for (const [name, args] of approved.calls) await denied(client, name, args);
  }
  pass("all 14 RPCs reject anonymous and operator-granted non-owner tokens, including their own old idempotent receipts");
  await denied(owner, "assign_level_policy", { ...approved.calls.get("assign_level_policy"), target_user_id: env.other.id });
  await denied(outsider, "assign_level_policy", { ...approved.calls.get("assign_level_policy"), target_user_id: env.owner.id });
  await env.sql(`UPDATE system_internal.operator_grants SET revoked_at=now() WHERE user_id='${env.owner.id}' AND revoked_at IS NULL;`);
  await denied(owner, "assign_level_policy", approved.calls.get("assign_level_policy"));
  await env.sql(`INSERT INTO system_internal.operator_grants(user_id,capability) VALUES ('${env.owner.id}','level_policy_assign');`);
  pass("assignment requires owner actor, owner target and active operator capability, including replay");

  for (const table of tables) {
    const visible = await owner.from(table).select("*");
    assert(!visible.error && visible.data.length > 0, `${table}: non-vacuous owner visibility`);
    if (table !== "level_policies" && table !== "level_thresholds") assert(visible.data.every((row) => row.user_id === env.owner.id), `${table}: cross-owner row exposed`);
    const invisible = await outsider.from(table).select("*");
    assert(!invisible.error && invisible.data.length === 0, `${table}: non-owner rows visible`);
    assert((await anon.from(table).select("*")).error, `${table}: anonymous SELECT allowed`);
    for (const client of [outsider, anon]) {
      assert((await client.from(table).insert({})).error, `${table}: forbidden INSERT allowed`);
      assert((await client.from(table).delete().not(table === "profiles" ? "user_id" : "id", "is", null)).error, `${table}: forbidden DELETE allowed`);
    }
    if (table === "profiles") {
      const update = await outsider.from(table).update({ display_name: "Forbidden" }).eq("user_id", env.other.id).select();
      assert(!update.error && update.data.length === 0, "Non-owner Profile UPDATE succeeded");
    } else {
      assert((await outsider.from(table).update({ id: randomUUID() }).not("id", "is", null)).error, `${table}: forbidden UPDATE allowed`);
    }
  }
  pass("all 13 populated public tables: owner scoped reads, hidden non-owner rows, denied anonymous access and forbidden writes");
  for (const client of [owner, outsider, anon]) {
    await denied(client, "quest_valid_weekdays", { days: [1] });
    await denied(client, "reopen_quest_occurrence", { command_id: randomUUID(), occurrence_id: approved.created.occurrence_id, origin: "web_ui" });
    assert((await client.schema("system_private").from("owner_configuration").select("*")).error, "Private configuration schema exposed");
    assert((await client.schema("system_internal").from("quest_completion_aliases").select("*")).error, "Private history schema exposed");
  }
  pass("retired/value-only functions remain uncallable and private schemas are absent from PostgREST");

  // Owner remains approved, but cannot replay or inspect another owner's objects.
  const crossResolution = await owner.rpc("get_quest_completion_resolution_v1", oldOther.resolutionArgs);
  assert(crossResolution.error, "Owner resolved a foreign occurrence");
  assert((await owner.rpc("complete_quest_occurrence", oldOther.completeArgs)).error, "Owner completed a foreign occurrence");
  const stale = await owner.rpc("complete_quest_occurrence", { ...approved.completeArgs, command_id: randomUUID() });
  assert.equal(stale.error?.code, "23514", "Stale-cycle business rejection changed");
  const aliasResolution = await ok(owner, "get_quest_completion_resolution_v1", oldOwner.resolutionArgs);
  // The documented outcomes are recorded, unrecorded_current, unrecorded_superseded and
  // conflict (quest_completion_aliases.sql). A durable alias replays its historical receipt
  // after Reopen, while the occurrence still carries the pre-activation undo.
  assert.equal(aliasResolution.outcome, "recorded", "Pre-activation alias history lost after activation");
  assert.equal(aliasResolution.receipt.command_id, oldOwner.resolutionArgs.command_id);
  assert.equal(aliasResolution.receipt.exp_entry_id, oldOwner.alias.exp_entry_id, "Pre-activation completion receipt lost after activation");
  assert.equal(aliasResolution.receipt.replay, true);
  assert.equal(aliasResolution.current_execution_cycle, 2, "Pre-activation Reopen undo lost after activation");
  assert.equal(aliasResolution.current_status, "scheduled");
  pass("pre-activation history survives; cross-owner IDs remain denied and stale-cycle semantics remain intact");

  // Removing configuration after activation must not fall back to multi-user mode.
  await env.sql("DELETE FROM system_private.owner_configuration;");
  for (const client of [owner, outsider, anon]) {
    for (const [name, args] of approved.calls) await denied(client, name, args);
    for (const table of tables) {
      const result = await client.from(table).select("*");
      assert(result.error || result.data.length === 0, `${table}: missing config leaked data`);
    }
  }
  // Auth provisioning is independent of owner authorization, even while empty.
  await env.sql("BEGIN; INSERT INTO auth.users(id) VALUES (gen_random_uuid()); DO $$ BEGIN IF EXISTS (SELECT 1 FROM auth.users u LEFT JOIN public.profiles p ON p.user_id=u.id WHERE p.user_id IS NULL) THEN RAISE EXCEPTION 'Provisioning failed'; END IF; END $$; ROLLBACK;");
  await env.sql(`INSERT INTO system_private.owner_configuration(user_id) VALUES ('${env.owner.id}');`);
  assert.equal(Number(await ok(owner, "get_current_exp")), 0);
  pass("missing configuration after activation denies every table/RPC; Profile provisioning and verified-owner restoration work");
  console.log(`PASS: ${checks} database/security groups completed`);
} finally {
  for (const client of clients) await client.auth.signOut({ scope: "local" });
  await env.close();
  console.log("Disposable database/Auth/PostgREST resources removed; no existing Local or Cloud operation.");
}
