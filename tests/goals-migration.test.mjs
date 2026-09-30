import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260930120000_create_goals_main_quest.sql", import.meta.url), "utf8");
const sql = migration.replace(/--[^\n]*/g, "");
const names = ["create_goal_v1", "update_goal_v1", "set_goal_archived_v1", "attach_goal_quest_v1", "detach_goal_quest_v1", "get_goal_v1", "list_goals_v1"];

test("Goals migration adds only approved storage and public RPCs, without replacing existing engine code", () => {
  assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map((m) => m[1]), ["public.goals", "public.goal_quest_links", "system_internal.goal_commands"]);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map((m) => m[1]), names);
  assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE|DROP\s+(TABLE|FUNCTION|POLICY)/i);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:quests|quest_occurrences|quest_events|quest_recurrence_rules|exp_ledger|level_\w+)/i);
  assert.doesNotMatch(sql, /PERFORM\s+(?:exp_internal\.|progression_internal\.recognize|public\.(?:complete_quest|reopen_quest|materialize_quest))/i);
});

test("every public Goal RPC guards entry and uses a fixed search path", () => {
  for (const name of names) {
    const body = sql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
    assert.ok(body, name);
    assert.match(body, /SET search_path = pg_catalog/);
    assert.match(body, /BEGIN\s+PERFORM system_private\.require_owner\(\);/);
    assert.match(body, /RETURNS jsonb/);
    assert.match(body, name.startsWith("get_") || name.startsWith("list_") ? /STABLE SECURITY INVOKER/ : /SECURITY DEFINER/);
  }
});

test("Goal idempotency resolves recorded intent before fresh revision and archive checks", () => {
  const body = sql.slice(sql.indexOf("CREATE FUNCTION system_internal.run_goal_command_v1"), sql.indexOf("CREATE FUNCTION public.create_goal_v1"));
  assert.ok(body.indexOf("prior.request IS DISTINCT FROM request_value") < body.indexOf("g.revision <> p_expected_revision"));
  assert.ok(body.indexOf("RETURN prior.result") < body.indexOf("Archived Goal cannot be edited"));
  assert.match(body, /l\.id = v_link AND l\.goal_id = p_goal_id/);
  assert.match(sql, /CREATE UNIQUE INDEX uq_goal_quest_current[^;]*\(quest_id\) WHERE detached_at IS NULL/);
  assert.doesNotMatch(sql, /GRANT UPDATE \(position/);
});

test("Goals checkpoint retains every historical suite and registers its own pair", () => {
  const harness = readFileSync(new URL("./helpers/auth-environment.mjs", import.meta.url), "utf8");
  assert.match(harness, /"20260930120000": \["goals-main-quest-catalog", "goals-main-quest"\]/);
  assert.match(harness, /"20260929120000": \["calendar-schedule-catalog", "calendar-schedule"\]/);
  assert.match(harness, /"20260928181000": \["recurring-quests-catalog", "recurring-quests"\]/);
});
